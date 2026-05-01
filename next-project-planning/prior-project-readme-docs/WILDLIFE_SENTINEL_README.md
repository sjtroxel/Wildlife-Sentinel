# Wildlife Sentinel

**A 24/7 autonomous intelligence system that monitors 12 real-time global disaster streams, correlates every event against 1,372 critically endangered species ranges stored in PostGIS, and fires a multi-agent AI swarm when wildlife is at risk.**

Primary output: a Discord bot that posts structured, evidence-grounded wildlife threat alerts.  
Secondary output: a read-only Next.js web dashboard with a live Leaflet map.

The system runs continuously without human intervention. The world triggers it.

---

## What This Does

When a wildfire ignites in Sumatra, Wildlife Sentinel doesn't just log it — it determines *which species* are threatened, *how far* the fire is from their habitat boundary, *what the wind is doing*, and whether the predicted spread direction will enter critical habitat in the next 24 hours. It then generates a Discord alert, scores the accuracy of its own prediction the following day, and updates the Threat Assessment Agent's system prompt if it was wrong.

That self-correction loop is not a demo feature. It runs every hour on a production server.

---

## Architecture Overview

```
[12 Scout Agents — cron pollers, no LLM]
  NASA FIRMS (wildfire)    NOAA NHC (storms)       USGS NWIS (floods)
  US Drought Monitor       NOAA Coral Reef Watch    GDACS RSS (global)
  USGS Earthquakes (M5.5+) GFW GLAD (deforestation) NSIDC Sea Ice
  NOAA GTA (temperature)   NOAA CPC (ENSO/El Niño)  GFW (illegal fishing)
        │
        ▼
  Redis Stream: disaster:raw
  { source, event_type, coordinates, severity, timestamp, raw_data }
        │
        ▼ [Enrichment Agent — Gemini 2.5 Flash-Lite]
  PostGIS ST_DWithin → habitat overlap (75km radius)
  Open-Meteo → wind direction, speed, precipitation probability
  ── No habitat overlap within 75km? DROP event ──
        │
        ▼
  Redis Stream: disaster:enriched
  { ...raw + wind_data, nearby_habitat_ids[], species_at_risk[], habitat_distance_km }
        │
        ├──► [Habitat Agent — Gemini 2.5 Flash-Lite] → GBIF recent sightings
        └──► [Species Context Agent — Gemini 2.5 Flash + RAG] → species briefs
        │
        └── ThreatAssembler fan-in: waits for both agents, then publishes ──►
        │
        ▼ [Threat Assessment Agent — Claude Haiku 4.5]
  Redis Stream: alerts:assessed
  { ...enriched + threat_level, predicted_impact, confidence_score, compounding_factors }
        │
        ▼ [Synthesis Agent — Claude Haiku 4.5 + RAG]
  Redis Stream: discord:queue
  ── threat_level 'low'? → DROP (DB log only) ──
  ── 'medium'/'high'? → #wildlife-alerts (HITL review) ──
  ── 'critical'? → #sentinel-ops (HITL review, ✅ to approve) ──
        │
        ▼ [Refiner/Evaluator — runs 24h + 48h after each alert]
  Compares prediction vs actual NASA FIRMS / NOAA / USGS data
  Score < 0.60 → generates Correction Note → updates system prompt in DB
  Logs composite score to refiner_scores table (visible on web dashboard)
```

The pipeline is a true message bus — not agents calling each other. Each stage publishes to a Redis Stream and walks away. Downstream agents subscribe independently. If one crashes, messages queue and wait. This is the industry-standard pattern for resilient, asynchronous AI pipelines.

---

## Disaster Data Sources

All 12 sources are government or major scientific institution APIs. No third-party data aggregators. No hallucination risk at the source layer.

