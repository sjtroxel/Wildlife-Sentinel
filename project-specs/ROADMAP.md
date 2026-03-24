# Wildlife Sentinel — Master Roadmap

*Spec-first. Update this file as phases complete. Check off items when done. Add notes in phase detail files.*

---

## Phase Status

| Phase | Name | Status | Notes |
|---|---|---|---|
| 0 | Foundation | 🔲 Not started | Monorepo, TypeScript, Redis, Discord skeleton, Neon+PostGIS |
| 1 | Fire Scout + Basic Pipeline | 🔲 Not started | NASA FIRMS → disaster:raw → Enrichment → Discord |
| 2 | Full Habitat Coverage + GBIF | 🔲 Not started | Full IUCN polygons, GBIF, Species Context Agent |
| 3 | TypeScript Model Router | 🔲 Not started | ModelRouter.ts, Gemini 2.5 Flash-Lite/Flash routing, cost tracking |
| 4 | All Five Disaster Sources | 🔲 Not started | NOAA NHC, USGS, Drought Monitor, Coral Reef Watch |
| 5 | Full Agent Swarm + War Room | 🔲 Not started | Threat Assessment, Synthesis, Discord observability |
| 6 | RAG Knowledge Base | 🔲 Not started | Google embeddings, species_facts + conservation_context indices |
| 7 | Refiner / Evaluator Loop | 🔲 Not started | 24h/48h evaluator, system prompt updates, score tracking |
| 8 | Frontend | 🔲 Not started | Next.js, Leaflet map, alerts feed, agent activity SSE, refiner chart |
| 9 | Hardening + Deploy | 🔲 Not started | Tests, Playwright E2E, Railway + Vercel deploy, weekly digest |

---

## Pre-Code Checklist (Must Complete Before Phase 0 Implementation)

- [ ] IUCN shapefile download registered (iucnredlist.org)
- [ ] NASA FIRMS API key obtained (firms.modaps.eosdis.nasa.gov)
- [ ] Neon account created + new project (neon.tech)
- [ ] Google AI API key obtained (for Gemini 2.5 Flash/Flash-Lite + text-embedding-004)
- [ ] Discord bot created in Developer Portal + token obtained
- [ ] Discord channels created: `#wildlife-alerts` (public) + `#sentinel-ops` (private)
- [ ] Railway project created (new project, not reusing Asteroid Bonanza)

---

## Phase 0 — Foundation
**Goal:** Working monorepo. Discord bot connects and posts a test message. Redis runs. Neon+PostGIS ready.

- [ ] npm workspaces monorepo: `server/`, `client/`, `shared/`, `scripts/`
- [ ] TypeScript strict everywhere (`strict: true`, `noUncheckedIndexedAccess: true`)
- [ ] NodeNext module resolution configured
- [ ] `shared/types.d.ts` + `shared/models.ts` scaffolded
- [ ] Express 5 server skeleton (app.ts / server.ts split)
- [ ] Neon connection via postgres.js — health check endpoint
- [ ] PostGIS extension enabled on Neon
- [ ] Redis connection via ioredis — health check
- [ ] discord.js bot skeleton — connects to server, posts test message to #sentinel-ops
- [ ] `server/src/config.ts` — env var validation at startup
- [ ] Husky pre-commit hooks (lint + typecheck)
- [ ] Vitest configured
- [ ] GitHub Actions CI (lint + typecheck + test)

→ See [PHASE_0_FOUNDATION.md](roadmap/PHASE_0_FOUNDATION.md)

---

## Phase 1 — Fire Scout + Basic Pipeline
**Goal:** Real NASA FIRMS fire data flows through the pipeline. Discord gets a real alert.

- [ ] `RawDisasterEvent` type defined in shared/types.d.ts
- [ ] NASA FIRMS Scout Agent (cron, no LLM, publishes to disaster:raw)
- [ ] Redis consumer group for disaster:raw
- [ ] Enrichment Agent skeleton (PostGIS lookup only — no LLM yet)
- [ ] PostGIS habitat polygon loader script (5–10 manual species for testing)
- [ ] Open-Meteo weather fetch attached to enrichment
- [ ] `EnrichedDisasterEvent` type
- [ ] Discord Publisher (posts to #wildlife-alerts and #sentinel-ops)
- [ ] HITL reaction collector for 'critical' alerts
- [ ] End-to-end test: real fire event → Discord message

→ See [PHASE_1_FIRE_SCOUT.md](roadmap/PHASE_1_FIRE_SCOUT.md)

---

## Phase 2 — Full Habitat Coverage + GBIF
**Goal:** All Critically Endangered + Endangered species ranges in PostGIS. GBIF cross-reference working.

- [ ] IUCN bulk shapefile download received + loaded into PostGIS
- [ ] Shapefile → PostGIS loader script in `scripts/ingest/`
- [ ] GBIF occurrence API integration
- [ ] Habitat Agent (Gemini 2.5 Flash-Lite) — GBIF recent sightings
- [ ] Species Context Agent (Gemini 2.5 Flash) — skeleton without RAG
- [ ] `EnrichedDisasterEvent` enriched with GBIF + species data

→ See [PHASE_2_FULL_HABITAT.md](roadmap/PHASE_2_FULL_HABITAT.md)

---

## Phase 3 — TypeScript Model Router
**Goal:** ModelRouter.ts routing Anthropic + Google AI. Cost tracking live.

- [ ] `ModelRouter.ts` implemented (Anthropic SDK + Google AI SDK)
- [ ] `shared/models.ts` with all model constants
- [ ] Cost tracking per call + running total in `model_usage` table
- [ ] Enrichment Agent + Habitat Agent switch to ModelRouter
- [ ] Species Context Agent uses ModelRouter
- [ ] Cost tracking verified end-to-end
- [ ] Gemini 2.5 Flash-Lite confirmed working for enrichment agents
- [ ] Gemini 2.5 Flash confirmed working for Species Context Agent

→ See [PHASE_3_MODEL_ROUTER.md](roadmap/PHASE_3_MODEL_ROUTER.md)

---

## Phase 4 — All Five Disaster Sources
**Goal:** All five Scout agents polling. All events flow into the same pipeline.

- [ ] NOAA NHC Scout Agent (storm data)
- [ ] USGS NWIS Scout Agent (flood stage gauges)
- [ ] US Drought Monitor Scout Agent (weekly severity)
- [ ] NOAA Coral Reef Watch Scout Agent (bleaching alerts)
- [ ] Scout agent deduplication working for all five sources
- [ ] Event normalization to RawDisasterEvent schema for all types
- [ ] Pipeline handles all five event_types correctly

→ See [PHASE_4_ALL_DISASTERS.md](roadmap/PHASE_4_ALL_DISASTERS.md)

---

## Phase 5 — Full Agent Swarm + Discord War Room
**Goal:** Complete intelligence pipeline. Quality Discord alerts. Observability in #sentinel-ops.

- [ ] Threat Assessment Agent (Claude Sonnet 4.6)
- [ ] Confidence scoring from observable fields (not self-reported)
- [ ] `agent_prompts` table — system prompts stored in DB (updateable by Refiner)
- [ ] Synthesis Agent (Claude Sonnet 4.6) — rich Discord embeds
- [ ] Threat level routing (low: drop, medium/high: auto-post, critical: HITL)
- [ ] #sentinel-ops observability log format (one line per agent action)
- [ ] End-to-end test: raw event → threat assessment → Discord embed

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
