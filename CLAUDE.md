# Wildlife Sentinel — AI Development Context

*Read this file completely at the start of every session. It is a constraint system, not documentation.*

---

## What This Project Is

**Wildlife Sentinel** is a 24/7 autonomous intelligence system that monitors five real-time government disaster data streams globally, correlates every event against IUCN critical habitat polygons stored in PostGIS, and fires a multi-agent swarm when wildlife is at risk. Primary output: a Discord bot. Secondary output: a read-only Next.js web frontend with a Leaflet map.

This is a **push-model, event-driven system**. No user triggers it. The world triggers it.

---

## Developer Profile

- **Handle:** sjtroxel
- **Stack fluency:** TypeScript strict, Node.js/Express, Supabase/pgvector, Anthropic SDK, Railway/Vercel
- **New skills this project:** Next.js (frontend), Redis Streams, PostGIS spatial queries, TypeScript ModelRouter (multi-model routing), discord.js, Neon (PostgreSQL host)
- **Non-negotiables:** TypeScript only. No Python. No LangChain. Direct SDK usage always.

---

## Architecture Overview

```
[9 Scout Agents — cron pollers, no LLM]
  NASA FIRMS / NOAA NHC / GDACS RSS / USGS NWIS / USGS Earthquake / Drought Monitor / Coral Reef Watch / GFW GLAD / NSIDC Sea Ice
        │
        ▼
  Redis Stream: disaster:raw
  { source, event_type, coordinates, severity, timestamp, raw_data }
        │
        ▼ [Enrichment Agent — Gemini Flash]
  PostGIS ST_DWithin → habitat overlap check
  Open-Meteo → weather attach
  ── No habitat overlap? DROP event ──
        │
        ▼
  Redis Stream: disaster:enriched
  { ...raw + wind_direction, wind_speed, habitat_ids[], species_at_risk[], habitat_distance_km }
        │
        ├──► [Habitat Agent — Gemini Flash] → GBIF recent sightings
        └──► [Species Context Agent — Gemini Flash + RAG: species_facts index]
        │
        ▼ [Threat Assessment Agent — Claude Sonnet 4.6]
  Redis Stream: alerts:assessed
  { ...enriched + threat_level, predicted_impact, species_detail[], confidence_score }
        │
        ▼ [Synthesis Agent — Claude Sonnet 4.6 + RAG: conservation_context index]
  Redis Stream: discord:queue
  ── threat_level 'low'? DROP ──
  ── threat_level 'critical'? → #sentinel-ops (HITL review first) ──
  ── 'medium'/'high'? → #wildlife-alerts (auto-post) ──
        │
        ▼ [Refiner/Evaluator — runs 24h + 48h after each fire/storm alert]
  Compares prediction vs actual NASA FIRMS / NOAA data
  Scores 0–1. If < 0.60: rewrites Threat Assessment Agent system prompt in DB.
```

---

## Tech Stack

| Component | Choice | Notes |
|---|---|---|
| Language | TypeScript strict | `strict: true`, `noUncheckedIndexedAccess: true` |
| Module resolution | NodeNext | All relative imports use `.js` extensions |
| Backend | Express 5 | `app.ts` / `server.ts` split — critical for testing |
| Monorepo | npm workspaces | `server/`, `client/`, `shared/`, `scripts/` |
| Discord | discord.js v14 | Bot only — no user auth |
| Redis | ioredis | Better TypeScript support |
| Database | Neon (PostgreSQL) | pgvector + PostGIS. Use `postgres.js` directly. |
| Spatial queries | PostGIS | `ST_DWithin`, `ST_Intersects`, `ST_Point::geography` |
| Vector embeddings | Google `gemini-embedding-001` | 3072 dims, raw `fetch()` v1beta API |
| AI routing | TypeScript `ModelRouter` | See `docs/MODEL_ROUTER.md` and `.claude/rules/model-router.md` |
| AI: synthesis/threat/refiner | Claude Sonnet 4.6 | Anthropic SDK direct — quality-critical only |
| AI: moderate tasks (Species Context) | Gemini 2.5 Flash | Tier 1 paid (upgraded 2026-03-31): ~1,500 RPD / 30 RPM |
| AI: high-volume simple tasks (Enrichment, Habitat) | Gemini 2.5 Flash-Lite | Tier 1 paid: ~1,500 RPD / 30 RPM. $0.10/1M input |
| AI: embeddings | Google `gemini-embedding-001` | Tier 1 paid via `@google/generative-ai` SDK |
| Frontend | Next.js 15 (App Router) | Read-only. Mobile-first. |
| Maps | Leaflet.js | 2D geospatial. Not Three.js. |
| Hosting (backend) | Railway | Redis + Node.js + bot process |
| Hosting (frontend) | Vercel | |