| Scout | Source | Event Type | Schedule | What Triggers a Pipeline Entry |
|---|---|---|---|---|
| **FirmsScout** | NASA FIRMS (VIIRS/MODIS NRT) | Wildfire | Every 10 min | Fire Radiative Power ≥ 25 MW |
| **NhcScout** | NOAA National Hurricane Center | Tropical storm | Every 30 min | Active named storm advisory |
| **UsgsScout** | USGS NWIS (150+ gauges) | Flood | Every 15 min | River gauge crosses flood stage |
| **DroughtScout** | US Drought Monitor | Drought | Weekly (Thursdays) | D3/D4 severity escalation |
| **CoralScout** | NOAA Coral Reef Watch | Coral bleaching | Every 6 hours | Bleaching Alert Level 1 or higher |
| **GdacsRssScout** | GDACS RSS (global) | Cyclone / Flood / Drought / Volcano | Every 2 hours | New GDACS event alert |
| **UsgsEarthquakeScout** | USGS FDSN | Earthquake | Every 30 min | Magnitude ≥ 5.5 |
| **GladDeforestationScout** | Global Forest Watch GLAD | Deforestation | Daily | ≥ 20 GLAD alerts/day in ADM1 region |
| **NsidcSeaIceScout** | NSIDC NRT Sea Ice Index | Sea ice loss | Daily | Extent anomaly < −0.75σ |
| **NoaaGtaScout** | NOAA Global Temperature Anomaly | Climate anomaly | Monthly | 12-month rolling avg ≥ 1.5°C |
| **NoaaCpcEnsoScout** | NOAA CPC ONI Index | Climate anomaly (ENSO) | Monthly | El Niño / La Niña phase shift |
| **GfwFishingScout** | Global Fishing Watch Events v3 | Illegal fishing | Daily | AIS vessel detected inside MPA boundary |

All scouts extend `BaseScout`, which provides:
- Circuit breaker (opens after N consecutive failures, auto-resets)
- Weekly deduplication keyed per event/region
- Exponential backoff retry on transient failures
- No LLM inference — pure TypeScript data normalization

---

## The Intelligence Pipeline

### Enrichment Agent (Gemini 2.5 Flash-Lite)
Consumes every event from `disaster:raw`. Runs a PostGIS `ST_DWithin` query against 1,372 IUCN species range polygons to find habitat within 75km of the disaster coordinates. Attaches Open-Meteo wind and precipitation data. Events with no habitat overlap are dropped here — roughly 70–80% of all global events never enter the intelligence pipeline.

### Habitat Agent (Gemini 2.5 Flash-Lite)
Queries the GBIF Occurrence API for confirmed species sightings within the disaster radius over the past 10 years. Distinguishes between "historically possible" (range polygon only) and "recently confirmed" (GBIF sighting within 2 years). Feeds into the Threat Assembler.

### Species Context Agent (Gemini 2.5 Flash + RAG)
Retrieves grounded ecological facts from the `species_facts` vector index — 750 species entries chunked by topic (habitat, diet, threats, conservation status, population, ecology). Uses 768-dimensional Google embeddings with 0.40 cosine similarity threshold. Agents may only cite facts from retrieved chunks; if retrieval score is below threshold, they must state "insufficient context" rather than fabricate biology.

### Threat Assessment Agent (Claude Haiku 4.5)
The reasoning core. Reads the fully assembled event — disaster type, severity, species at risk, habitat distance, wind trajectory, GBIF presence confidence, RAG-grounded species brief, and any active Correction Notes from prior Refiner evaluations. Produces:
- `threat_level`: low / medium / high / critical
- `predicted_impact`: concrete spread/intensity prediction (what happens in 24–48h)
- `confidence_score`: 0–1, computed from observable fields only — never self-reported
- `compounding_factors`: e.g. "species at historic population low", "active breeding season"

System prompt is stored in the `agent_prompts` database table and is updated automatically by the Refiner when predictions score below 0.60.

### Synthesis Agent (Claude Haiku 4.5 + RAG)
Generates the final Discord embed. Queries both the `species_facts` and `conservation_context` RAG indices for the "why this matters" narrative frame. Matches the alert to pre-vetted conservation charities from the `charities` table. Routes based on threat level:
- `low` → DB log only, no Discord post
- `medium` / `high` → posts to #wildlife-alerts after HITL review
- `critical` → posts to #sentinel-ops for ✅ reaction approval before public posting

### ThreatAssembler (fan-in coordinator)
Coordinates the parallel Habitat + Species Context agents. Waits up to 20 minutes for both to complete before publishing to `alerts:assessed`. Handles partial assembly (one agent slow or failed) with configurable timeouts.

