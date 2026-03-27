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

// Pricing per million tokens (March 2026)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':     { input: 3.00,  output: 15.00 },
  'gemini-2.5-flash':      { input: 0.00,  output: 0.00 },  // free tier
  'gemini-2.5-flash-lite': { input: 0.00,  output: 0.00 },  // free tier
  'text-embedding-004':    { input: 0.00,  output: 0.00 },
};

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
    const model = this.google.getGenerativeModel({ model: MODELS.GOOGLE_EMBEDDINGS });

    const embeddings: number[][] = [];
    for (const input of inputs) {
      const result = await model.embedContent(input);
      embeddings.push(result.embedding.values);
    }
    return embeddings;
  }

  getRunningCostUsd(): number {
    return this.runningCostUsd;
  }

  private async completeAnthropic(request: RouterRequest): Promise<RouterResponse> {
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

    await this.trackUsage(request.model, inputTokens, outputTokens, cost);
    return { content: content.text, model: request.model, inputTokens, outputTokens, estimatedCostUsd: cost };
  }

  private async completeGoogle(request: RouterRequest): Promise<RouterResponse> {
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
    const text = result.response.text();
    const usage = result.response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;
    const cost = this.calculateCost(request.model, inputTokens, outputTokens);

    await this.trackUsage(request.model, inputTokens, outputTokens, cost);
    return { content: text, model: request.model, inputTokens, outputTokens, estimatedCostUsd: cost };
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
