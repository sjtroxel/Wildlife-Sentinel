/**
 * All AI model strings live here. NEVER hardcode in agent files.
 *
 * Gemini 1.5 and 2.0 families were discontinued Oct 2025.
 * Current stable family is 2.5.
 */
export const MODELS = {
  // Quality-critical agents — ~$3/M input, $15/M output
  CLAUDE_SONNET: 'claude-sonnet-4-6',

  // Species Context Agent — free tier: 10 RPM / 250 RPD
  GEMINI_FLASH: 'gemini-2.5-flash',

  // Enrichment + Habitat agents — free tier: 15 RPM / 1,000 RPD
  GEMINI_FLASH_LITE: 'gemini-2.5-flash-lite',

  // RAG embeddings — 768 dimensions, free tier
  GOOGLE_EMBEDDINGS: 'text-embedding-004',
} as const;

export type ModelName = (typeof MODELS)[keyof typeof MODELS];