---

## The Learning Loop

This is a first-class feature, not an afterthought.

24 hours after every fire, storm, flood, coral, and seismic alert, the **Refiner/Evaluator** agent wakes up and:

1. Pulls the original prediction from the database: *"Fire predicted to spread NW by 40km in 24h based on 28 km/h NW wind."*
2. Queries the actual data from the same source: NASA FIRMS fire perimeter, NOAA storm track, USGS gauge readings.
3. Computes accuracy with deterministic math — no LLM self-assessment:

```
composite_score = 0.6 × direction_accuracy + 0.4 × magnitude_accuracy

direction_accuracy:  1.0 = actual bearing within 15°  of predicted
magnitude_accuracy:  1.0 = actual area/intensity within 20% of predicted
```

4. If `composite_score < 0.60`: Claude Haiku analyzes which input variables were present when the prediction failed and generates a targeted Correction Note — for example, *"Upslope wind convergence in steep terrain overrides reported surface wind speed. Apply 1.5× multiplier when terrain slope > 15° in direction of spread."*

5. The Correction Note is prepended to the Threat Assessment Agent's system prompt in the `agent_prompts` table. Every future alert in that category runs with the accumulated correction history.

6. Scores are logged to `refiner_scores` and rendered as a live accuracy trend chart on the web dashboard. The system's improving prediction quality is visible.

The Refiner runs 48 hours post-alert as well, capturing lagging data sources (FIRMS sometimes takes 36+ hours to fully map a fire perimeter).

---

## Species & Habitat Data

**1,372 species** from the IUCN Red List — Critically Endangered and Endangered — loaded into PostGIS as geometry polygons from the official IUCN terrestrial mammal shapefiles.

```sql
-- The core query behind every enrichment decision
SELECT
  s.species_name, s.common_name, s.iucn_status,
  ST_Distance(s.geom::geography, ST_Point($1, $2)::geography) / 1000 AS distance_km
FROM species_ranges s
WHERE ST_DWithin(
  s.geom::geography,
  ST_Point($1, $2)::geography,  -- $1=lng, $2=lat (PostGIS order)
  75000                          -- 75km in meters
)
ORDER BY distance_km ASC;
```

A GIST spatial index makes these queries fast enough to run on every incoming disaster event in real time.

GBIF provides live occurrence cross-reference. IUCN tells us where a species *should* be; GBIF confirms where it has *actually been seen* recently. The Threat Assessment Agent weighs both.

---

## Discord Bot

The primary user interface. 9 slash commands registered via discord.js v14:

| Command | What It Does |
|---|---|
| `/status` | Pipeline health: running, paused, scout circuit states |
| `/pause` / `/resume` | Emergency pipeline control — stops all scouts from publishing |
| `/species [name]` | Look up a monitored species (autocomplete from 1,372 species) |
| `/trends [days]` | Alert frequency by event type over 7/14/30/90 days |
| `/refiner` | Prediction accuracy stats: queue depth, correction history, avg score |
| `/digest` | Preview the weekly summary (normally posts every Sunday) |
| `/donate [species] [type]` | Find vetted charities matched to a species or disaster type |
| `/help` | What Wildlife Sentinel is and how to read its alerts |

**Alert embed format:**
```
🔥 Sumatran Orangutan — HIGH THREAT

In Sumatra's Leuser Ecosystem, a rapidly expanding wildfire is now 18km
from critical Pongo abelii habitat. With NW winds at 24 km/h and the dry
season at peak, the fire is projected to reach habitat boundaries within
36 hours. Orangutan populations in this corridor are at a 40-year low.

Disaster   Wildfire (NASA FIRMS)          Distance  18.3 km from habitat
Confidence 84%                            Wind      24 km/h NW

At-Risk Species   Sumatran Orangutan, Sumatran Tiger, Sunda Pangolin
IUCN Status       Critically Endangered

💛 How You Can Help
Orangutan Foundation International — donate.orangutan.org
Wildlife Conservation Society — wcs.org/donate
Sumatran Orangutan Society — orangutans-sos.org

Wildlife Sentinel • Data: NASA FIRMS / NOAA / USGS / IUCN
```

