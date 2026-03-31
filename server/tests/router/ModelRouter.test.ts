import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted: mock instances must exist before ModelRouter module loads,
// because the singleton is created at import time.
const { mockAnthropicCreate, mockGoogleGenerateContent, mockGetGenerativeModel } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockGoogleGenerateContent: vi.fn(),
  // Hoisted so we can restore its mockReturnValue after vi.clearAllMocks()
  mockGetGenerativeModel: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  })),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

vi.mock('../../src/config.js', () => ({
  config: { anthropicKey: 'test-anthropic-key', googleAiKey: 'test-google-key' },
}));

const mockLogModelUsage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/db/modelUsage.js', () => ({ logModelUsage: mockLogModelUsage }));

import { modelRouter } from '../../src/router/ModelRouter.js';
import { MODELS } from '@wildlife-sentinel/shared/models';

// ── helpers ────────────────────────────────────────────────────────────────

function makeAnthropicResponse(text = 'response', inputTokens = 100, outputTokens = 50) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function makeGoogleResponse(text = 'response', promptTokens = 80, candidateTokens = 40) {
  return {
    response: {
      text: () => text,
      usageMetadata: { promptTokenCount: promptTokens, candidatesTokenCount: candidateTokens },
    },
  };
}

// vi.clearAllMocks() wipes mockReturnValue on getGenerativeModel, making it
// return undefined and causing model.generateContent to throw TypeError.
// This helper restores it after each clear.
function restoreGoogleMock() {
  mockGetGenerativeModel.mockReturnValue({ generateContent: mockGoogleGenerateContent });
}

// ── routing ────────────────────────────────────────────────────────────────

describe('routing', () => {
  beforeEach(() => { vi.clearAllMocks(); restoreGoogleMock(); });

  it('throws for an unknown model prefix', async () => {
    await expect(
      modelRouter.complete({ model: 'openai-gpt-4', systemPrompt: 'sys', userMessage: 'msg' })
    ).rejects.toThrow('unknown model prefix');
  });

  it('routes claude-* to Anthropic SDK', async () => {
    mockAnthropicCreate.mockResolvedValueOnce(makeAnthropicResponse());

    await modelRouter.complete({ model: MODELS.CLAUDE_SONNET, systemPrompt: 'sys', userMessage: 'msg' });

    expect(mockAnthropicCreate).toHaveBeenCalledOnce();
    expect(mockGoogleGenerateContent).not.toHaveBeenCalled();
  });

  it('routes gemini-2.5-flash to Google SDK', async () => {
    mockGoogleGenerateContent.mockResolvedValueOnce(makeGoogleResponse());

    await modelRouter.complete({ model: MODELS.GEMINI_FLASH, systemPrompt: 'sys', userMessage: 'msg' });

    expect(mockGoogleGenerateContent).toHaveBeenCalledOnce();
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('routes gemini-2.5-flash-lite to Google SDK', async () => {
    mockGoogleGenerateContent.mockResolvedValueOnce(makeGoogleResponse());

    await modelRouter.complete({ model: MODELS.GEMINI_FLASH_LITE, systemPrompt: 'sys', userMessage: 'msg' });

    expect(mockGoogleGenerateContent).toHaveBeenCalledOnce();
  });
});

// ── response shape ─────────────────────────────────────────────────────────

describe('RouterResponse shape', () => {
  beforeEach(() => { vi.clearAllMocks(); restoreGoogleMock(); });

  it('returns correct shape from Anthropic', async () => {
    mockAnthropicCreate.mockResolvedValueOnce(makeAnthropicResponse('Hello', 100, 50));

    const result = await modelRouter.complete({ model: MODELS.CLAUDE_SONNET, systemPrompt: 's', userMessage: 'u' });

    expect(result.content).toBe('Hello');
    expect(result.model).toBe(MODELS.CLAUDE_SONNET);
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(typeof result.estimatedCostUsd).toBe('number');
  });

  it('returns correct shape from Google', async () => {
    mockGoogleGenerateContent.mockResolvedValueOnce(makeGoogleResponse('World', 80, 40));

    const result = await modelRouter.complete({ model: MODELS.GEMINI_FLASH, systemPrompt: 's', userMessage: 'u' });

    expect(result.content).toBe('World');
    expect(result.model).toBe(MODELS.GEMINI_FLASH);
    expect(result.inputTokens).toBe(80);
    expect(result.outputTokens).toBe(40);
  });

  it('passes jsonMode=true as responseMimeType application/json to Google', async () => {
    mockGoogleGenerateContent.mockResolvedValueOnce(makeGoogleResponse('{}'));

    await modelRouter.complete({
      model: MODELS.GEMINI_FLASH_LITE,
      systemPrompt: 's',
      userMessage: 'u',
      jsonMode: true,
    });

    const callArg = mockGetGenerativeModel.mock.calls[0]?.[0] as {
      generationConfig?: { responseMimeType?: string };
    };
    expect(callArg?.generationConfig?.responseMimeType).toBe('application/json');
  });

  it('uses text/plain when jsonMode is not set', async () => {
    mockGoogleGenerateContent.mockResolvedValueOnce(makeGoogleResponse('text'));

    await modelRouter.complete({ model: MODELS.GEMINI_FLASH, systemPrompt: 's', userMessage: 'u' });

    const callArg = mockGetGenerativeModel.mock.calls[0]?.[0] as {
      generationConfig?: { responseMimeType?: string };
    };
    expect(callArg?.generationConfig?.responseMimeType).toBe('text/plain');
  });
});

// ── cost tracking ──────────────────────────────────────────────────────────

describe('cost tracking', () => {
  beforeEach(() => { vi.clearAllMocks(); restoreGoogleMock(); });

  it('Claude call increases getRunningCostUsd()', async () => {
    // 1M input tokens × $3/M = $3.00
    mockAnthropicCreate.mockResolvedValueOnce(makeAnthropicResponse('x', 1_000_000, 0));

    const before = modelRouter.getRunningCostUsd();
    await modelRouter.complete({ model: MODELS.CLAUDE_SONNET, systemPrompt: 's', userMessage: 'u' });

    expect(modelRouter.getRunningCostUsd() - before).toBeCloseTo(3.0, 1);
  });

  it('Gemini call adds $0 (free-tier pricing)', async () => {
    mockGoogleGenerateContent.mockResolvedValueOnce(makeGoogleResponse('x', 500_000, 500_000));

    const before = modelRouter.getRunningCostUsd();
    await modelRouter.complete({ model: MODELS.GEMINI_FLASH_LITE, systemPrompt: 's', userMessage: 'u' });

    expect(modelRouter.getRunningCostUsd() - before).toBe(0);
  });

  it('calls logModelUsage for every Claude call', async () => {
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse());

    await modelRouter.complete({ model: MODELS.CLAUDE_SONNET, systemPrompt: 's', userMessage: 'u' });
    await modelRouter.complete({ model: MODELS.CLAUDE_SONNET, systemPrompt: 's', userMessage: 'u' });

    expect(mockLogModelUsage).toHaveBeenCalledTimes(2);
  });
});

// ── embed ──────────────────────────────────────────────────────────────────

describe('embed', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('returns a number[][] for a single string input', async () => {
    const mockVector = new Array(768).fill(0.1);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: { values: mockVector } }),
    }));

    const result = await modelRouter.embed('Pongo abelii threats');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(mockVector);
  });

  it('calls fetch once per string in an array', async () => {
    const mockVector = new Array(768).fill(0.2);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: { values: mockVector } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await modelRouter.embed(['query one', 'query two']);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });

  it('throws on a non-retryable fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
    }));

    await expect(modelRouter.embed('test')).rejects.toThrow('ModelRouter embed error 400');
  });
});

