/**
 * ModelRouter — the ONLY file that imports @anthropic-ai/sdk or @google/generative-ai.
 * All agents call modelRouter.complete() or modelRouter.embed().
 */
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { RouterRequest, RouterResponse } from '@wildlife-sentinel/shared/types';
import { MODELS } from '@wildlife-sentinel/shared/models';
import { config } from '../config.js';
import { logModelUsage } from '../db/modelUsage.js';

// Pricing per million tokens — Tier 1 paid (upgraded 2026-03-31)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':          { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001':  { input: 0.80,  output: 4.00  },
  'gemini-2.5-flash':      { input: 0.30,  output: 2.50  },
  'gemini-2.5-flash-lite': { input: 0.10,  output: 0.40  },
  'gemini-embedding-001':  { input: 0.00,  output: 0.00  },  // verify in AI Studio
};

const MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 15_000;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Parse the retryDelay field from a Google 429/503 error response body.
 * Returns milliseconds, or null if the body cannot be parsed.
 */
function parseRetryDelayMs(errorBody: string): number | null {
  try {
    const parsed = JSON.parse(errorBody) as {
      error?: { details?: Array<{ '@type': string; retryDelay?: string }> }
    };
    const retryInfo = parsed.error?.details?.find(
      d => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
    );
    if (retryInfo?.retryDelay) {
      // retryDelay is e.g. "12s" or "12.882280697s"
      return Math.ceil(parseFloat(retryInfo.retryDelay) * 1000);
    }
  } catch { /* ignore malformed body */ }
  return null;
}

/**
 * Returns true if the error from the Google AI SDK is a retryable 429 or 503.
 * The SDK exposes `status` on its error objects.
 */
function isRetryableGoogleError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const status = (err as Record<string, unknown>)['status'];
  return status === 429 || status === 503;
}

function getErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return '';
}

class ModelRouter {
  private anthropic: Anthropic;
  private google: GoogleGenerativeAI;
  private runningCostUsd = 0;
  private callCount = 0;

  // In-memory Google RPM tracking
  private googleCallsThisMinute = 0;
  private googleRateLimitResetAt = Date.now() + 60_000;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: config.anthropicKey });
    this.google = new GoogleGenerativeAI(config.googleAiKey);
  }

  async complete(request: RouterRequest): Promise<RouterResponse> {
    if (request.model.startsWith('claude-')) {
      return this.completeAnthropic(request);
    }
    if (request.model.startsWith('gemini-')) {
      return this.completeGoogle(request);
    }
    throw new Error(`ModelRouter: unknown model prefix for "${request.model}"`);
  }

  async embed(text: string | string[]): Promise<number[][]> {
    const inputs = Array.isArray(text) ? text : [text];
    const embeddings: number[][] = [];

    for (const input of inputs) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GOOGLE_EMBEDDINGS}:embedContent?key=${config.googleAiKey}`;

      for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: `models/${MODELS.GOOGLE_EMBEDDINGS}`,
            content: { parts: [{ text: input }] },
            outputDimensionality: 1536,
          }),
        });

        if (res.ok) {
          const data = await res.json() as { embedding: { values: number[] } };
          embeddings.push(data.embedding.values);
          break;
        }

        const body = await res.text();
        if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRY_ATTEMPTS) {
          const delayMs = parseRetryDelayMs(body) ?? DEFAULT_RETRY_DELAY_MS;
          console.warn(
            `[model-router] Rate limited (${MODELS.GOOGLE_EMBEDDINGS}) — retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`
          );
          await sleep(delayMs);
          continue;
        }

        throw new Error(`ModelRouter embed error ${res.status}: ${body}`);
      }
    }

    return embeddings;
  }

  getRunningCostUsd(): number {
    return this.runningCostUsd;
  }

  private async completeAnthropic(request: RouterRequest): Promise<RouterResponse> {
    // Do NOT retry Anthropic — 429s are billing/capacity issues, not transient
    const response = await this.anthropic.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.3,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userMessage }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      throw new Error('ModelRouter: Anthropic returned no text content');
    }

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost = this.calculateCost(request.model, inputTokens, outputTokens);

    // Claude sometimes wraps JSON responses in ```json ... ``` code fences even when
    // asked for raw JSON. Strip them so callers can JSON.parse() reliably.
    const text = request.jsonMode === true
      ? content.text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
      : content.text;

    await this.trackUsage(request.model, inputTokens, outputTokens, cost);
    return { content: text, model: request.model, inputTokens, outputTokens, estimatedCostUsd: cost };
  }

  private async completeGoogle(request: RouterRequest): Promise<RouterResponse> {
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        this.checkGoogleRateLimit(request.model);

        const model = this.google.getGenerativeModel({
          model: request.model,
          systemInstruction: request.systemPrompt,
          generationConfig: {
            maxOutputTokens: request.maxTokens ?? 1024,
            temperature: request.temperature ?? 0.3,
            responseMimeType: request.jsonMode === true ? 'application/json' : 'text/plain',
          },
        });

        const result = await model.generateContent(request.userMessage);
        const raw = result.response.text();
        // Strip markdown code fences — Gemini occasionally wraps JSON in ```json ... ```
        // even when responseMimeType is set. Apply only when jsonMode is requested.
        const text = request.jsonMode === true
          ? raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
          : raw;
        const usage = result.response.usageMetadata;
        const inputTokens = usage?.promptTokenCount ?? 0;
        const outputTokens = usage?.candidatesTokenCount ?? 0;
        const cost = this.calculateCost(request.model, inputTokens, outputTokens);

        await this.trackUsage(request.model, inputTokens, outputTokens, cost);
        return { content: text, model: request.model, inputTokens, outputTokens, estimatedCostUsd: cost };
      } catch (err) {
        if (isRetryableGoogleError(err) && attempt < MAX_RETRY_ATTEMPTS) {
          const delayMs = parseRetryDelayMs(getErrorMessage(err)) ?? DEFAULT_RETRY_DELAY_MS;
          console.warn(
            `[model-router] Rate limited (${request.model}) — retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`
          );
          await sleep(delayMs);
          continue;
        }
        throw err;
      }
    }

    // Unreachable — loop always returns or throws — but TypeScript needs this
    throw new Error(`ModelRouter: ${request.model} failed after ${MAX_RETRY_ATTEMPTS} attempts`);
  }

  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const p = PRICING[model];
    if (!p) return 0;
    return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  }

  private async trackUsage(
    model: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number
  ): Promise<void> {
    this.runningCostUsd += costUsd;
    this.callCount++;

    // Always log Claude calls (real money). Log Gemini every 10 calls (free tier, reduce write load).
    const shouldLog = model.startsWith('claude-') || this.callCount % 10 === 0;
    if (shouldLog) {
      await logModelUsage({ model, inputTokens, outputTokens, estimatedCostUsd: costUsd });
    }
  }

  private checkGoogleRateLimit(model: string): void {
    const now = Date.now();
    if (now > this.googleRateLimitResetAt) {
      this.googleCallsThisMinute = 0;
      this.googleRateLimitResetAt = now + 60_000;
    }
    this.googleCallsThisMinute++;

    const limit = model === MODELS.GEMINI_FLASH ? 10 : 15;
    if (this.googleCallsThisMinute > limit * 0.8) {
      console.warn(
        `[model-router] Approaching Google rate limit: ${this.googleCallsThisMinute}/${limit} RPM for ${model}`
      );
    }
  }
}

// Singleton — all agents share one instance
export const modelRouter = new ModelRouter();
