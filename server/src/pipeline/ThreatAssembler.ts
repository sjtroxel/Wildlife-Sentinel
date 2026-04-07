/**
 * ThreatAssembler — fan-in coordinator for the Habitat + Species Context agents.
 *
 * Both agents consume disaster:enriched in parallel. Each stores its result
 * in a Redis hash keyed by event ID. When all three parts are present
 * (event + habitat + species), the assembler publishes the FullyEnrichedEvent
 * to alerts:assessed and clears the hash.
 *
 * TTL of 3600s (1 hour) ensures partial hashes survive species-context backlogs.
 * Species-context processes 17-20 species sequentially (~90s per event × up to 6
 * events per batch = up to 9 min per batch). A 1-hour TTL prevents the death
 * spiral where species-context falls behind and all hashes expire.
 */
import type { EnrichedDisasterEvent, FullyEnrichedEvent, GBIFSighting, SpeciesBrief } from '@wildlife-sentinel/shared/types';
import { redis } from '../redis/client.js';
import { STREAMS } from '../pipeline/streams.js';
import { logToWarRoom } from '../discord/warRoom.js';

const ASSEMBLY_TTL_SECONDS = 86_400; // 24h — allows SpeciesContextAgent to clear deep backlogs

function assemblyKey(eventId: string): string {
  return `assembly:${eventId}`;
}

export interface HabitatAssemblyResult {
  gbif_recent_sightings: GBIFSighting[];
  sighting_confidence: 'confirmed' | 'possible' | 'historical_only';
  most_recent_sighting: string | null;
}

export interface SpeciesAssemblyResult {
  species_briefs: SpeciesBrief[];
}

export async function storeEventForAssembly(eventId: string, event: EnrichedDisasterEvent): Promise<void> {
  const key = assemblyKey(eventId);
  await redis.hset(key, 'event', JSON.stringify(event));
  await redis.expire(key, ASSEMBLY_TTL_SECONDS);
}

export async function storeHabitatResult(eventId: string, result: HabitatAssemblyResult): Promise<void> {
  const key = assemblyKey(eventId);
  await redis.hset(key, 'habitat', JSON.stringify(result));
  await redis.expire(key, ASSEMBLY_TTL_SECONDS);
  await tryAssemble(eventId);
}

export async function storeSpeciesResult(eventId: string, result: SpeciesAssemblyResult): Promise<void> {
  const key = assemblyKey(eventId);
  await redis.hset(key, 'species', JSON.stringify(result));
  await redis.expire(key, ASSEMBLY_TTL_SECONDS);
  await tryAssemble(eventId);
}

async function tryAssemble(eventId: string): Promise<void> {
  const key = assemblyKey(eventId);
  const stored = await redis.hgetall(key);

  if (!stored['event'] || !stored['habitat'] || !stored['species']) {
    const hasEvent   = Boolean(stored['event']);
    const hasHabitat = Boolean(stored['habitat']);
    const hasSpecies = Boolean(stored['species']);

    // If both downstream agents finished but the event was never stored, the
    // assembly will never complete. This is the specific failure mode where an
    // old backlog event was processed without a call to storeEventForAssembly.
    if (hasHabitat && hasSpecies && !hasEvent) {
      console.warn(`[assembler] WARN ${eventId}: habitat+species present but NO event field — backlog event processed without assembly hash`);
      await logToWarRoom({
        agent: 'assembler',
        action: 'WARN: orphaned hash',
        detail: `${eventId} — habitat ✅ species ✅ event ❌. Old backlog message processed without storeEventForAssembly.`,
        level: 'warning',
      });
    } else {
      // Normal partial state: one agent finished, waiting on the other.
      const present = [hasEvent && 'event', hasHabitat && 'habitat', hasSpecies && 'species'].filter(Boolean).join('+');
      console.log(`[assembler] ${eventId}: partial (${present || 'none'}) — waiting`);
    }
    return;
  }

  const event = JSON.parse(stored['event']) as EnrichedDisasterEvent;
  const habitat = JSON.parse(stored['habitat']) as HabitatAssemblyResult;
  const species = JSON.parse(stored['species']) as SpeciesAssemblyResult;

  const fullyEnriched: FullyEnrichedEvent = {
    ...event,
    gbif_recent_sightings: habitat.gbif_recent_sightings,
    species_briefs: species.species_briefs,
    sighting_confidence: habitat.sighting_confidence,
    most_recent_sighting: habitat.most_recent_sighting,
  };

  await redis.xadd(STREAMS.ASSESSED, '*', 'data', JSON.stringify(fullyEnriched));
  await redis.del(key);

  console.log(`[assembler] ${eventId} | assembled + published to alerts:assessed`);

  await logToWarRoom({
    agent: 'assembler',
    action: 'assembled',
    detail: `${fullyEnriched.species_at_risk.length} species | ${fullyEnriched.event_type} | ${fullyEnriched.source} → alerts:assessed`,
  });
}