// ── Google completion retry logic ──────────────────────────────────────────

describe('Google completion retry logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreGoogleMock();
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries up to 3 times on 429 then throws', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    mockGoogleGenerateContent.mockRejectedValue(err);

    const promise = modelRouter.complete({ model: MODELS.GEMINI_FLASH, systemPrompt: 's', userMessage: 'u' });
    void promise.catch(() => {}); // prevent unhandled rejection warning during timer flush
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow();
    expect(mockGoogleGenerateContent).toHaveBeenCalledTimes(3);
  });

  it('retries on 503 as well', async () => {
    const err = Object.assign(new Error('overloaded'), { status: 503 });
    mockGoogleGenerateContent.mockRejectedValue(err);

    const promise = modelRouter.complete({ model: MODELS.GEMINI_FLASH_LITE, systemPrompt: 's', userMessage: 'u' });
    void promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow();
    expect(mockGoogleGenerateContent).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on non-retryable errors', async () => {
    mockGoogleGenerateContent.mockRejectedValue(new Error('schema mismatch'));

    const promise = modelRouter.complete({ model: MODELS.GEMINI_FLASH, systemPrompt: 's', userMessage: 'u' });
    void promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('schema mismatch');
    expect(mockGoogleGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('succeeds on the second attempt after a 429', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    mockGoogleGenerateContent
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(makeGoogleResponse('recovered'));

    const promise = modelRouter.complete({ model: MODELS.GEMINI_FLASH, systemPrompt: 's', userMessage: 'u' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.content).toBe('recovered');
    expect(mockGoogleGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('logs a [model-router] warning per retry attempt', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    mockGoogleGenerateContent.mockRejectedValue(err);

    const promise = modelRouter.complete({ model: MODELS.GEMINI_FLASH, systemPrompt: 's', userMessage: 'u' });
    void promise.catch(() => {});
    await vi.runAllTimersAsync();
    await promise.catch(() => undefined);

    const retryWarns = vi.mocked(console.warn).mock.calls.filter(
      call => String(call[0]).includes('[model-router]') && String(call[0]).includes('retrying')
    );
    expect(retryWarns.length).toBe(2); // attempt 1 and 2 retry; attempt 3 throws
  });
});

// ── embed retry logic ──────────────────────────────────────────────────────

describe('embed retry logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries embed 3 times on 429 then throws', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => '{"error":{"details":[]}}',
    });
    vi.stubGlobal('fetch', mockFetch);

    const promise = modelRouter.embed('test query');
    void promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('ModelRouter embed error 429');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('succeeds on the second embed attempt after a 429', async () => {
    const mockVector = new Array(768).fill(0.5);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => '{"error":{"details":[]}}',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: { values: mockVector } }),
      })
    );

    const promise = modelRouter.embed('test query');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result[0]).toEqual(mockVector);
  });
});
