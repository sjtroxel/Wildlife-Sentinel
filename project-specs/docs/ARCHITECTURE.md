# Wildlife Sentinel — System Architecture

## System Overview

Wildlife Sentinel is a push-model, event-driven system. No user triggers it. Disaster events from government APIs trigger it. The world is the input.

```
┌─────────────────────────────────────────────────────┐
│                    SCOUT LAYER                       │
│  [NASA FIRMS] [NOAA NHC] [USGS] [Drought] [Coral]  │
│   cron-scheduled, no LLM, pure data fetch+normalize  │
└──────────────────────┬──────────────────────────────┘
                       │ XADD
                       ▼
              Redis Stream: disaster:raw
                       │ XREADGROUP
                       ▼
┌─────────────────────────────────────────────────────┐
│              ENRICHMENT LAYER                        │
│  PostGIS: ST_DWithin(habitat, event, 75km)          │
│  → no overlap? DROP event (log to pipeline_events)  │
│  → overlap? attach Open-Meteo weather               │
│  Gemini 2.5 Flash-Lite: weather_summary text        │
└──────────────────────┬──────────────────────────────┘
                       │ XADD
                       ▼
            Redis Stream: disaster:enriched
               │ XREADGROUP       │ XREADGROUP
               ▼                  ▼
┌──────────────────────┐  ┌──────────────────────────┐
│   HABITAT AGENT      │  │  SPECIES CONTEXT AGENT   │
│  Gemini 2.5 Flash-Lite│  │  Gemini 2.5 Flash        │
│  GBIF occurrence API  │  │  RAG: species_facts index │
│  recent sightings     │  │  species brief generation │
└──────────┬───────────┘  └────────────┬─────────────┘
           │ results attached           │ results attached
           └────────────┬──────────────┘
                        │ XADD
                        ▼
              Redis Stream: alerts:assessed  (actually: combined enriched data)
                        │ XREADGROUP
                        ▼
┌─────────────────────────────────────────────────────┐
│           THREAT ASSESSMENT AGENT                    │
│  Claude Sonnet 4.6                                  │
│  System prompt from agent_prompts DB table          │
│  (updateable by Refiner agent)                      │
│  Output: threat_level, prediction, confidence_score  │
│  Confidence: computed from observable fields only    │
└──────────────────────┬──────────────────────────────┘
                       │ XADD
                       ▼
             Redis Stream: alerts:assessed
                       │ XREADGROUP
                       ▼
┌─────────────────────────────────────────────────────┐
│              SYNTHESIS AGENT                         │
│  Claude Sonnet 4.6                                  │
│  RAG: conservation_context index                    │
│  Discord embed construction                          │
│  'low' → DROP | 'critical' → HITL | else → auto    │
└──────────────────────┬──────────────────────────────┘
                       │ XADD
                       ▼
             Redis Stream: discord:queue
                       │ XREADGROUP
                       ▼
┌─────────────────────────────────────────────────────┐
│              DISCORD PUBLISHER                       │
│  discord.js v14                                      │
│  #wildlife-alerts (public) or #sentinel-ops (HITL)  │
│  War room logs → #sentinel-ops                       │
└─────────────────────────────────────────────────────┘
                       │
                       ▼ (24h + 48h later)
┌─────────────────────────────────────────────────────┐
│           REFINER / EVALUATOR AGENT                  │
│  Claude Sonnet 4.6                                  │
│  Deterministic scoring (0-1) from real-world data   │
│  < 0.60: generate correction note → update          │
│          agent_prompts table                         │
│  Always: log to refiner_scores table                 │
└─────────────────────────────────────────────────────┘
```

## Key Design Decisions

### Pipeline Pattern (not Conversation)
Agents publish to streams and walk away. No agent calls another agent directly. This is a factory conveyor belt. Resilient to individual agent crashes.

### Drop Logic at Enrichment
The PostGIS habitat check happens before any LLM call. Events with no habitat overlap are dropped at this stage — this is why the free tier LLM limits are sufficient. Most fire events globally are NOT near critical habitats.

### System Prompt in Database
The Threat Assessment Agent's system prompt lives in the `agent_prompts` table, not hardcoded. The Refiner updates it when predictions are poor. Each update increments the version column — full audit trail of prompt evolution.

### Confidence Scoring
Computed from observable fields (data completeness, source quality, habitat certainty). Never self-reported. See `.claude/rules/agents.md`.

### ModelRouter Singleton
The only file that imports AI SDKs. All agents call `modelRouter.complete()` and `modelRouter.embed()`. Model strings imported from `shared/models.ts`. Cost tracked per call.

## Process Model (Railway)

Single Node.js process:
- Express HTTP server (API + SSE)
- discord.js bot (event-driven)
- Scout cron jobs (node-cron, scheduled)
- Redis stream consumers (long-running async loops)

All running in the same process on Railway. Scaled vertically if needed.

## External Dependencies

| Service | Purpose | Auth | Cost |
|---|---|---|---|
| NASA FIRMS | Wildfire data | Free API key | Free |
| NOAA NHC | Storm data | None | Free |
| USGS NWIS | Flood gauge data | None | Free |
| US Drought Monitor | Drought severity | None | Free |
| NOAA Coral Reef Watch | Coral bleaching | None | Free |
| IUCN Red List | Species range polygons (shapefile, pre-loaded into PostGIS) | Free token (portal only) | Free |
| GBIF | Species narrative text (ingest) + recent sightings (live queries) | None | Free |
| Wikipedia (MediaWiki) | Species narrative fallback for ingest (when GBIF returns <2 sections) | None | Free |
| Open-Meteo | Weather enrichment | None | Free |
| Google AI (Gemini 2.5) | Enrichment + species agents | API key | Free tier |
| Anthropic (Claude Sonnet 4.6) | Threat + synthesis + refiner | API key | ~$2-8/month |
| Neon | PostgreSQL + PostGIS + pgvector | Connection string | Free tier (3GB) |
| Railway | Hosting (server + Redis) | Account | Free tier ($5/mo credit) |
| Vercel | Frontend hosting | Account | Free tier |
| Discord | Bot platform | Bot token | Free |
