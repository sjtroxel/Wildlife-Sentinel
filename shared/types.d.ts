// Core pipeline types — grow each phase.

export type DisasterSource =
  | 'nasa_firms'
  | 'noaa_nhc'
  | 'gdacs'
  | 'gdacs_flood'
  | 'gdacs_drought'
  | 'usgs_nwis'
  | 'drought_monitor'
  | 'coral_reef_watch';

export type EventType =
  | 'wildfire'
  | 'tropical_storm'
  | 'flood'
  | 'drought'
  | 'coral_bleaching';

export type ThreatLevel = 'low' | 'medium' | 'high' | 'critical';

export type IUCNStatus = 'EX' | 'EW' | 'CR' | 'EN' | 'VU' | 'NT' | 'LC';

// Phase 0 stubs — expanded in later phases

export interface RawDisasterEvent {
  id: string;
  source: DisasterSource;
  event_type: EventType;
  coordinates: { lat: number; lng: number };
  severity: number;       // 0-1 normalized
  timestamp: string;      // ISO 8601 UTC
  raw_data: Record<string, unknown>;
}

export interface EnrichedDisasterEvent extends RawDisasterEvent {
  wind_direction: number | null;
  wind_speed: number | null;
  precipitation_probability: number | null;
  weather_summary: string;
  nearby_habitat_ids: string[];
  species_at_risk: string[];
  habitat_distance_km: number;
}

export interface GBIFSighting {
  speciesName: string;
  decimalLatitude: number;
  decimalLongitude: number;
  eventDate: string;
  datasetName: string;
  occurrenceID: string;
}

export interface SpeciesBrief {
  species_name: string;
  common_name: string;
  iucn_status: IUCNStatus;
  population_estimate: string | null;
  primary_threats: string[];
  habitat_description: string;
  source_documents: string[];
}

export interface FullyEnrichedEvent extends EnrichedDisasterEvent {
  gbif_recent_sightings: GBIFSighting[];
  species_briefs: SpeciesBrief[];
  sighting_confidence: 'confirmed' | 'possible' | 'historical_only';
  most_recent_sighting: string | null;
}

export interface AssessedAlert extends FullyEnrichedEvent {
  threat_level: ThreatLevel;
  predicted_impact: string;
  compounding_factors: string[];
  recommended_action: string;
  confidence_score: number;       // 0-1, computed from observable fields
  prediction_timestamp: string;   // used by Refiner
  sources: string[];
  db_alert_id: string;            // UUID from alerts table — used for discord_message_id update
}

export interface RouterRequest {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}

export interface RouterResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface DiscordQueueItem {
  alert_id: string;
  channel: 'wildlife-alerts' | 'sentinel-ops-review';
  embed: Record<string, unknown>;
  threat_level: ThreatLevel;
  stored_alert_id: string;
}

export interface AgentOutput {
  status: 'success' | 'partial' | 'failed';
  confidence: number;
  sources: string[];
  error?: string;
}

export interface RefinerScore {
  directionAccuracy: number;
  magnitudeAccuracy: number;
  compositeScore: number;   // 0.6 * direction + 0.4 * magnitude
}

// Phase 6: RAG retrieval result types

export interface SpeciesFactChunk {
  id: string;
  content: string;
  section_type: string;
  source_document: string;
  similarity: number;
}

export interface ConservationContextChunk {
  id: string;
  content: string;
  document_title: string;
  source_document: string;
  similarity: number;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  db: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  discord: 'connected' | 'disconnected';
  uptime_seconds: number;
  timestamp: string;
}

// DB row types returned by the API (Phase 8)

export interface AlertRow {
  id: string;
  source: DisasterSource;
  event_type: EventType;
  coordinates: { lat: number; lng: number };
  severity: number | null;
  threat_level: ThreatLevel | null;
  confidence_score: number | null;
  enrichment_data: Record<string, unknown> | null;
  created_at: string;
  discord_message_id: string | null;
}

export interface RefinerScoreRow {
  composite_score: number;
  direction_accuracy: number;
  magnitude_accuracy: number;
  evaluation_time: string;
  evaluated_at: string;
  event_type: EventType;
  source: DisasterSource;
}

export interface BboxQuery {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}
