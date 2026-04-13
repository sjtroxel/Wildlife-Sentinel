# Wildlife Sentinel — Master Roadmap

*Spec-first. Update this file as phases complete. Check off items when done. Add notes in phase detail files.*

---

## Phase Status

| Phase | Name | Status | Notes |
|---|---|---|---|
| 0 | Foundation | ✅ Complete | Monorepo, TypeScript, Redis, Discord skeleton, Neon+PostGIS |
| 1 | Fire Scout + Basic Pipeline | ✅ Complete | NASA FIRMS → PostGIS → Enrichment → Discord live |
| 2 | Full Habitat Coverage + GBIF | ✅ Complete | 1,372 CR/EN species in PostGIS, GBIF client, Habitat + Species Context agents live |
| 3 | TypeScript Model Router | ✅ Complete | ModelRouter.ts singleton, all SDK imports centralized, cost tracking live |
| 4 | All Five Disaster Sources | ✅ Complete | NHC, USGS, Drought Monitor, Coral Reef Watch scouts live |
| 5 | Full Agent Swarm + War Room | ✅ Complete | ThreatAssembler fan-in, Threat Assessment + Synthesis (Claude Sonnet), HITL, war room |
| 6 | RAG Knowledge Base | ✅ Complete | 750 species in species_facts + 38 conservation_context chunks. Ingest complete 2026-03-31. |
| 7 | Refiner / Evaluator Loop | ✅ Complete | 5 event-type scorers, hourly scheduler, correction notes, 121 tests pass |
| 8 | Frontend | ✅ Complete | Next.js 16.2.1, Leaflet map, alerts feed, SSE, refiner chart, logos/favicon. 139 tests pass. |
| 9 | Hardening + Deploy | ✅ Complete | 295 tests, 91.4% coverage, Railway + Vercel live, pipeline end-to-end verified 2026-04-05 |
| 10 | Expansions & Enhancements | 🔄 In Progress | Tracks 1–4 + Expansion 0A/0B/0C complete. Next: Expansion 1 (global data sources). See PHASE_10_IMPLEMENTATION_PLAN.md |

---

## Pre-Code Checklist (Must Complete Before Phase 0 Implementation)

- [x] IUCN shapefile download registered (iucnredlist.org) — Terrestrial Mammals 814MB zip, parked outside repo
- [x] NASA FIRMS API key obtained (firms.modaps.eosdis.nasa.gov)
- [x] Neon account created + new project (neon.tech) — PostGIS + pgvector enabled
- [x] Google AI API key obtained (for Gemini 2.5 Flash/Flash-Lite + text-embedding-004)
- [x] Discord bot created in Developer Portal + token obtained
- [x] Discord channels created: `#wildlife-alerts` (private for now) + `#sentinel-ops` (private)
- [ ] Railway project created (new project, not reusing Asteroid Bonanza) — deferred to Phase 9

---

## Phase 0 — Foundation
**Goal:** Working monorepo. Discord bot connects and posts a test message. Redis runs. Neon+PostGIS ready.

- [x] npm workspaces monorepo: `server/`, `client/`, `shared/`, `scripts/`
- [x] TypeScript strict everywhere (`strict: true`, `noUncheckedIndexedAccess: true`)
- [x] NodeNext module resolution configured
- [x] `shared/types.d.ts` + `shared/models.ts` scaffolded
- [x] Express 5 server skeleton (app.ts / server.ts split)
- [x] Neon connection via postgres.js — health check endpoint
- [x] PostGIS extension enabled on Neon
- [x] Redis connection via ioredis — health check
- [x] discord.js bot skeleton — connects to server, posts test message to #sentinel-ops
- [x] `server/src/config.ts` — env var validation at startup
- [x] Husky pre-commit hooks (lint + typecheck)
- [x] Vitest configured
- [x] GitHub Actions CI (lint + typecheck + test)

→ See [PHASE_0_FOUNDATION.md](roadmap/PHASE_0_FOUNDATION.md)