---

## Non-Negotiables (Enforced — Do Not Relitigate)

### Git
- **NEVER run `git commit`**
- **NEVER run `git push`**
- **NEVER suggest co-authorship credits**
- When a block of work is complete, summarize what was done and tell the user to commit.

### AI Architecture
- **No LangChain** — direct SDK usage always
- **No self-reported confidence** — confidence scores must be computed from observable fields (data completeness, source quality, prediction vs. actual deltas). Never ask an agent "how confident are you?" and use the answer.
- **No hardcoded model strings in agent files** — import from `shared/models.ts`
- **Confidence scores are computed, not hallucinated**

### TypeScript
- `strict: true` and `noUncheckedIndexedAccess: true` — no exceptions
- NodeNext module resolution — all relative imports end in `.js`
- `shared/types.d.ts` (NOT `.ts`) — avoids rootDir expansion disaster
- `app.ts` exports Express app without `listen()`. `server.ts` calls `listen()`. This split is required for Vitest.

### Security
- **Secrets via environment variables only** — never read or write `.env`, `*.key`, `.aws/`, `.ssh/`
- All secrets accessed via `process.env.VARNAME` with validation at startup
- Never log secrets or API keys

### Frontend
- **Mobile-first** — 375px is the base viewport. Desktop layered with `md:` breakpoints.
- **No authentication** — fully public read-only site
- **No user accounts, no sessions**

---

## Project Structure

```
wildlife-sentinel/
├── CLAUDE.md                    ← this file
├── .claude/
│   ├── settings.json            ← git deny rules
│   ├── rules/                   ← domain behavioral rules
│   │   ├── agents.md
│   │   ├── redis.md
│   │   ├── database.md
│   │   ├── discord.md
│   │   ├── server.md
│   │   ├── testing.md
│   │   ├── deployment.md
│   │   ├── frontend.md
│   │   └── model-router.md
│   └── commands/                ← custom slash commands
│       ├── phase-check.md
│       ├── agent-review.md
│       ├── pipeline-check.md
│       └── mobile-review.md
├── project-specs/
│   ├── ROADMAP.md               ← master checklist
│   ├── roadmap/                 ← per-phase detailed specs
│   │   ├── phase-0-foundation.md
│   │   ├── phase-1-fire-scout.md
│   │   └── ...
│   └── docs/                    ← technical reference docs
│       ├── ARCHITECTURE.md
│       ├── DATABASE_SCHEMA.md
│       └── API_INTEGRATIONS.md
├── server/                      ← npm workspace
│   ├── src/
│   │   ├── agents/              ← all agent implementations
│   │   ├── scouts/              ← cron poller agents (no LLM)
│   │   ├── pipeline/            ← Redis stream publishers/consumers
│   │   ├── discord/             ← discord.js bot
│   │   ├── db/                  ← database queries (postgres.js)
│   │   ├── spatial/             ← PostGIS query helpers
│   │   ├── rag/                 ← RAG retrieval (Voyage AI)
│   │   ├── router/              ← ModelRouter.ts
│   │   ├── refiner/             ← Refiner/Evaluator agent
│   │   ├── app.ts               ← Express app (no listen)
│   │   └── server.ts            ← calls listen()
│   └── tests/
│       └── fixtures/llm/        ← LLM response fixtures
├── client/                      ← npm workspace (Next.js)
├── shared/                      ← npm workspace
│   ├── types.d.ts               ← shared types (NOT .ts)
│   └── models.ts                ← model name constants
└── scripts/                     ← npm workspace
    └── ingest/                  ← habitat polygon loading scripts
```