**HITL (Human-in-the-Loop) for critical alerts:** `critical` threat events post to `#sentinel-ops` with a ✅ reaction. A human must approve before the alert is reposted to the public `#wildlife-alerts` channel. This gate is intentional — critical alerts imply imminent habitat impact and deserve human review.

---

## Web Dashboard

Built with Next.js 15 (App Router), Tailwind CSS v4, Leaflet.js, and Recharts. Deployed on Vercel. Mobile-first, publicly accessible with no authentication.

**Pages:**
- **Home** (`/`) — Live Leaflet map with disaster events color-coded by type and sized by severity, alongside the recent alerts feed, a real-time Agent Activity SSE panel, and the Refiner accuracy trend chart
- **Alerts** (`/alerts`) — Full alert archive, filterable by event type, threat level, and date range
- **Alert Detail** (`/alerts/[id]`) — Single alert with habitat map, species info, predicted vs. actual comparison, and "How You Can Help" charity section
- **Species** (`/species`) — Searchable index of all 1,372 monitored species
- **Species Profile** (`/species/[slug]`) — IUCN status, population trend, range map, recent alerts for that species, and matched conservation organizations
- **Charities** (`/charities`) — Directory of 30 vetted conservation organizations with Charity Navigator ratings, filterable by focus region

**Design decisions:**
- Leaflet maps use `dynamic(() => import(...), { ssr: false })` — Leaflet requires the browser DOM and will crash Next.js SSR if imported server-side
- Dark mode defaults to system preference, manual toggle persisted in localStorage
- Resizable panels (react-resizable-panels v4) — map and sidebar panels are draggable on desktop
- Agent Activity panel uses `EventSource` → `/api/agent-activity/sse` → Redis subscriber — the same SSE observability pattern as the prior Asteroid Bonanza project

**Event color coding (consistent across map markers and UI badges):**

| Event Type | Color |
|---|---|
| Wildfire | Red `#ef4444` |
| Tropical storm | Blue `#3b82f6` |
| Flood | Cyan `#06b6d4` |
| Drought | Amber `#f59e0b` |
| Coral bleaching | Teal `#14b8a6` |
| Earthquake | Orange `#f97316` |
| Deforestation | Lime `#84cc16` |
| Sea ice loss | Indigo `#6366f1` |
| Illegal fishing | Purple `#a855f7` |

---

## Tech Stack

| Component | Choice | Notes |
|---|---|---|
| **Language** | TypeScript strict | `strict: true`, `noUncheckedIndexedAccess: true` everywhere |
| **Module resolution** | NodeNext | All relative imports use `.js` extensions |
| **Backend** | Express 5 | `app.ts` (no listen) / `server.ts` (calls listen) — required for Vitest |
| **Monorepo** | npm workspaces | `server/`, `client/`, `shared/`, `scripts/` |
| **Discord** | discord.js v14 | Bot only; no user authentication |
| **Redis** | ioredis | Streams (XADD / XREADGROUP / XACK), circuit breaker state, dedup keys |
| **Database** | Neon (PostgreSQL) | PostGIS for spatial queries, pgvector for RAG |
| **Spatial queries** | PostGIS | `ST_DWithin`, `ST_Distance`, GIST-indexed geometry columns |
| **Vector embeddings** | Google `gemini-embedding-001` | 768 dimensions, same model at ingest and query time |
| **AI: volume tasks** | Gemini 2.5 Flash-Lite | Enrichment + Habitat agents — $0.10/1M input |
| **AI: mid-tier** | Gemini 2.5 Flash | Species Context Agent — $0.30/1M input |
| **AI: reasoning** | Claude Haiku 4.5 | Threat Assessment + Synthesis + Refiner — ~3.75× cheaper than Sonnet |
| **AI architecture** | Direct SDK, no LangChain | `@anthropic-ai/sdk`, `@google/generative-ai`, custom `ModelRouter.ts` |
| **Frontend** | Next.js 15 (App Router) | Read-only; mobile-first; deployed to Vercel |
| **Maps** | Leaflet.js | 2D geospatial; dynamic import for SSR compatibility |
| **Charts** | Recharts | Refiner accuracy trend + event breakdown |
| **Hosting** | Railway (backend) + Vercel (frontend) | Redis on Railway; Neon independent |
| **CI** | GitHub Actions | lint + typecheck + Vitest + Playwright on every push |

