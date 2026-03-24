# Six Weeks of Building: A Learning Journey

*A comprehensive retrospective across the Codefi AI Masterclass projects — Week 2 through Week 6.*

---

## Table of Contents

1. [Week 2 — Mighty Mileage Meetup (Angular + Tailwind v4 Meetup App)](#week-2--mighty-maps-angular--tailwind-v4-meetup-app)
2. [Week 3 — Strawberry Star Travel App (React + Express Full-Stack)](#week-3--strawberry-star-travel-app-react--express-full-stack)
3. [Week 4 — ChronoQuizzr (AI-Powered History Geography Game)](#week-4--chronoquizzr-ai-powered-history-geography-game)
4. [Week 5 — Poster Pilot (Multimodal RAG Platform)](#week-5--poster-pilot-multimodal-rag-platform)
5. [Week 6 — Asteroid Bonanza (Multi-Agent AI Intelligence Platform)](#week-6--asteroid-bonanza-multi-agent-ai-intelligence-platform)
6. [The Bigger Picture: Six Weeks of Cumulative Growth](#the-bigger-picture-six-weeks-of-cumulative-growth)

---

## Week 2 — Mighty Mileage Meetup (Angular + Tailwind v4 Meetup App)

### What Was Built

A full-stack meetup platform with an Angular 19 frontend and a Rails backend, centered around a custom-built interactive mapping feature called **Mighty Mileage Meetup**. The app allowed users to register, create meetups with geographic locations, join/leave meetups, and post comments — with the map serving as both a display and an input mechanism.

### Technical Stack

- **Frontend**: Angular 19 (signals-based), TypeScript, Tailwind CSS v4
- **Backend**: Ruby on Rails (API mode)
- **Maps**: Leaflet.js via `@asymmetrik/ngx-leaflet`
- **Testing**: Vitest (unit), Playwright (E2E, 7 happy-path tests)
- **Auth**: JWT, injected globally via `authTokenInterceptor`

### The Four Phases of Mighty Maps

**Phase 1 — GeocodingService**: A service wrapping the Nominatim API (OpenStreetMap) to convert addresses to latitude/longitude coordinates. Established the pattern of wrapping external APIs behind a typed Angular service returning `Observable<Location>`.

**Phase 2 — View-Only MapComponent**: A Leaflet-based map component that accepted a `location` input and rendered a pin at the given coordinates. Introduced the challenge of integrating a DOM-heavy library (Leaflet) into Angular's change detection model.

**Phase 3 — Interactive Map + ReverseGeocodingService**: The map became a two-way input — users could click to drop a pin, and the app would reverse-geocode the coordinates back to a human-readable address via `ReverseGeocodingService`. The `MeetupFormComponent` gained a live spinner during geocoding, showing intermediate loading state driven by an `isReverseGeocoding` Angular signal.

**Phase 4 — UX Polish + E2E**: Final polish pass, then a full Playwright E2E suite covering the entire user journey: registration, login/logout, meetup creation with ZIP auto-lookup, join/leave, and comment posting.

### Key Technical Discoveries

**The Tailwind v4 + Angular PostCSS Problem**: This was one of the most instructive lessons of Week 2. Angular's `@angular/build:application` (esbuild-based) does *not* read `postcss.config.js` — it only reads `postcss.config.json` or `.postcssrc.json`. Without this, `@import "tailwindcss"` resolves to the static CSS file in `node_modules`, giving you the `@layer`/`@theme` structure but generating zero utility classes. The fix was to use `.postcssrc.json` with `{"plugins":{"@tailwindcss/postcss":{}}}`. This took significant debugging to uncover.

**Angular Signals and Side Effects**: The `isReverseGeocoding` signal pattern showed how Angular 19's signals model streamlines reactivity — state changes propagate cleanly through the component tree without manual change detection calls.

**Testing a DOM Library (Leaflet) in Happy-DOM**: Leaflet initializes by manipulating the DOM directly on mount, which breaks in testing environments. The solution was `overrideComponent(MapComponent, { set: { imports: [], schemas: [NO_ERRORS_SCHEMA] } })` to prevent Leaflet from initializing in tests at all. For Geolocation API testing, the pattern `vi.stubGlobal('navigator', ...)` + `afterEach(() => vi.unstubAllGlobals())` became a reusable template.

**JWT Architecture**: Rather than having each service set `Authorization` headers manually, a global `authTokenInterceptor` handles JWT injection for all HTTP calls. The `SKIP_AUTH = new HttpContextToken<boolean>(() => false)` mechanism lets services like `GeocodingService` opt out of JWT forwarding to external APIs — a clean pattern for mixed-origin API calls.

**WSL2 and Playwright**: Running Playwright in WSL2 required manual installation of system libraries (`libnspr4`, `libnss3`, and others) for Chromium. A practical lesson about the gap between "npm install" and "actually running a headless browser."

### What This Week Established

Week 2 established several foundations that carried through every subsequent project: Tailwind v4 CSS-first configuration, the value of a spec-first approach before writing code, explicit TypeScript typing across all layers, and the habit of writing a comprehensive test suite as a first-class deliverable rather than an afterthought.

---

## Week 3 — Strawberry Star Travel App (React + Express Full-Stack)

### What Was Built

A visually ambitious travel application with a **3D star map** (galactic-map feature), user authentication, and a favorites system. The project was structured as a monorepo with a React 19 + Vite frontend (`strawberry-star-travel-app`) and a Node.js/Express 4 backend (`strawberry-star-server`). A **Demo Mode** system allowed guests to use the app without registering.

### Technical Stack

- **Frontend**: React 19, TypeScript 5.9, Vite 7, Tailwind CSS v4
- **Backend**: Express 4.x, TypeScript 5.9 (ESM/NodeNext), Vitest + supertest
- **Auth**: JWT-based, routed through Express (Supabase retained only for avatar storage)
- **Architecture**: Feature-slice frontend (`src/features/<feature>/`), layered backend

### Core Features

**Authentication System**: Full JWT-based auth flow through the Express API. `AuthContext.tsx` manages auth state globally; the `useUser()` hook exposes it to components. A deliberate decision was made to retire Supabase as the auth provider and route auth and favorites entirely through the Express server — giving full control over auth logic and reducing third-party dependencies.

**Demo Mode (Hotel Key)**: A synthetic guest user system where `startDemo()` in `AuthContext.tsx` creates a demo session stored in `localStorage` with a 48-hour TTL. The `isDemoMode: boolean` flag is exposed everywhere auth state is consumed, and `useFavorites` handles both real and demo paths. The critical rule: `token` is `null` in demo mode — `Authorization` headers must never be sent. This was a UX-first design decision that made the app immediately usable for anyone without friction.

**Galactic Map**: A fully functional 3D star map with camera controls and path-plotting between destinations — the most visually complex component in the project.

**Favorites System**: Favorites work through the Express API for authenticated users, and through `localStorage` for demo users. The `useFavorites` hook abstracts this dual path transparently.

### Key Technical Discoveries

**NodeNext Module Resolution**: The backend used `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` in `tsconfig.json` — the correct configuration for Node.js native ESM. This enforces an important rule: all TypeScript import paths must use `.js` extensions (referring to the *output* file extension, not the source). Forgetting this caused runtime module-not-found errors that were confusing to diagnose at first.

**App/Server Split Pattern**: `app.ts` exports the Express app with no `listen()` call. `server.ts` imports `app` and calls `listen()`. This split is critical for testing — supertest imports `app` directly and makes requests without starting a real server. Tests that call `listen()` create port conflicts and flaky behavior.

**ESM Error Handler Middleware**: Express error handler middleware must have exactly four parameters — `(err, req, res, _next)` — even if `next` is unused. ESM/ESLint's `no-unused-vars` rule conflicts with this requirement. The fix: `argsIgnorePattern: "^_"` in the ESLint config to honor underscore-prefix convention.

**Spec-First Workflow Formalized**: Week 3 formalized a workflow that became a permanent standard: enter Plan Mode → explore the codebase → write a spec document in `project-specs/` → get explicit approval from the user → then and only then write code. This prevented rework caused by misaligned expectations and created a paper trail of every architectural decision.

### What This Week Added

Week 3 deepened full-stack TypeScript expertise — particularly the subtleties of ESM on Node.js. The demo mode pattern, the app/server testing split, and the feature-slice frontend architecture all became tools carried forward. The explicit spec-first workflow became a non-negotiable working standard.

---

## Week 4 — ChronoQuizzr (AI-Powered History Geography Game)

### What Was Built

**ChronoQuizzr** is a GeoGuessr-style historical geography game — think "Where in the world did this historical event happen?" Players are given clue cards generated by an AI system called **The Chronicler** and must drop a pin on a Leaflet map to guess the location of the historical event. Points are awarded based on distance from the true coordinates using a Haversine + exponential decay scoring formula.

The most technically ambitious feature: a **two-agent LLM pipeline** where Claude Haiku generates historical event clues, an adversarial second agent critiques them for location-name leakage, and the generator rewrites clues until they pass the adversary's scrutiny.

### Technical Stack

- **Frontend**: React 19, Vite 7, TypeScript, Tailwind CSS v4, Leaflet + react-leaflet
- **Backend**: Node.js/Express, TypeScript (CommonJS output), Vitest (39 server tests), Playwright (2 E2E tests)
- **AI**: Anthropic `claude-haiku-4-5-20251001` (primary), LLMProvider interface with inactive GeminiProvider
- **Deployment**: Railway (backend) + Vercel (frontend) — with a hard-won deployment story

### Game Mechanics

- **The Chronicler Pipeline**: `chroniclerEngine.ts` implements a Generate→Adversary→Rewrite loop. The first agent generates clue text for a historical event. The second agent (adversary) checks whether the clues contain any place names, city names, or geographic identifiers that would make guessing trivial. If leakage is detected, the generator rewrites. This loop runs until the adversary approves or a maximum iteration count is reached.
- **Clue Obfuscation Rule**: Clues must NEVER contain place names. This is "The Chronicler's obfuscation protocol" — a hard constraint enforced both by the system prompt and the adversary agent.
- **Coordinates Withheld**: True coordinates are never sent to the client until after the player submits their guess. The `GameEvent` shared type uses `Omit<HistoricalEvent, 'hiddenCoords'>` to enforce this at the TypeScript layer.
- **Scoring**: `Math.round(5000 * Math.exp(-distance_km / 2000))` — at 500 km: 3,894 points; at 1,000 km: 3,033; at 2,000 km: 1,839; at 10,000 km: 34.
- **Event Pool**: 10 hand-authored seed events + 10 Claude Haiku-generated events = 20 total. The `generateBatch.ts` script runs offline to populate `generated_events.json`.

### Key Technical Discoveries

**LLM Provider Architecture**: The `LLMProvider` interface + `FatalProviderError` pattern (defined in `geminiProvider.ts` as a shared location) allows swapping providers without changing calling code. `FatalProviderError` is thrown on 401/403/404/429/529 — errors that mean retrying won't help — and stops the batch generator immediately rather than burning API credits. The pivot from Gemini to Claude is documented in `project-specs/ADR_ANTHROPIC_PIVOT.md`.

**The `shared/types.d.ts` Lesson**: Originally `shared/types.ts` — a `.ts` file shared between client and server via path aliases. This caused a subtle TypeScript compilation disaster: when `tsc` sees a `.ts` file imported from outside its `rootDir`, it implicitly expands `rootDir` to the common ancestor. This shifted all compiled output from `dist/` to `dist/server/`, making `dist/index.js` not exist. The fix: rename to `shared/types.d.ts` — a declaration file. TypeScript reads it for types but never emits it and never factors it into `rootDir` calculation.

**Railway Deployment — Three Failure Modes**:
1. *Root Directory = "server"* → build container only contains `server/`, so `../shared/` doesn't exist at build time. Fix: Root Directory = blank.
2. *NODE_ENV=production* → `npm ci` skips devDependencies → TypeScript not installed → `tsc` fails → `dist/` never created. Fix: `npm ci --include=dev` in the build command.
3. *Shared .ts file in compilation* → rootDir expansion → wrong output paths (described above). Fix: rename to `.d.ts`.

**Leaflet in React Testing**: The same Leaflet + test environment problem from Week 2 resurfaced, but this time in a React/Vitest context. Solution: `vi.mock('react-leaflet', ...)` per test file with data-testid stubs replacing the real map components.

**Theme System Without JSX dark: Prefixes**: The dark/light theme is implemented entirely via a `html.theme-light` CSS class toggling `@theme` custom properties — no `dark:` prefixes in any JSX. `ThemeContext.tsx` reads `localStorage` and `prefers-color-scheme` synchronously on init. Leaflet tiles get a CSS filter inversion for the dark theme.

**GameBoard State Machine**: The game state is an explicit `'loading' | 'playing' | 'submitting' | 'result' | 'finished' | 'error'` union — no ambiguous booleans. The distinction between the `'error'` phase (full-screen, unrecoverable session failure) and `submitError` inline state (recoverable POST failure, pin preserved) is a good example of using the type system to encode UI states precisely.

**Final Test Count**: 39/39 Vitest server tests + 30/30 Vitest client tests + 2/2 Playwright E2E = **71 tests, all green**.

### What This Week Added

Week 4 introduced the most AI-forward work so far — multi-agent LLM pipelines, provider abstraction, and the economics of AI API calls (FatalProviderError pattern). It also produced the most battle-tested deployment story: three Railway failure modes diagnosed and resolved, each producing a durable lesson about how Railway, NODE_ENV, TypeScript compilation, and module systems interact. The `shared/types.d.ts` lesson is directly applicable to any TypeScript monorepo.

---

## Week 5 — Poster Pilot (Multimodal RAG Platform)

### What Was Built

**Poster Pilot** is a professional-grade, multimodal Retrieval-Augmented Generation (RAG) platform for indexing and exploring historical poster collections — WPA art, NASA mission posters, 19th-century patent medicine advertisements, WWII propaganda, and more. It is a **Discovery Engine for visual history**, drawing from 5,000+ posters ingested from the Digital Public Library of America (DPLA), which aggregates holdings from NARA, the Library of Congress, and the Smithsonian.

The app is live in production at **https://poster-pilot.vercel.app** (frontend) and **https://poster-pilot.up.railway.app** (backend).

### Technical Stack

- **Frontend**: React 19, TypeScript (strict), Tailwind CSS v4 (CSS-first)
- **Backend**: Node.js + Express 5.x
- **Database**: Supabase (PostgreSQL + pgvector extension)
- **Embeddings**: CLIP (`openai/clip-vit-large-patch14`, 768 dimensions) via Replicate API
- **LLM**: Claude Sonnet 4.6 via Anthropic SDK
- **Testing**: Vitest (253 tests, 18 test files) + Playwright E2E (31 tests)
- **Deployment**: Railway (backend) + Vercel (frontend)

### The Ten Phases

**Phase 0 — Foundation**: Monorepo scaffolding with npm workspaces (`/client`, `/server`, `/shared`), TypeScript strict mode, Vite, tsx, Vitest, Husky pre-commit hooks, gitleaks secret scanning.

**Phase 1 — Database**: Four Supabase tables (`series`, `posters`, `poster_search_events`, `archivist_sessions`), seven migrations with rollbacks, Row Level Security policies, and two RPC functions (`match_posters` for vector similarity, `get_visual_siblings` for related poster discovery).

**Phase 2 — Server Skeleton**: Express 5 with the full security baseline — `helmet()`, `cors()` with allowlist, `express.json({ limit: '1mb' })`, `express-rate-limit`. Typed error classes (`NotFoundError`, `ValidationError`, `DatabaseError`, `AIServiceError`, `SessionExpiredError`) feeding a global error handler.

**Phase 3 — Ingestion Pipeline**: A CLI ingest worker that calls the DPLA API, preprocesses text for CLIP's 77-token limit, generates 768-dimension vector embeddings via Replicate, computes metadata completeness scores, and upserts records into Supabase with centroid tracking per series. The NARA API was discovered to be down during this phase, necessitating a pivot to DPLA as the primary data source.

**Phase 4 — Search API**: Four distinct search modes — text (CLIP text embeddings), image (CLIP image embeddings), hybrid (both), and vibe (expansive semantic search with query expansion). Results from multiple search paths are merged with Reciprocal Rank Fusion (`rankFusion.ts`). A `queryAnalyzer` service classifies incoming queries and dispatches to the appropriate search strategy.

**Phase 5 — The Archivist (RAG API)**: A grounded RAG chatbot powered by Claude Sonnet 4.6. The Archivist answers questions about posters using only retrieved NARA/DPLA metadata as context — it cannot fabricate historical facts. Server-Sent Events (SSE) stream responses in real time. Session history is stored in Supabase (`archivist_sessions`) with a 24-hour TTL.

**Phase 6 — Frontend Shell**: Tailwind v4 `@theme` token system with full dark mode support, React Router 6 SPA routing, typed API client (`api.ts`), debug utility, and stub pages.

**Phases 7–9 — Full UI**: Search interface with debounced text input, image dropzone, mode tabs; `PosterCard` with confidence indicators; CSS masonry grid; `HandoffBanner` (human escalation prompt); poster detail page; series browse pages; the `ArchivistSidebar` with streaming chat, `react-markdown` rendering, citation links, and session management.

**Phase 10 — Hardening, Testing & Deployment**: Full unit test coverage (253 tests, 99.54% statement / 92.48% branch coverage on services), Playwright E2E suite (31 tests across 6 spec files), and production deployment to Railway + Vercel.

### Key Technical Discoveries

**CLIP — Both Encoders in One Model**: The original CLIP model reference (`cjwbw/clip-vit-large-patch14`) only exposes the *image* encoder. Sending text returns a 422 error. The correct model is `openai/clip@fd95fe35...`, which accepts both text and image inputs and returns 768-dimension vectors in the same embedding space — enabling true cross-modal similarity search where a text query and an image query are directly comparable.

**pgvector Strings**: Supabase PostgREST returns `vector` columns as the *text representation* `"[v1,v2,v3,...]"` rather than a parsed `number[]`. Any code that tries to do arithmetic on the raw response will fail silently or explode. The fix is a `parseEmbedding()` utility called every time a vector is read from the database.

**Confidence Score Architecture**: Three layered scores per poster: `embedding_confidence` (CLIP cosine similarity, 0–1), `metadata_completeness` (ratio of non-null NARA fields), and `overall_confidence` (weighted average: `embedding * 0.7 + metadata * 0.3`). These are computed at ingest time and stored — never recomputed at query time. The Human Handoff threshold (`similarity_score < 0.72`) is enforced centrally in the `match_posters` RPC function so it can't be bypassed by any code path.

**HandoffBanner Calibration**: The initial threshold (`overall_confidence < 0.65`) fired constantly because DPLA metadata is sparse — almost every poster had low metadata completeness. The solution was to change the trigger condition to `similarity_score < 0.20` (a genuine CLIP miss) so the banner only fires when search results are truly irrelevant, not merely when metadata fields are empty.

**Archivist Confidence Bug — Two-Layer Fix**: The Archivist was always reporting 85% confidence regardless of actual search quality. Root cause had two parts: (1) `archivistService.ts` hardcoded a binary `0.85/0.60` output — fixed to compute the actual average of `posterSimilarityScores`. (2) `poster_similarity_scores` was never being sent in `api.chat()` calls — the server always received an empty object and fell back to 0.85. Fix required adding `scores` to `PosterContext` and threading it all the way through `setPosterContext` → `sendMessage` → `useArchivist.doSend` → `api.chat`.

**Railway nixpacks vs. Railpack**: Week 4 used Railpack (Railway's new builder). Poster Pilot used nixpacks — the distinction matters because build behavior, environment handling, and available build configuration differ. The `railway.toml` format and the EBUSY error (caused by running `npm ci` twice — once by Railway automatically, once in the build command) were hard-won lessons specific to nixpacks.

**SSE and React Streaming**: The Archivist streams responses via Server-Sent Events. The frontend uses an `EventSource` connection managed by the `useArchivist` hook, assembling streamed tokens into the growing message string as they arrive. This required careful state management to avoid rendering partial updates that look broken.

**Accessibility — `inert` Attribute**: An axe accessibility scan flagged an `aria-hidden-focus` violation on the `ArchivistSidebar` — focusable elements inside an `aria-hidden` container. The modern fix is `inert={!isOpen || undefined}` on the `<aside>` element. When `inert` is set, the browser natively prevents focus, pointer events, and AT traversal of the subtree, making explicit `tabIndex=-1` management on every child unnecessary.

**Test Architecture**: Mock isolation required `vi.resetAllMocks()` + explicit per-mock `.mockReset()` in `beforeEach` for any test block using `mockReturnValueOnce` queues. Without this, queued return values bleed between tests in unpredictable ways. Discovering this took significant debugging.

### What This Week Represented

Poster Pilot was the capstone project — the most architecturally complete, most feature-rich, and most production-ready application of the four weeks. It combined everything: full-stack TypeScript, database design, vector search, multimodal AI, RAG patterns, streaming APIs, comprehensive testing, and production deployment. It's the project that makes the journey feel complete.

---

---

## Week 6 — Asteroid Bonanza (Multi-Agent AI Intelligence Platform)

### What Was Built

**Asteroid Bonanza** is an AI-powered intelligence platform for analyzing near-Earth asteroids across four dimensions simultaneously: orbital accessibility, mineral composition, resource economics, and planetary defense risk. It ingests real data from NASA and JPL APIs, maintains a semantic search database of 35,000+ catalogued objects, runs a swarm of four specialized AI agents to produce multi-dimensional analyses with explicit confidence scoring, provides a grounded RAG-powered Analyst for open-ended research questions, and visualizes asteroid orbits in an interactive Three.js orbital canvas.

The app is live in production at **https://asteroid-bonanza.vercel.app** (frontend) and **https://asteroid-bonanza.up.railway.app** (backend).

**Tagline**: *The intelligence layer for the space resource revolution.*

### Technical Stack

- **Frontend**: Angular 21 (signals-first), TypeScript strict, Tailwind CSS v4 (CSS-first `@theme {}`), Three.js orbital canvas
- **Backend**: Node.js 22 LTS, Express 5, TypeScript (NodeNext module resolution)
- **AI**: Anthropic SDK — Claude Sonnet 4.6 (all agents + Analyst), Claude Haiku 4.5 (planned classification subtasks)
- **Embeddings**: Voyage AI `voyage-large-2-instruct` — 1024 dimensions, cosine similarity
- **Database**: Supabase (PostgreSQL + pgvector) with 7 migrations and full rollback support
- **Testing**: Vitest (209 server tests, 96.61% coverage) + Playwright E2E (226 passed, both 375px and 1280px viewports)
- **Deployment**: Railway (backend) + Vercel (frontend)

### The Nine Phases

**Phase 0 — Foundation**: Monorepo scaffolding with npm workspaces (`client`, `server`, `shared`, `scripts`), TypeScript strict mode everywhere, Tailwind v4 CSS-first configuration, Husky pre-commit hooks (lint + typecheck), gitleaks secret scanning, GitHub Actions CI, and a comprehensive `CLAUDE.md` AI context file written before a single line of application code. Also established: `.claude/rules/` domain-specific behavioral rule files that encode architectural decisions as constraints on future AI-assisted development.

**Phase 1 — Data Layer**: Seven Supabase migrations with rollbacks, pgvector extension, Row Level Security on all tables, and a full NASA ingest pipeline (`ingestNasa.ts`) pulling from NeoWs, JPL SBDB, JPL NHATS, and JPL CAD. Over 35,000 near-Earth objects loaded. AI-generated fields (embeddings, composition summaries, economic tiers) left nullable with `-- populated by <pipeline>` schema comments — populated in Phase 5 after agents exist.

**Phase 2 — Search & Browse**: Full-text search, semantic vector search (Voyage AI embeddings + cosine similarity), and an asteroid dossier view with orbital elements, spectral class, physical parameters, close-approach timeline component, and "Pending analysis" placeholders for Phase 5 AI fields.

**Phase 3 — RAG Knowledge Base**: Dual-index RAG architecture: `science_chunks` (NASA mission reports, spectral surveys, peer-reviewed papers) and `scenario_chunks` (NASA Vision 2050, ISRU roadmaps, space economics analyses). Document-structure chunking (H1/H2/H3 hierarchy preserved), 512-token max chunks, 50-token overlap for academic papers. Voyage AI embeddings via raw `fetch()` to the Voyage API — no npm SDK exists. The two-index separation is architectural: hard science facts and 2050 projections must never be mixed.

**Phase 4 — The AI Analyst**: A grounded RAG chatbot powered by Claude Sonnet 4.6. Streams responses via Server-Sent Events (SSE). Session history stored in `analyst_sessions` with a 24-hour TTL. The Analyst is architecturally constrained: it cannot use model weights for asteroid facts — all data must be sourced from the indices with explicit `source_id` citations. Responses clearly label `[Science fact]` vs. `[2050 Projection]`. Optional context anchoring: when viewing a specific asteroid's dossier, the Analyst receives that object's data as additional context.

**Phase 5 — The Agent Swarm**: The centerpiece of the project. Four domain agents (Navigator, Geologist, Economist, Risk Assessor) plus a Lead Orchestrator, all built on the Anthropic SDK directly — no LangChain. Key architectural patterns:

- **SwarmState**: All inter-agent communication flows through a typed shared state object. Agents mutate only their designated slice; the Orchestrator reads all and passes summaries. No direct agent-to-agent calls.
- **Anthropic Tool Use**: Each agent has tools (`fetchNHATSData`, `queryScienceIndex`, `queryScenarioIndex`, etc.) that call real NASA APIs and RAG indices at runtime. The LLM reasons about the returned data; it does not invent it.
- **Confidence scoring**: Computed by the Orchestrator from observable fields (`dataCompleteness`, `sourceQuality`, `assumptionsRequired`) — never self-reported. LLMs are systematically overconfident; we never ask "how confident are you?" and accept the answer.
- **HANDOFF_THRESHOLD calibration**: Initially set to 0.55. After live runs on Apophis, Bennu, and Ryugu, CAD/NHATS API data gaps structurally capped orbital confidence. Recalibrated to 0.30. When aggregate confidence falls below threshold, the Orchestrator produces a `HandoffPackage` (what was found, where confidence broke down, what a human expert would need) rather than a synthesis. Handoff is a first-class feature, not an error state.
- **Parallel execution**: Geologist and Risk Assessor run in parallel (they are independent); Economist runs after Geologist (it needs composition data).

**Phase 6 — Mission Planning & Orbital Canvas**: A mission scenario builder where users can compare delta-V tradeoffs across a portfolio of asteroid targets and model launch windows. Three.js orbital canvas with full 3D PerspectiveCamera on desktop and orthographic top-down OrthographicCamera with touch controls on mobile. Canvas 2D fallback for WSL2 environments where WebGL is unavailable — this fallback is permanently required and must never be removed.

**Phase 7 — Planetary Defense Watch**: Real-time close-approach dashboard with configurable lookahead window, Potentially Hazardous Asteroid tracking with threat-level indicators, and a dedicated Apophis 2029 case study — a hand-crafted featured analysis of the most closely watched near-Earth object, with a live countdown to the April 13, 2029 close approach.

**Phase 8 — Hardening & Production Deployment**: Full test coverage to 96.61% on the server (209 Vitest tests across 18 test files). Playwright E2E suite: 226 tests passing at both mobile and desktop viewports. Accessibility audit with `@axe-core/playwright` — zero critical violations. API response caching headers, Three.js 30fps mobile cap, lazy-loaded Angular routes, input validation and rate limiting across all endpoints, gitleaks clean on full git history. Deployed to Railway + Vercel with database migrations applied to production Supabase. SSE agent progress streaming (`agent_start`, `agent_complete`, `analysis_complete`) so the frontend shows live dot-status per agent during analysis.

**Phase 9 — Deep Agent Observability Streaming**: Extended SSE streaming to individual agent reasoning events in real time: `agent_event` carries each `tool_call`, `tool_result`, `rag_lookup`, and `output` as it happens inside each agent. Synthesis streams token-by-token via Anthropic's `messages.stream()` API. The frontend shows live collapsible per-agent event panels during analysis runs — users watch each agent's tool calls and RAG lookups as they fire, then see the synthesis text appear word by word.

### Key Technical Discoveries

**The `app.ts` / `server.ts` split at scale**: A pattern first introduced in Week 3 (Strawberry Star) became the enforced convention in this project — documented in `.claude/rules/server.md`, enforced in `.claude/rules/testing.md`, and the root cause of all `port-in-use` test failures when violated. At scale (18 test files, 209 tests), this split is what makes parallel test runs reliable.

**AgentTrace observability architecture**: Each agent runner maintains an `AgentTrace` — a structured log of every tool call, RAG lookup, and output event with timestamps and metadata. Phase 8 surfaced this trace post-run; Phase 9 made it live. The `onProgress` callback pattern (threading a callback through the orchestrator → agent runners → tool dispatch loops) is the key architectural technique. No agent-to-agent communication; all events flow through the orchestrator's callback chain.

**Angular 21 signals-first at application scale**: This was the first project to use Angular 21's signals model (`signal()`, `computed()`, `effect()`) throughout an application with seven feature slices, a Three.js canvas, and two separate SSE streaming connections (analysis + analyst chat). The key lesson: signals eliminate the RxJS `Subject`/`BehaviorSubject` ceremony for local state while `toSignal()` bridges HTTP `Observable` boundaries cleanly. No NgRx was needed at any point.

**Three.js in Angular with WSL2 constraints**: `ngAfterViewInit` + `setTimeout(0)` is required to initialize the Three.js scene — `afterNextRender` does not reliably fire after the canvas element is in the DOM in Angular 21. `WebGLRenderingContext` is unavailable in WSL2; the Canvas 2D fallback branch must be maintained permanently. `three@0.183.x` ships no `.d.ts` files — `@types/three` is a required `devDependency`, not optional. Mobile optimization: `OrthographicCamera` top-down view, `powerPreference: 'low-power'`, antialiasing off, pixel ratio capped at 1, animation throttled to 33ms/frame (30fps).

**Voyage AI as a raw HTTP call**: No official Voyage AI npm SDK exists. All embedding generation goes through a `voyageService.ts` that calls `https://api.voyageai.com/v1/embeddings` via raw `fetch()`. The 1024-dimension embedding space must be consistent: the same model used at ingest time must be used at query time. The retrieval quality baseline established: 17/20 test questions passing at ≥ 0.40 cosine similarity threshold.

**HANDOFF_THRESHOLD as a living calibration**: Setting a handoff threshold at project inception and never revisiting it is an AI engineering anti-pattern. The threshold started at 0.55 (a reasonable initial estimate) and was recalibrated to 0.30 after real production runs revealed that data gaps in NASA's NHATS and CAD APIs structurally cap orbital confidence for many asteroids. The lesson: AI system thresholds must be calibrated empirically on real data, not set theoretically and forgotten. Document the calibration process and the reasons; future maintainers need to understand why.

**Two RAG indices, never collapsed into one**: The architectural decision to maintain separate `science_chunks` and `scenario_chunks` indices proved its value during agent development. When the Economist Agent queries both indices simultaneously, the model receives context with explicit `source_type` labels. It knows which claims are established science and which are 2050 projections. Collapsing both into a single index would allow the model to conflate speculation with fact in ways that are very difficult to detect or prevent.

**Spec-first workflow at maximum fidelity**: By Week 6, the spec-first workflow that emerged in Week 3 reached its fullest expression. Before a single line of application code was written: a complete `CLAUDE.md` AI context file, nine phase documents in `project-specs/roadmap/`, six domain rule files in `.claude/rules/`, a full architecture doc, database schema doc, API integration doc, and testing strategy doc. The CLAUDE.md was written as a constraint system for AI-assisted development — encoding every key architectural decision as an explicit rule that Claude Code would enforce throughout the project. This is a professional AI engineering pattern: treat your AI collaborator's context as a first-class engineering artifact.

**`AgentFn<TOutput>` signature discipline**: Every agent in the swarm has the same TypeScript function signature: `(asteroid: AsteroidRecord, state: SwarmState, missionParams: MissionParams) => Promise<TOutput>`. Every agent output interface includes `status: 'success' | 'partial' | 'failed'`, `confidence: ConfidenceScore`, `sources: string[]`, and the domain-specific payload. No agent returns `any`. This discipline made it possible to write the Orchestrator's synthesis and handoff logic once, generically, without knowing the internals of any individual agent.

**E2E test resilience — webkit vs. chromium**: The Playwright E2E suite initially used `devices['iPhone SE']` for mobile testing, which targets WebKit. WSL2 does not have WebKit installed. All ~120 mobile E2E tests failed at the runner level, not the assertion level. Fix: replace the device preset with an explicit `{ browserName: 'chromium', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }` config. The lesson generalizes: when E2E tests fail at the browser launch level, suspect the runner environment before the test assertions.

**AI audit as a structured phase deliverable**: Before Phase 8, a formal `ai-audit` was run — a systematic review of every AI-touching file against the architecture spec. Sixteen issues were found and fixed: hardcoded model strings replaced with imports from `shared/models.js`, self-reported confidence language removed from agent prompts, missing `source_id` citations added, RAG routing logic corrected. Four new `.claude/rules/` files were created from the audit findings. The audit also added `git commit` and `git push` deny rules to `.claude/settings.json` — codifying the "user commits only" rule at the tool permission level.

### What This Week Represented

Asteroid Bonanza is the capstone project — the most architecturally ambitious, most feature-complete, and most rigorously engineered application of the six weeks. It brought together every pattern from the preceding weeks (TypeScript strict mode, NodeNext module resolution, the app/server testing split, Tailwind v4 CSS-first, Railway + Vercel deployment, SSE streaming, spec-first development) and added a new layer: production AI systems engineering at the orchestration level.

The key distinction from earlier AI work (ChronoQuizzr's two-agent pipeline, Poster Pilot's single-agent RAG) is **orchestration**: four specialized agents coordinated by a state machine, with typed inter-agent communication, parallel execution, sequential dependencies, dynamic confidence scoring, and two distinct output paths (synthesis vs. handoff). This is the pattern at the core of production AI applications — not calling a model API, but designing the system around it.

---

## The Bigger Picture: Six Weeks of Cumulative Growth

### The Arc of Complexity

Looking at the six weeks as a sequence, there's a clear progression in both technical ambition and engineering discipline:

| Week | Project | Core Challenge | AI Involvement |
|------|---------|---------------|----------------|
| 2 | Mighty Mileage Meetup | Full-stack maps, Angular toolchain | None |
| 3 | Strawberry Star | Full-stack TypeScript, ESM, demo mode | None |
| 4 | ChronoQuizzr | Multi-agent LLM pipelines, game mechanics | Claude Haiku (adversarial content generation) |
| 5 | Poster Pilot | Vector search, RAG, multimodal AI, production scale | Claude Sonnet (conversational RAG) + CLIP |
| 6 | Asteroid Bonanza | Multi-agent swarm, dual RAG, observability, full AI system design | Claude Sonnet (4-agent swarm + RAG Analyst) + Voyage AI |

Weeks 2 and 3 built the engineering foundations. Weeks 4 and 5 applied those foundations to AI-powered products. Week 6 elevated further: it's not just "AI-powered" — it's a system *designed around AI* from the ground up, with orchestration, confidence scoring, dual knowledge indices, real-time observability, and human handoff as first-class architectural concerns.

### Technologies Mastered Across All Six Projects

**TypeScript (Strict Mode)**
Every project used TypeScript with `strict: true`. Over four weeks, strict TypeScript went from a constraint to a communication tool — types became the primary way of expressing intent, encoding state machines, and catching bugs before runtime. The `Omit<HistoricalEvent, 'hiddenCoords'>` pattern in ChronoQuizzr and the `PosterResult` type hierarchy in Poster Pilot are examples of types doing real architectural work.

**Tailwind CSS v4 (CSS-First)**
All four projects used Tailwind v4's CSS-first `@theme {}` system. The Angular PostCSS discovery in Week 2 (`.postcssrc.json` vs `postcss.config.js`) and the `--color-trim` vs `--color-border` collision workaround in ChronoQuizzr are examples of hard-won v4-specific knowledge that accumulated across the weeks.

**Full-Stack Architecture with Separation of Concerns**
Every project maintained strict separation: UI components don't call APIs directly, routes don't contain business logic, business logic doesn't reach into routes. This pattern was first established in Week 2 (Angular services), reinforced in Week 3 (Express layered architecture), and became a non-negotiable convention by Weeks 4 and 5.

**Testing as a First-Class Deliverable**
The test suites grew in sophistication week over week:
- Week 2: 226 unit tests, 7 E2E tests
- Week 3: Vitest unit + supertest integration tests
- Week 4: 71 Vitest tests + 2 Playwright E2E
- Week 5: 253 Vitest unit/integration tests + 31 Playwright E2E, 99.54% service coverage

By Week 5, tests weren't written after the fact — they were written alongside implementation, with mock isolation, coverage thresholds, and CI enforcement.

**Railway + Vercel Deployment**
ChronoQuizzr, Poster Pilot, and Asteroid Bonanza were all deployed to Railway (backend) + Vercel (frontend). Each deployment surfaced different failure modes — the Railpack vs. nixpacks distinction, `NODE_ENV=production` skipping devDependencies, rootDir expansion from shared TypeScript files, the EBUSY error from double-running `npm ci` — building a comprehensive mental model of how these platforms work at the build and runtime layer. By Week 6, the Railway + Vercel deployment cycle was familiar enough that the full production launch (database migrations + backend + frontend) completed without incident on the first attempt.

**Leaflet Maps**
Leaflet appeared in three of the four projects (Meetup app, ChronoQuizzr, and indirectly in Poster Pilot's map considerations). Testing Leaflet — which manipulates the DOM directly on initialization — required different solutions in Angular (`NO_ERRORS_SCHEMA`) vs. React (full `vi.mock`), but the underlying challenge was the same. This recurring problem built genuine expertise in the boundary between DOM-heavy libraries and test environments.

### AI Engineering Principles That Emerged

The most significant professional growth across these four weeks is in **AI engineering** — not just "call an API," but designing AI systems responsibly:

**Grounding and Anti-Hallucination**: The Archivist in Poster Pilot cannot fabricate facts. Its system prompt explicitly instructs it to say "I don't know" when context is insufficient. The Chronicler in ChronoQuizzr cannot leak location names. In both cases, the constraint is architectural — enforced by the system prompt, the retrieval pipeline, and confidence thresholds — not just hoped for.

**Confidence Scoring**: Both AI-powered projects (ChronoQuizzr and Poster Pilot) quantify uncertainty explicitly. The Haversine scoring formula in ChronoQuizzr is a direct measure of distance from truth. The three-layer confidence system in Poster Pilot (`embedding_confidence`, `metadata_completeness`, `overall_confidence`) provides nuanced quality signals at every level.

**Human Escalation Paths**: When the AI isn't confident enough, both projects have explicit escalation paths — ChronoQuizzr's difficulty tiers signal to the player, and Poster Pilot's Human Handoff (`similarity_score < 0.72`) surfaces "The Red Button" and routes the user to a human archivist. This is a professional AI engineering pattern: never pretend the model is more capable than it is.

**Multi-Agent Pipelines**: ChronoQuizzr's Generate→Adversary→Rewrite loop introduced the multi-agent pattern — separate agents with adversarial roles collaborating to produce better output than either could alone. Asteroid Bonanza scaled this to a full orchestrated swarm: four specialized domain agents with typed SwarmState, parallel execution, sequential dependencies, and a state machine Orchestrator that synthesizes or hands off based on dynamically computed confidence scores.

**Provider Abstraction**: The `LLMProvider` interface pattern in ChronoQuizzr, and the `FatalProviderError` pattern for non-retryable failures, showed how to build AI features that are provider-agnostic. The pivot from Gemini to Claude (documented in an ADR) demonstrated this abstraction working in practice. Asteroid Bonanza extended this further with a `shared/models.js` constants file — model strings are never hardcoded in agent files, so swapping models across the swarm requires changing one file rather than hunting through agent implementations.

**Real-Time Observability Streaming**: Asteroid Bonanza introduced a pattern absent from all prior projects: per-event SSE streaming from inside agent execution. The `onProgress` callback threaded through the orchestrator into each agent runner, firing on every tool call, RAG lookup, and output event. This gives users a live window into AI reasoning — not a spinner while the model thinks, but a real-time trace of every decision. The synthesis then streams token-by-token. This observability-first design is a professional AI engineering pattern for building trustworthy systems.

### The Spec-First Philosophy

One meta-pattern that ran through all four weeks was the **spec-first workflow**: write a specification document, get explicit approval, then write code. This created several benefits:
- Alignment on scope before any implementation investment
- A written record of every architectural decision and its rationale
- A forcing function to think through edge cases before they became bugs
- A natural checkpoint to reconsider approach before committing to it

By Week 5, this was formalized into a full project-specs directory with detailed phase documents, an ADR for the CLIP model selection, and path-specific Claude rule files (`.claude/rules/`) that encode the decisions as constraints on future work. By Week 6, the practice reached its apex: a `CLAUDE.md` written as a constraint system for AI-assisted development, nine phase spec documents written before any application code, six domain rule files covering agents, RAG, database, deployment, server, and Angular, and a formal `ai-audit` pass before the hardening phase to ensure every AI-touching file complied with the architecture spec.

### What Six Weeks Produced

Across these six projects, the work produced:

- **5 deployed, production-quality applications** (Weeks 2 and 3 were not deployed; Weeks 4, 5, and 6 are live)
- **3 different frontend frameworks** (Angular, React, React+3D — and Angular again at the capstone with signals-first architecture)
- **2 different backend languages** (Rails, Node.js/TypeScript x4)
- **35,000+ near-Earth asteroids** catalogued with orbital elements, spectral classification, and AI-generated analysis
- **5,000+ historical posters** indexed in a multimodal semantic vector database
- **A 4-agent AI swarm** with typed SwarmState, parallel execution, dynamic confidence scoring, and human handoff
- **Dual-index RAG** separating hard science from 2050 projections, both grounded and cited
- **Grounded RAG chatbots** with confidence scoring, human escalation paths, and streaming responses
- **Multimodal vector search** combining text and image in the same CLIP embedding space
- **Real-time agent observability** streaming tool calls, RAG lookups, and synthesis tokens as they happen
- **Three.js interactive orbital visualization** with Canvas 2D fallback for non-WebGL environments
- **700+ passing tests** across unit, integration, and E2E layers (across all six projects)
- **Full deployment experience** with Railway, Vercel, Supabase, Replicate, and NASA/JPL public APIs

More than the code, though, what six weeks produced is a **professional AI systems engineering mindset** — one that plans before building, treats AI context files as first-class engineering artifacts, tests as a first-class concern, quantifies AI uncertainty, provides human escalation paths, designs for observability from the start, and writes code that is explicit, typed, and legible rather than clever and magical.

The arc across six weeks is meaningful: from "learn the Angular toolchain" (Week 2) to "design a production multi-agent intelligence platform from first principles" (Week 6). Each week built on the last, each bug taught a durable lesson, and each project looked less like coursework and more like the kind of thing you'd ship at a company building serious AI products.

---

*Updated 2026-03-22 from session memory across all six Masterclass projects.*
