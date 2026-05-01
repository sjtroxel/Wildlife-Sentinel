# Asteroid Bonanza

> *The intelligence layer for the space resource revolution.*

**Asteroid Bonanza** is an AI-powered command center for analyzing near-Earth asteroids across four dimensions simultaneously: orbital accessibility, mineral composition, resource economics, and planetary defense risk. It ingests real data from NASA and JPL APIs, runs a swarm of four specialized AI agents with explicit confidence scoring, and provides a grounded RAG-powered Analyst for open-ended research questions.

**Live:** [asteroid-bonanza.vercel.app](https://asteroid-bonanza.vercel.app) (frontend) · [asteroid-bonanza.up.railway.app](https://asteroid-bonanza.up.railway.app) (backend API)

---

## What It Does

- **Search & Browse** — full-text and semantic vector search across 35,000+ catalogued near-Earth objects sourced from NASA NeoWs and JPL SBDB
- **Asteroid Dossier** — orbital elements, spectral class, physical parameters, close-approach timeline, and all four AI-generated analysis dimensions in one view
- **Agent Swarm Analysis** — four specialized Claude-powered agents (Navigator, Geologist, Economist, Risk Assessor) run in parallel, each producing a typed structured output with explicit confidence scoring; the Lead Orchestrator synthesizes or routes to a human handoff when aggregate confidence falls below threshold
- **AI Analyst** — a grounded RAG chatbot that answers open-ended questions about asteroid science and 2050 space economics, constrained to two separate vector indices and incapable of fabricating facts
- **Mission Planning** — build custom mission scenarios, compare launch windows, and model delta-V tradeoffs across a portfolio of targets
- **Planetary Defense Watch** — real-time close-approach dashboard, Potentially Hazardous Asteroid tracking, and a dedicated Apophis 2029 case study with live countdown
- **Orbital Canvas** — interactive Three.js visualization of asteroid orbital paths (full 3D on desktop; orthographic top-down with touch controls on mobile)

---

## Tech Stack

### Frontend
| | |
|---|---|
| Framework | Angular 21 (signals-first: `signal()`, `computed()`, `effect()`) |
| Styling | Tailwind CSS v4 (CSS-first `@theme {}` tokens, `.postcssrc.json` for Angular esbuild) |
| Language | TypeScript 5.x strict mode |
| 3D Rendering | Three.js with Canvas 2D fallback (WSL2 compatible) |
| Testing | Vitest + Playwright (375px mobile + 1280px desktop viewports) |

### Backend
| | |
|---|---|
| Runtime | Node.js 22 LTS |
| Framework | Express 5 (async error handling built in) |
| Language | TypeScript 5.x NodeNext module resolution |
| Testing | Vitest + Supertest — 209 server tests, 96.61% coverage |

### AI & Embeddings
| | |
|---|---|
| SDK | Anthropic SDK (`@anthropic-ai/sdk`) — no LangChain |
| Orchestrator + Agents | Claude Sonnet 4.6 (`claude-sonnet-4-6`) |
| Embeddings | Voyage AI `voyage-large-2-instruct` — 1024 dimensions, cosine similarity |
| RAG | Dual pgvector indices: `science_chunks` (hard facts) + `scenario_chunks` (2050 projections) |

### Data & Infrastructure
| | |
|---|---|
| Database | Supabase (PostgreSQL + pgvector) |
| NASA Data | NeoWs, JPL SBDB, JPL NHATS, JPL CAD |
| Monorepo | npm workspaces (`client`, `server`, `shared`, `scripts`) |
| CI | GitHub Actions (typecheck, lint, build, test on every push/PR) |
| Secret Scanning | gitleaks on full git history |
| Deployment | Railway (backend) + Vercel (frontend) |

---

## Agent Architecture

Four domain agents, one Lead Orchestrator. All inter-agent communication flows through a typed `SwarmState` object — no direct agent-to-agent calls. Confidence scores are computed from observable fields (data completeness, source quality, assumptions required), never self-reported.

```
Request
  └── Lead Orchestrator (claude-sonnet-4-6)
        ├── Navigator Agent     — orbital mechanics, delta-V, mission windows
        ├── Geologist Agent     — spectral analysis, mineral composition   } parallel
        ├── Risk Assessor Agent — planetary defense + mission risk         }
        └── Economist Agent     — resource value modeling (needs Geologist output)
              │
              ├── Confidence ≥ 0.30 → Synthesis (streamed token-by-token)
              └── Confidence < 0.30 → HandoffPackage (what was found, where confidence broke down)
```

Each agent uses Anthropic tool use to call NASA/JPL APIs and query RAG indices at runtime. The Orchestrator streams per-agent events (`tool_call`, `rag_lookup`, `output`) to the frontend as they happen via Server-Sent Events, so users watch the agents reason in real time.

---

## RAG Knowledge Base

Two separate Supabase vector tables, routed by query type:

| Index | Contents | Use |
|---|---|---|
| `science_chunks` | NASA mission reports, spectral surveys, peer-reviewed papers | Hard facts about asteroids |
| `scenario_chunks` | NASA Vision 2050, ISRU roadmaps, space economics analyses | Forward-looking 2050 projections |

The AI Analyst is architecturally constrained to these indices. It cannot use model weights for asteroid facts — every claim must be sourced with a `source_id`. Responses clearly distinguish `[Science fact]` from `[2050 Projection]`.

---

## Phase Breakdown

All nine phases are complete and deployed.

| Phase | Name | Key Deliverables |
|---|---|---|
| 0 | Foundation | Monorepo, TypeScript strict, Husky, gitleaks, CLAUDE.md, CI skeleton |
| 1 | Data Layer | Supabase schema (7 migrations), NASA ingest pipeline, 35k+ NEOs loaded |
| 2 | Search & Browse | Full-text + semantic vector search, asteroid dossier, close-approach timeline |
| 3 | RAG Knowledge Base | Document ingest pipeline, Voyage AI embeddings, dual-index retrieval |
| 4 | AI Analyst | Streaming RAG chatbot (SSE), session management, grounding constraints |
| 5 | Agent Swarm | 4 domain agents + Lead Orchestrator, SwarmState, confidence scoring, handoff |
| 6 | Mission Planning | Scenario builder, delta-V comparison, Three.js orbital canvas |
| 7 | Planetary Defense | PHA dashboard, close-approach watch, Apophis 2029 live countdown |
| 8 | Hardening & Deployment | 209 server tests (96.61% coverage), 226 E2E tests, production deploy |
| 9 | Observability Polish | Per-event agent streaming: tool calls, RAG lookups, synthesis tokens live |

---

## Development

### Prerequisites

- Node.js 22 LTS
- A Supabase project with pgvector enabled
- API keys: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NASA_API_KEY`

### Install

```bash
npm install
```

### Run (development)

```bash
npm run dev                          # starts both client (port 4200) and server (port 3001)
npm run dev --workspace=server       # server only
npm run dev --workspace=client       # client only
```

### Type-check, Lint, Test

```bash
npm run typecheck                    # all workspaces
npm run lint
npm run test                         # Vitest unit + integration
npm run test:e2e                     # Playwright E2E (375px + 1280px viewports)
```

### Data Pipeline

```bash
npm run ingestNasa                   # pull from NASA/JPL APIs → Supabase
npm run ingestDocuments              # PDF/text → chunks → embeddings → Supabase
```

---

## Repository Structure

```
asteroid-bonanza/
├── client/                    # Angular 21 frontend
│   └── src/app/
│       ├── core/              # Singleton services, HttpClient wrapper
│       ├── features/          # Feature slices: search, dossier, analysis,
│       │                      #   analyst-chat, defense-watch, mission-planning,
│       │                      #   orbital-canvas
│       └── shared/            # Shared components, pipes
├── server/                    # Express 5 backend
│   └── src/
│       ├── app.ts             # Express app — no listen()
│       ├── server.ts          # Calls listen() — never imported in tests
│       ├── routes/            # One file per feature domain
│       ├── services/
│       │   └── orchestrator/  # Lead Orchestrator + 4 domain agents
│       ├── db/                # Supabase client + 7 migrations
│       └── errors/            # Typed error classes
├── shared/
│   └── types.d.ts             # Cross-workspace types (.d.ts not .ts)
├── scripts/                   # Offline data pipeline (ingest, seed)
├── project-specs/             # Architecture docs, AI design, roadmap
├── ai-masterclass-resources/  # Course notes and learning journey
└── CLAUDE.md                  # AI context file
```

---

## Key Design Decisions

**No LangChain.** The agent orchestration is hand-rolled on the Anthropic SDK. The architecture is conceptually isomorphic with LangGraph (nodes, edges, state, conditional routing) — we own every line of it.

**Confidence is derived, not declared.** Agents never self-report confidence. The Orchestrator computes scores from observable fields (`dataCompleteness`, `sourceQuality`, `assumptionsRequired`). LLMs are systematically overconfident due to RLHF — we never ask and take it at face value.

**Handoff is a first-class feature.** When aggregate confidence falls below 0.30 (calibrated empirically on live Apophis/Bennu/Ryugu runs), the system produces a `HandoffPackage` explaining what was found and what a human expert would need to assess — not a generic error.

**Two RAG indices, never one.** Hard science facts and 2050 economic projections are stored and routed separately. Mixing them would allow the model to present speculation as established fact.

**Mobile-first, no exceptions.** Every component is built at 375px first. Desktop is layered on with `md:` breakpoints. The Three.js canvas degrades gracefully to Canvas 2D in environments without WebGL (WSL2).

---

## Context

Asteroid Bonanza is the capstone project for the [Codefi AI Masterclass](https://github.com/sjtroxel/AI-Masterclass-Week-6) — a six-week intensive course in production AI engineering. It is the sixth and most architecturally ambitious project in the series, demonstrating multi-agent systems, dual-index RAG, real-time observability streaming, and production deployment — all built without framework abstractions.

---

*Data sourced from NASA NeoWs, JPL SBDB, JPL NHATS, and JPL CAD. AI powered by Anthropic Claude. Embeddings by Voyage AI.*