---

## Database Schema

9 migrations, applied sequentially via a custom migration runner in `scripts/migrate.ts`.

| Table | Purpose |
|---|---|
| `species_ranges` | 1,372 IUCN habitat polygons (PostGIS MULTIPOLYGON geometry) |
| `alerts` | Every assessed alert with threat level, prediction, confidence score, Discord message ID |
| `pipeline_events` | Audit trail — every event's journey through each pipeline stage |
| `model_usage` | Per-call token cost tracking across all three AI providers |
| `agent_prompts` | Threat Assessment, Synthesis, and Refiner system prompts — updated by Refiner |
| `species_facts` | RAG index: 750 species × multiple section types (768-dim pgvector) |
| `conservation_context` | RAG index: 38 chunks from WWF/IPBES conservation reports (768-dim pgvector) |
| `refiner_queue` | Scheduled 24h/48h evaluations pending for each alert |
| `refiner_scores` | Prediction accuracy per alert: direction accuracy, magnitude accuracy, composite score |
| `charities` | 30 vetted conservation organizations with species and event-type mappings |

---

## Testing

**470 Vitest tests** (91.4% statement coverage on `server/src/`)
**43 Playwright end-to-end tests** (frontend + key bot behaviors)

All LLM calls are mocked in tests using fixtures in `server/tests/fixtures/llm/`. Real AI APIs are never called in the test suite. Similarly, Redis and Neon connections are mocked in unit tests — no live infrastructure required to run `npm test`.

```bash
npm test                         # run all Vitest tests
npm run test:coverage            # generate coverage report
cd client && npx playwright test # run E2E suite
```

The `app.ts` / `server.ts` split is critical for testing: `app.ts` exports the Express app without calling `listen()`. Test files import `app` directly and use `supertest` — no port conflicts, no flaky failures from timing.

---

## Project Structure

```
wildlife-sentinel/
├── server/src/
│   ├── scouts/          # 12 Scout agents (no LLM, pure data polling)
│   ├── agents/          # 5 intelligence agents (Enrichment → Synthesis)
│   ├── pipeline/        # Redis stream names + ThreatAssembler fan-in
│   ├── refiner/         # 5 event-type scorers + RefinerScheduler
│   ├── discord/         # Bot, publisher, war-room logger, weekly digest
│   ├── db/              # Queries + 9 migration files
│   ├── rag/             # Vector retrieval + embedding calls
│   ├── router/          # ModelRouter.ts — single point for all AI SDK imports
│   ├── app.ts           # Express app (no listen)
│   └── server.ts        # Startup orchestration (agents, scouts, refiner, bot)
├── client/
│   ├── app/             # 6 Next.js App Router pages
│   └── components/      # 11 reusable React components
├── shared/
│   ├── types.d.ts       # All shared types (.d.ts, not .ts — avoids rootDir issues)
│   └── models.ts        # AI model name constants (imported by all agents)
└── scripts/
    ├── migrate.ts        # Neon migration runner
    └── ingest/          # IUCN shapefile loader + species/conservation fact ingestion
```

---

## Deployment

**Backend (Railway):**
- Node.js Express server (HTTP API)
- Discord bot process (long-running)
- Redis instance
- All scouts and agents run in-process via `node-cron`

**Frontend (Vercel):**
- Next.js static + SSR pages
- Public API endpoints proxied from Railway backend

**Database (Neon):**
- PostgreSQL with PostGIS and pgvector extensions
- Connection pooling via `postgres.js` (not Supabase client SDK)
- Migrations run from `scripts/migrate.ts`

**Environment variables:** All secrets via Railway/Vercel dashboards. The server fails fast at startup if any required variable is missing — it will not start in a degraded state.

---

## Development

```bash
# Install all workspace dependencies
npm install

# Run both server and client in development
npm run dev

# Build (TypeScript → dist/)
npm run build

# Run tests
npm test

# Run linter
npm run lint

# Apply database migrations
npm run migrate

# Ingest species facts (run once during setup — 750 species, takes ~90 min)
npm run ingest:species

# Ingest conservation context documents (place .txt files in scripts/ingest/sources/)
npm run ingest:conservation
```

