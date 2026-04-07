/**
 * All AI model strings live here. NEVER hardcode in agent files.
 *
 * Gemini 1.5 and 2.0 families were discontinued Oct 2025.
 * Current stable family is 2.5.
 */
export const MODELS = {
  // Quality-critical agents (kept for ModelRouter routing tests and future use)
  CLAUDE_SONNET: 'claude-sonnet-4-6',

  // Active agent model — ~$0.80/M input, $4/M output (~3.75x cheaper than Sonnet)
  CLAUDE_HAIKU: 'claude-haiku-4-5-20251001',

  // Species Context Agent — Tier 1 (paid): ~1,500 RPD / 30 RPM. $0.30/1M input.
  GEMINI_FLASH: 'gemini-2.5-flash',

  // Enrichment + Habitat agents — Tier 1 (paid): ~1,500 RPD / 30 RPM. $0.10/1M input.
  GEMINI_FLASH_LITE: 'gemini-2.5-flash-lite',

  // RAG embeddings — 3072 dimensions, free tier (v1beta API)
  GOOGLE_EMBEDDINGS: 'gemini-embedding-001',
} as const;

export type ModelName = (typeof MODELS)[keyof typeof MODELS];
