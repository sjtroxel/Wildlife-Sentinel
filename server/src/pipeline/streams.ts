import { redis } from '../redis/client.js';

export const STREAMS = {
  RAW: 'disaster:raw',
  ENRICHED: 'disaster:enriched',
  ASSESSED: 'alerts:assessed',
  DISCORD: 'discord:queue',
} as const;

export const CONSUMER_GROUPS = {
  ENRICHMENT: 'enrichment-group',
  HABITAT: 'habitat-group',
  SPECIES: 'species-group',
  THREAT: 'threat-group',
  SYNTHESIS: 'synthesis-group',
  DISCORD: 'discord-group',
} as const;

export type StreamName = (typeof STREAMS)[keyof typeof STREAMS];
export type ConsumerGroup = (typeof CONSUMER_GROUPS)[keyof typeof CONSUMER_GROUPS];

/**
 * Create a Redis consumer group if it doesn't already exist.
 * BUSYGROUP error = group exists = safe to ignore.
 * Call this at startup in every consumer agent before processing.
 */
export async function ensureConsumerGroup(
  stream: StreamName,
  group: ConsumerGroup
): Promise<void> {
  try {
    await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
  } catch (err) {
    if (err instanceof Error && err.message.includes('BUSYGROUP')) return;
    throw err;
  }
}
