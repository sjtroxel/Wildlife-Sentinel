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
| 6 | RAG Knowledge Base | 🔶 Blocked | Infrastructure complete, 72 tests pass. Ingest blocked: IUCN API inaccessible (v4=404, v3=Cloudflare). See PHASE_6_HANDOFF.md |
| 7 | Refiner / Evaluator Loop | 🔲 Not started | 24h/48h evaluator, system prompt updates, score tracking |
| 8 | Frontend | 🔲 Not started | Next.js, Leaflet map, alerts feed, agent activity SSE, refiner chart |
| 9 | Hardening + Deploy | 🔲 Not started | Tests, Playwright E2E, Railway + Vercel deploy, weekly digest |
| 10 | Expansions & Enhancements | 🔲 Expansion | Global data sources, UI polish, new features — post-launch improvements |

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

- [ ] `species_facts` table (pgvector 768-dim, Neon)
- [ ] `conservation_context` table (pgvector 768-dim, Neon)
- [ ] Google text-embedding-004 embedding generation working
- [ ] `scripts/ingest/ingestSpeciesFacts.ts` — IUCN PDFs + WWF profiles
- [ ] `scripts/ingest/ingestConservationContext.ts` — WWF Living Planet etc.
- [ ] RAG retrieval helper with 0.40 similarity threshold
- [ ] Species Context Agent uses RAG for species briefs
- [ ] Synthesis Agent uses RAG for "why this matters" framing
- [ ] Both agents cite `source_id` in output — no uncited claims

→ See [PHASE_6_RAG.md](roadmap/PHASE_6_RAG.md)

---

## Phase 7 — Refiner / Evaluator Loop
**Goal:** System improves its own predictions over time.

- [ ] Refiner Agent runs 24h after each fire/storm alert
- [ ] Refiner Agent runs 48h after each fire/storm alert
- [ ] Prediction vs actual comparison logic (NASA FIRMS / NOAA lookback)
- [ ] Deterministic scoring: `0.6 * directionAccuracy + 0.4 * magnitudeAccuracy`
- [ ] Correction Note generation (Claude Sonnet 4.6)
- [ ] `agent_prompts` table update mechanism
- [ ] `refiner_scores` table — score history per alert
- [ ] Score trend verified: does the system improve after corrections?

→ See [PHASE_7_REFINER.md](roadmap/PHASE_7_REFINER.md)

---

## Phase 8 — Frontend
**Goal:** Portfolio-quality read-only web presence for non-Discord visitors.

- [ ] Next.js 15 App Router project scaffolded in `client/`
- [ ] Tailwind CSS v4 configured
- [ ] Mobile-first responsive layout (375px base)
- [ ] Leaflet map: disaster events (color-coded) + habitat polygons
- [ ] `dynamic` import for Leaflet (ssr: false)
- [ ] Recent Alerts feed (last 15 from DB)
- [ ] Agent Activity SSE panel (live stream from server)
- [ ] Refiner score trend chart
- [ ] Mobile review passes (375px, 768px, 1280px viewports)

→ See [PHASE_8_FRONTEND.md](roadmap/PHASE_8_FRONTEND.md)

---

## Phase 9 — Hardening + Deploy
**Goal:** Production-ready. Deployed to Railway + Vercel.

- [ ] Vitest coverage ≥ 80% on server/src/
- [ ] All LLM calls mocked with fixtures in tests
- [ ] Playwright E2E suite (frontend + key bot behaviors)
- [ ] Rate limiting on all Express endpoints
- [ ] Error handling: all agent failures log to #sentinel-ops, never crash pipeline
- [ ] Weekly digest automation (every Sunday)
- [ ] `npm run migrate:prod` script for Neon
- [ ] Railway deployment (server + Redis + bot)
- [ ] Vercel deployment (Next.js frontend)
- [ ] Environment variables set on Railway + Vercel
- [ ] End-to-end smoke test on production

→ See [PHASE_9_HARDENING.md](roadmap/PHASE_9_HARDENING.md)

---

## Phase 10 — Expansions & Enhancements
**Goal:** Post-launch improvements — global data coverage, UI polish, and new features. Items are added here as they're identified. Not all need to ship together.

- [ ] **Global flood monitoring:** Replace USGS NWIS with GloFAS (Copernicus) for Amazon, Congo, Mekong coverage
- [ ] **Global cyclone coverage:** Replace NOAA NHC with IBTrACS/GDACS for Western Pacific, Indian Ocean basins
- [ ] **Global drought coverage:** Replace US Drought Monitor with GRACE-FO or CHIRPS for sub-Saharan Africa, Australia, Central Asia
- [ ] **Dynamic gauge selection:** Replace static `usgs-sites.json` with PostGIS spatial query at startup
- [ ] **Frontend enhancements:** Additional map layers, filtering by event type or threat level, dark mode
- [ ] **Alert history:** Searchable archive page on the frontend
- [ ] **Weekly digest:** Automated Sunday summary post to #wildlife-alerts
- [ ] *(add more items here as they come up)*

→ See [PHASE_10_EXPANSIONS.md](roadmap/PHASE_10_EXPANSIONS.md)