**Required environment variables:**
```
DATABASE_URL           # Neon PostgreSQL connection string
REDIS_URL              # Railway Redis URL
DISCORD_BOT_TOKEN      # Discord Developer Portal bot token
DISCORD_CLIENT_ID      # Discord app client ID
DISCORD_GUILD_ID       # Your Discord server ID
DISCORD_CHANNEL_WILDLIFE_ALERTS   # Channel ID for public alerts
DISCORD_CHANNEL_SENTINEL_OPS      # Channel ID for ops + HITL review
NASA_FIRMS_API_KEY     # NASA FIRMS registration (free)
GOOGLE_AI_API_KEY      # Google AI Studio (Gemini + embeddings)
ANTHROPIC_API_KEY      # Anthropic API (Claude Haiku)
GFW_API_KEY            # Global Forest Watch (GLAD deforestation alerts)
FISHING_WATCH_API_KEY  # Global Fishing Watch (optional — illegal fishing scout)
```

---

## Build History

| Phase | What Was Built | Tests |
|---|---|---|
| **0 — Foundation** | npm workspaces, TypeScript strict, Neon+PostGIS, Redis, Discord skeleton | — |
| **1 — Fire Scout** | NASA FIRMS → PostGIS → Enrichment → Discord. First live alert. | 12 |
| **2 — Habitat Coverage** | 1,372 species loaded into PostGIS. GBIF client. Habitat + Species Context agents. | 38 |
| **3 — Model Router** | `ModelRouter.ts` — centralized AI routing, cost tracking, Gemini + Anthropic SDKs | 51 |
| **4 — All 5 Disasters** | NOAA NHC, USGS NWIS, Drought Monitor, Coral Reef Watch scouts live | 79 |
| **5 — Full Swarm** | Threat Assessment + Synthesis agents. ThreatAssembler fan-in. HITL pattern. | 121 |
| **6 — RAG** | 750 species ingested, 38 conservation chunks. Species Context + Synthesis grounded. | 139 |
| **7 — Refiner** | 5 event-type scorers, hourly scheduler, correction note generation, DB prompt updates | 169 |
| **8 — Frontend** | Next.js dashboard, Leaflet map, alerts feed, SSE panel, refiner chart | 177 |
| **9 — Hardening** | 91.4% coverage, Playwright E2E, Railway + Vercel deployed, end-to-end smoke test passed | 295 |
| **10 — Expansions** | GDACS global coverage, seismic/volcanic/deforestation/sea-ice/fishing/ENSO scouts, dark mode, species profiles, Discord slash commands, 43 Playwright E2E tests | 424 + 43 E2E |
| **11 — Charities** | 30 vetted orgs, charity-species mapping, `/donate` command, charity sections in alerts + species pages, `/charities` directory | 470 + 43 E2E |

---

## What This Demonstrates

**Distributed systems:** Redis Streams with consumer groups and the XADD/XREADGROUP/XACK pattern — not a queue, a persistent log. Messages survive agent crashes and are redelivered.

**Multi-agent AI orchestration:** 12 scout agents feed 5 intelligence agents across 4 Redis streams. Agents communicate only via the message bus — no direct method calls between agents, no shared state objects.

**Self-improving AI:** The Refiner/Evaluator loop is the prompt-engineering analog of model fine-tuning. The Threat Assessment Agent's system prompt grows with verified corrections, traceable back to specific prediction failures.

**Spatial computing:** PostGIS `ST_DWithin` against 1,372 habitat polygons runs on every incoming disaster event in real time, with a GIST index making sub-100ms lookups routine.

**Cost-aware model routing:** Gemini Flash-Lite for high-volume enrichment, Gemini Flash for RAG synthesis, Claude Haiku for final reasoning — each model assigned to the task that matches its cost-to-quality ratio. Total project cost tracked per call in the database.

**Production robustness:** Circuit breakers on all 12 scouts (auto-open after N consecutive failures), `startWithRestart()` wrapping all agent loops, structured error logging to `#sentinel-ops`, `/pause` and `/resume` commands for emergency pipeline control.

---

*Built as part of an AI engineering curriculum. All data sources are government or major scientific institution APIs.*