---

## Phase 1 — Fire Scout + Basic Pipeline
**Goal:** Real NASA FIRMS fire data flows through the pipeline. Discord gets a real alert.

- [x] `RawDisasterEvent` type defined in shared/types.d.ts
- [x] NASA FIRMS Scout Agent (cron, no LLM, publishes to disaster:raw)
- [x] Redis consumer group for disaster:raw
- [x] Enrichment Agent skeleton (PostGIS lookup only — no LLM yet)
- [x] PostGIS habitat polygon loader script (10 manual species loaded)
- [x] Open-Meteo weather fetch attached to enrichment
- [x] `EnrichedDisasterEvent` type
- [x] Discord Publisher (posts to #wildlife-alerts and #sentinel-ops)
- [ ] HITL reaction collector for 'critical' alerts — deferred to Phase 5 (no threat levels yet)
- [x] End-to-end test: real fire event → Discord message

→ See [PHASE_1_FIRE_SCOUT.md](roadmap/PHASE_1_FIRE_SCOUT.md)

---

## Phase 2 — Full Habitat Coverage + GBIF
**Goal:** All Critically Endangered + Endangered species ranges in PostGIS. GBIF cross-reference working.

- [x] IUCN bulk shapefile download received + loaded into PostGIS
- [x] Shapefile → PostGIS loader script in `scripts/ingest/`
- [x] GBIF occurrence API integration
- [x] Habitat Agent (Gemini 2.5 Flash-Lite) — GBIF recent sightings
- [x] Species Context Agent (Gemini 2.5 Flash) — skeleton without RAG
- [x] `FullyEnrichedEvent` enriched with GBIF + species data

→ See [PHASE_2_FULL_HABITAT.md](roadmap/PHASE_2_FULL_HABITAT.md)

---

## Phase 3 — TypeScript Model Router
**Goal:** ModelRouter.ts routing Anthropic + Google AI. Cost tracking live.

- [x] `ModelRouter.ts` implemented (Anthropic SDK + Google AI SDK)
- [x] `shared/models.ts` with all model constants
- [x] Cost tracking per call + running total in `model_usage` table
- [x] Enrichment Agent + Habitat Agent switch to ModelRouter
- [x] Species Context Agent uses ModelRouter
- [x] Cost tracking verified end-to-end
- [x] Gemini 2.5 Flash-Lite confirmed working for enrichment agents
- [x] Gemini 2.5 Flash confirmed working for Species Context Agent

→ See [PHASE_3_MODEL_ROUTER.md](roadmap/PHASE_3_MODEL_ROUTER.md)

---

## Phase 4 — All Five Disaster Sources
**Goal:** All five Scout agents polling. All events flow into the same pipeline.

- [x] NOAA NHC Scout Agent (storm data)
- [x] USGS NWIS Scout Agent (flood stage gauges)
- [x] US Drought Monitor Scout Agent (weekly severity)
- [x] NOAA Coral Reef Watch Scout Agent (bleaching alerts)
- [x] Scout agent deduplication working for all five sources
- [x] Event normalization to RawDisasterEvent schema for all types
- [x] Pipeline handles all five event_types correctly

→ See [PHASE_4_ALL_DISASTERS.md](roadmap/PHASE_4_ALL_DISASTERS.md)

---

## Phase 5 — Full Agent Swarm + Discord War Room
**Goal:** Complete intelligence pipeline. Quality Discord alerts. Observability in #sentinel-ops.

- [x] Threat Assessment Agent (Claude Sonnet 4.6)
- [x] Confidence scoring from observable fields (not self-reported)
- [x] `agent_prompts` table — system prompts stored in DB (updateable by Refiner)
- [x] Synthesis Agent (Claude Sonnet 4.6) — rich Discord embeds
- [x] Threat level routing (low: drop, medium/high: auto-post, critical: HITL)
- [x] #sentinel-ops observability log format (one line per agent action)
- [x] End-to-end test: raw event → threat assessment → Discord embed

→ See [PHASE_5_FULL_SWARM.md](roadmap/PHASE_5_FULL_SWARM.md)

---

## Phase 6 — RAG Knowledge Base
**Goal:** Species Context Agent and Synthesis Agent grounded in real data.

- [x] `species_facts` table (pgvector 768-dim, Neon) — migration 0006 applied
- [x] `conservation_context` table (pgvector 768-dim, Neon) — migration 0006 applied
- [x] Google text-embedding-004 embedding generation working
- [x] `scripts/ingest/ingestSpeciesFacts.ts` — GBIF Species API + Wikipedia fallback (IUCN API was blocked; see PHASE_6_HANDOFF.md for full context)
- [x] `scripts/ingest/ingestConservationContext.ts` — reads .txt files (user places 3 docs in sources/conservation/)
- [x] RAG retrieval helper with 0.40 similarity threshold
- [x] Species Context Agent uses RAG for species briefs
- [x] Synthesis Agent uses RAG for "why this matters" framing
- [x] Both agents cite `source_id` in output — no uncited claims
- [x] `npm run ingest:conservation` complete — 38 chunks, 3 documents in `conservation_context` ✅
- [x] `npm run ingest:species` — 750/750 species complete as of 2026-03-31 ✅

→ See [PHASE_6_RAG.md](roadmap/PHASE_6_RAG.md)

---

## Phase 7 — Refiner / Evaluator Loop
**Goal:** System improves its own predictions over time.

- [x] Refiner Agent runs 24h after each fire/storm/flood/coral alert
- [x] Refiner Agent runs 48h after each fire/storm/flood/coral alert
- [x] Drought evaluation runs weekly (next Thursday at 18:00 UTC — Drought Monitor publication)
- [x] Prediction vs actual comparison logic (NASA FIRMS / NOAA / USGS / Drought Monitor / CRW)
- [x] Deterministic scoring: `0.6 * directionAccuracy + 0.4 * magnitudeAccuracy`
- [x] Correction Note generation (Claude Sonnet 4.6) when score < 0.60
- [x] `agent_prompts` table update mechanism (correction prepended to system prompt)
- [x] `refiner_scores` table — score history per alert (migration 0008, applied)
- [x] Hourly scheduler (`RefinerScheduler.ts`) started in `server.ts`
- [x] geoUtils.ts — haversine, bearing, centroid, CSV/NHC parsers, prediction extractors
- [x] 30 refiner tests pass (17 unit + 13 integration)

→ See [PHASE_7_REFINER.md](roadmap/PHASE_7_REFINER.md)

---

## Phase 8 — Frontend
**Goal:** Portfolio-quality read-only web presence for non-Discord visitors.

- [x] Next.js 16.2.1 App Router project scaffolded in `client/`
- [x] Tailwind CSS v4 configured (CSS-first, no tailwind.config.js)
- [x] Mobile-first responsive layout (375px base, lg:grid-cols-[1fr_380px])
- [x] Leaflet map: disaster events color-coded by type, sized by severity
- [x] `dynamic` import for Leaflet (ssr: false) — page.tsx must be 'use client'
- [x] Recent Alerts feed (last 20, polling 60s, expand-on-click)
- [x] Agent Activity SSE panel (last 50 entries, EventSource)
- [x] Refiner score trend chart (recharts, reference lines at 0.60 + 0.85)
- [x] Logo images (light/dark wide + 512x512) + Favicon.ico integrated
- [ ] Leaflet map tile/marker polish (known issues — tackle in Phase 9 or 10)

→ See [PHASE_8_FRONTEND.md](roadmap/PHASE_8_FRONTEND.md)

---

## Phase 9 — Hardening + Deploy
**Goal:** Production-ready. Deployed to Railway + Vercel.

- [x] Vitest coverage ≥ 80% on server/src/ — 91.4% achieved (286 tests)
- [x] All LLM calls mocked with fixtures in tests
- [x] Playwright E2E suite (frontend + key bot behaviors)
- [x] Rate limiting on all Express endpoints
- [x] Error handling: all agent failures log to #sentinel-ops, never crash pipeline
  - `startWithRestart()` auto-restarts all agent loops (2026-04-03)
  - `logToWarRoom` added to ThreatAssessmentAgent catch block (2026-04-04)
  - `logToWarRoom` added to ThreatAssembler on successful assembly (2026-04-04)
- [x] Weekly digest automation (every Sunday)
- [x] `npm run migrate:prod` script for Neon
- [x] Railway deployment (server + Redis + bot)
- [x] Vercel deployment (Next.js frontend)
- [x] Environment variables set on Railway + Vercel
- [x] End-to-end smoke test on production — passed 2026-04-05 (8/8 automated + 4/4 manual)

→ See [PHASE_9_HARDENING.md](roadmap/PHASE_9_HARDENING.md)

---

## Phase 10 — Expansions & Enhancements
**Goal:** Post-launch improvements — global data coverage, UI polish, and new features. Items are added here as they're identified. Not all need to ship together.

- [x] **Bug fixes** — Alert click crash, map markers, TypeScript cast errors (2026-04-05/06)
- [x] **Resizable panels** — react-resizable-panels v4, mobile + desktop layouts (2026-04-06)
- [x] **Sentinel-ops noise** — HabitatAgent `logToWarRoom` gated on sightings > 0 (2026-04-07)
- [x] **Cost visibility** — weekly digest includes 7-day AI cost line (2026-04-07)
- [x] **Pipeline hardening** — FirmsScout dedup TTL 7d, FRP threshold 25MW, coordinate grid dedup, HIGH→HITL routing, UUID fix (2026-04-07)
- [x] **Cost reduction** — all 3 Claude agents switched to CLAUDE_HAIKU (~3.75x cheaper) (2026-04-07)
- [x] **Expansion 0A** — `/pause`, `/resume`, `/status` Discord slash commands (2026-04-07)
- [x] **Expansion 0B** — Circuit breaker state persisted in Redis; survives Railway redeploys (2026-04-08)
- [x] **Expansion 0C** — `GET /health/scouts` endpoint — per-scout circuit state (2026-04-08)
- [x] **Expansion 1A** — Global cyclone coverage (GDACS — all ocean basins) (2026-04-08)
- [x] **Expansion 1B** — Global flood coverage (GDACS FL — Amazon, Congo, Mekong, Ganges) (2026-04-08)
- [x] **Expansion 1C** — Global drought coverage (GDACS DR — sub-Saharan, Central Asia) (2026-04-08)
- [x] **Expansion 2A** — Alert detail page `/alerts/[id]` + Discord embed clickable title link (2026-04-09)
- [x] **Expansion 2B** — Dark mode (system preference default + manual toggle, Tailwind v4) (2026-04-10)
- [x] **Expansion 2C** — Map layer toggles (show/hide by event type independently) (2026-04-10)
- [x] **Expansion 2D** — Alert history/archive page (filterable by type, threat level) (2026-04-10)
- [x] **Expansion 2E** — Species profile pages `/species/[slug]` + `/species` index (2026-04-11)
- [x] **Expansion 2F** — Discord `/species` slash command with autocomplete (2026-04-11)
- [x] **Expansion 2G** — Discord `/help` slash command (2026-04-11)
- [x] **Expansion 3A** — Multi-species event correlation (50km/1h dedup in EnrichmentAgent) (2026-04-12)
- [x] **Expansion 3B** — Historical trend analysis widget + Discord `/trends` slash command (2026-04-13)
- [ ] **Expansion 4** — Additional scouts (seismic, oil spill, deforestation, air quality)

→ See [PHASE_10_EXPANSIONS.md](roadmap/PHASE_10_EXPANSIONS.md)