---

## Data Sources

### Disaster Streams
| Source | API | Auth | Schedule |
|---|---|---|---|
| NASA FIRMS | `firms.modaps.eosdis.nasa.gov/api/` | Free API key | Every 10 min |
| NOAA NHC | `nhc.noaa.gov/CurrentStorms.json` | None | Every 30 min |
| GDACS RSS | `gdacs.org/xml/rss.xml` | None | Every 30 min (TC + FL + DR + VO) |
| USGS NWIS | `waterservices.usgs.gov/nwis/iv/` | None | Every 15 min |
| USGS Earthquake | `earthquake.usgs.gov/fdsnws/event/1/query` | None | Every 15 min (M5.5+) |
| US Drought Monitor | `droughtmonitor.unl.edu/DmData/GISData.aspx` | None | Every Thursday |
| NOAA Coral Reef Watch | `coralreefwatch.noaa.gov/product/vs/vs_polygons.json` | None | Every 6 hours |
| GFW GLAD Alerts | `data-api.globalforestwatch.org` | GFW API key | Daily 08:00 UTC |
| NSIDC Sea Ice Index | `noaadata.apps.nsidc.org/NOAA/G02135/` | None | Daily 09:00 UTC |

### Species/Habitat
| Source | Role | Storage |
|---|---|---|
| IUCN Red List | Species range polygons | Pre-loaded into PostGIS |
| GBIF | Recent confirmed sightings | Queried live |
| Open-Meteo | Weather enrichment | Queried live |

---

## Redis Streams Reference

Streams: `disaster:raw` → `disaster:enriched` → `alerts:assessed` → `discord:queue`

Consumer groups: each consumer registers a group. XADD to publish, XREADGROUP to consume, XACK after processing. Never lose a message to a crash.

See `.claude/rules/redis.md` for full schema and consumer patterns.

---

## Agent Model Assignments

| Agent | Model | Why |
|---|---|---|
| Scout Agents (9) | No LLM | Pure data fetch + normalize |
| Enrichment Agent | Gemini 2.5 Flash-Lite | High volume, simple weather summary |
| Habitat Agent | Gemini 2.5 Flash-Lite | GBIF sighting classification |
| Species Context Agent | Gemini 2.5 Flash-Lite | RAG synthesis (cost-optimized; same tier as Enrichment/Habitat) |
| Threat Assessment Agent | Claude Haiku 4.5 | Nuanced reasoning — CLAUDE_HAIKU (~3.75x cheaper than Sonnet; do not revert) |
| Synthesis Agent | Claude Haiku 4.5 | Discord tone and quality — CLAUDE_HAIKU (do not revert) |
| Refiner/Evaluator | Claude Haiku 4.5 | Correction note generation — CLAUDE_HAIKU (do not revert) |

---

## The Learning Loop (Critical Feature)

The Refiner/Evaluator is a first-class feature, not an afterthought. It runs 24h and 48h after every fire and storm alert. It:
1. Pulls the original prediction from the DB
2. Queries actual NASA FIRMS / NOAA data for those coordinates
3. Scores prediction quality via deterministic math (0–1), never via self-report
4. If score < 0.60: generates a Correction Note and updates the Threat Assessment Agent's system prompt in DB
5. Logs score to `refiner_scores` table

The score trend is visible on the frontend as a chart — demonstrating the system improves over time.

---

## Spec-First Workflow

1. Before any implementation: read the relevant phase spec in `project-specs/roadmap/`
2. Write or update the spec if anything is unclear
3. Enter Plan Mode to outline the implementation
4. Get explicit user approval
5. Implement
6. Update the phase spec — check off completed items, add notes

---

## Session Start Checklist

At the start of every session, check:
- [ ] IUCN shapefile download registered? (iucnredlist.org)
- [ ] NASA FIRMS API key obtained? (firms.modaps.eosdis.nasa.gov)
- [ ] Neon account + project created? (neon.tech)
- [ ] Discord bot created in Developer Portal?
- [ ] Discord channels created? (#wildlife-alerts, #sentinel-ops)

Remind the user of any unchecked items before starting work.
