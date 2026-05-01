# Poster Pilot

**A production-grade, multimodal RAG platform for discovering and exploring historical poster collections.**

Poster Pilot is a Discovery Engine for visual history — indexing WPA art, NASA mission posters, WWII propaganda, patent medicine advertisements, and 39 other thematic series sourced from NARA, the Library of Congress, and the Smithsonian via the DPLA API. Users can search by text, image, or "vibe," explore curated series, and converse with **The Archivist** — a grounded RAG chatbot powered by Claude — to learn the history behind what they find.

**Live**: [poster-pilot.vercel.app](https://poster-pilot.vercel.app) · API: [poster-pilot.up.railway.app](https://poster-pilot.up.railway.app)

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Development Commands](#development-commands)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [The Archivist (RAG Chatbot)](#the-archivist-rag-chatbot)
- [Search Modes](#search-modes)
- [Confidence Scoring & Human Handoff](#confidence-scoring--human-handoff)
- [Design System](#design-system)
- [Testing](#testing)
- [Deployment](#deployment)
- [Series Catalog](#series-catalog)
- [Security](#security)

---

## Features

- **Multimodal Search** — search by text, image URL/upload, hybrid text+image, or open-ended "vibe" queries
- **CLIP Embeddings** — OpenAI `clip-vit-large-patch14` (768-dim) for unified text and image vector space
- **The Archivist** — a streaming RAG chatbot (Claude Sonnet 4.6) that cites specific NARA metadata fields and refuses to hallucinate
- **Human Handoff** — "The Red Button" surfaces automatically when AI confidence is low, routing users to a real archivist
- **Visual Siblings** — every poster detail page shows the 5 most visually similar posters via pgvector
- **Series Browse** — paginated exploration across 43 thematic collections (5,000+ posters)
- **Confidence Indicators** — every search result carries a similarity score with a tiered visual indicator
- **Dark Mode** — full light/dark theme with persistent preference
- **Responsive Layout** — optimized for mobile (320px), tablet (768px), and desktop (1024px+)
- **Accessibility** — zero axe-core violations; ARIA landmarks and focus management validated

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript (strict), Tailwind CSS v4 (CSS-first), React Router 6 |
| **Backend** | Node.js 22+, Express 5, TypeScript |
| **Database** | Supabase (PostgreSQL + pgvector extension) |
| **Embeddings** | OpenAI CLIP `clip-vit-large-patch14` via Replicate — 768-dim vectors |
| **LLM** | Claude Sonnet 4.6 via Anthropic SDK |
| **Testing** | Vitest (unit/integration), Playwright (E2E) |
| **Build** | Vite (frontend), tsx/esbuild (backend), npm workspaces |
| **CI/CD** | GitHub Actions — lint, typecheck, test, audit, gitleaks scan |
| **Deployment** | Railway (Express backend) + Vercel (Vite frontend SPA) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React 19 SPA)                                     │
│  Vite · React Router · Tailwind v4 · react-markdown         │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │  SearchBar  │  │  PosterGrid/Card  │  │  Archivist    │  │
│  │  (4 modes)  │  │  ConfidenceScore  │  │  Sidebar(SSE) │  │
│  └─────────────┘  └──────────────────┘  └───────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS / SSE
┌────────────────────────▼────────────────────────────────────┐
│  Express 5 API  (Railway · port 8080)                       │
│  helmet · cors · rate-limit · Zod validation                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ /search  │  │ /posters │  │ /series  │  │  /chat SSE │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘ │
│  ┌────▼─────────────▼──────────────▼───────────────▼──────┐ │
│  │              Services (business logic)                  │ │
│  │  searchService · clipService · archivistService        │ │
│  │  queryAnalyzer · posterService · rankFusion            │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────┬──────────────────────────┬───────────────────────┘
           │                          │
┌──────────▼──────────┐   ┌──────────▼──────────┐
│  Supabase           │   │  External APIs       │
│  PostgreSQL+pgvector │   │  Replicate (CLIP)   │
│  4 tables · 2 RPCs  │   │  Anthropic (Claude) │
│  RLS enabled        │   │  DPLA (data source) │
└─────────────────────┘   └─────────────────────┘
```

**Key module boundaries:**
- `client/` never imports from `server/` — shared types come exclusively from `shared/`
- `server/routes/` contains only request parsing and response formatting
- All business logic lives in `server/services/`
- The Supabase client is a singleton in `server/lib/supabase.ts`

---

## Project Structure

```
poster-pilot/
├── client/                        # React 19 frontend (Vite SPA)
│   ├── src/
│   │   ├── components/            # 14 presentational UI components
│   │   │   ├── ArchivistSidebar.tsx
│   │   │   ├── ArchivistMessage.tsx
│   │   │   ├── PosterCard.tsx
│   │   │   ├── PosterGrid.tsx
│   │   │   ├── SearchBar.tsx
│   │   │   ├── HandoffBanner.tsx
│   │   │   ├── ConfidenceIndicator.tsx
│   │   │   ├── ScoreLabel.tsx
│   │   │   ├── VisualSiblings.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── Footer.tsx
│   │   │   ├── SkeletonGrid.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   └── ErrorState.tsx
│   │   ├── pages/                 # Route-level components
│   │   │   ├── HomePage.tsx
│   │   │   ├── SearchPage.tsx
│   │   │   ├── PosterDetailPage.tsx
│   │   │   ├── SeriesPage.tsx
│   │   │   └── AboutPage.tsx
│   │   ├── hooks/
│   │   │   ├── useSearch.ts       # Search state + URL sync
│   │   │   └── useArchivist.ts    # SSE client + session management
│   │   ├── lib/
│   │   │   ├── api.ts             # Typed API client (all fetch calls)
│   │   │   ├── archivistContext.tsx  # React context for chat session
│   │   │   └── debug.ts           # Logging utility (no console.log)
│   │   ├── index.css              # Tailwind v4 @theme design tokens
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── vercel.json                # SPA routing rewrite rules
│
├── server/                        # Express 5 REST API
│   ├── src/
│   │   ├── index.ts               # App bootstrap (helmet, cors, rate-limit)
│   │   ├── routes/
│   │   │   ├── search.ts          # POST /api/search (4 modes)
│   │   │   ├── chat.ts            # POST /api/chat (SSE streaming)
│   │   │   ├── posters.ts         # GET /api/posters/:id + /siblings
│   │   │   └── series.ts          # GET /api/series/:slug (paginated)
│   │   ├── services/
│   │   │   ├── searchService.ts   # text/image/hybrid/vibe search + handoff logic
│   │   │   ├── clipService.ts     # CLIP embedding generation (Replicate)
│   │   │   ├── archivistService.ts # RAG pipeline + SSE response streaming
│   │   │   ├── queryAnalyzer.ts   # Query classification + vibe expansion
│   │   │   └── posterService.ts   # Poster CRUD + confidence scoring
│   │   ├── middleware/
│   │   │   └── errorHandler.ts    # Typed error classes + global handler
│   │   ├── lib/
│   │   │   ├── config.ts          # Zod env validation at startup
│   │   │   ├── supabase.ts        # Singleton Supabase client
│   │   │   ├── clipPreprocessor.ts # Text normalization (lowercase, 77-token limit)
│   │   │   ├── vectorMath.ts      # Cosine similarity
│   │   │   └── rankFusion.ts      # Reciprocal Rank Fusion (RRF)
│   │   └── workers/
│   │       ├── ingestWorker.ts    # CLI ingestion pipeline (DPLA → Supabase)
│   │       └── __fixtures__/      # DPLA sample fixture records (dev/test)
│   └── dist/                      # Compiled JS (production build)
│
├── shared/                        # Types and constants shared across workspaces
│   ├── src/
│   │   ├── types.ts               # 20+ domain types
│   │   └── constants.ts           # Thresholds, model IDs, token budgets
│   └── dist/                      # Compiled for Node.js runtime import
│
├── supabase/
│   ├── migrations/                # 10 timestamped SQL migration files
│   ├── migrations/rollbacks/      # Corresponding rollback scripts
│   └── seeds/                     # Series seed data
│
├── e2e/                           # Playwright E2E tests
│   ├── search-happy-path.spec.ts
│   ├── search-handoff.spec.ts
│   ├── poster-detail.spec.ts
│   ├── archivist.spec.ts
│   ├── dark-mode.spec.ts
│   ├── mobile-layout.spec.ts
│   ├── fixtures.ts
│   └── mock-api.ts
│
├── project-specs/                 # Specification documents (source of truth)
├── .claude/rules/                 # AI coding rules (path-specific)
├── .github/workflows/ci.yml       # GitHub Actions CI pipeline
├── railway.toml                   # Railway deployment configuration
├── playwright.config.ts
├── package.json                   # Root workspace config + scripts
├── .nvmrc                         # Node.js 22
├── .env.example                   # Environment variable template
└── CLAUDE.md                      # Project context for AI assistant
```

---

## Getting Started

### Prerequisites

- Node.js 22+ (see `.nvmrc`)
- A Supabase project with pgvector enabled
- API keys for Anthropic, Replicate, and DPLA

### Installation

```bash
git clone https://github.com/sjtroxel/AI-Masterclass-Week-5
cd poster-pilot
npm install
cp .env.example .env
# Fill in all values in .env
npm run dev
```

This starts:
- **Vite** dev server at `http://localhost:5173`
- **Express** API at `http://localhost:3001`

The shared types package is built automatically before either server starts.

### Database Setup

Apply all migrations in order from `supabase/migrations/`. Each file is prefixed with a timestamp for ordering. Rollbacks are in `supabase/migrations/rollbacks/`.

Seed the series table:
```sql
-- Run supabase/seeds/series.sql in the Supabase SQL editor
```

---

## Environment Variables

All variables are validated at server startup via Zod in `server/src/lib/config.ts`. The server refuses to start if any required variable is missing.

```bash
# LLM
ANTHROPIC_API_KEY=

# Embeddings
REPLICATE_API_KEY=
CLIP_MODEL_VERSION=fd95fe35085b5b9a63d830d3126311ee6b32a7a976c78eb5f210a3a007bcdda6

# Database
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # SERVER ONLY — never exposed to client

# Data Ingestion
DPLA_API_KEY=                    # Primary data source

# Server
PORT=3001                        # Railway overrides to 8080
CLIENT_ORIGIN=http://localhost:5173  # CORS allowlist

# Frontend (Vite — prefix required)
VITE_API_URL=http://localhost:3001
```

> The `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. It must never appear in any client-side file, build artifact, or committed code.

---

## Development Commands

```bash
# Full stack (recommended)
npm run dev

# Individual servers
npm run dev:client         # Vite on port 5173
npm run dev:server         # Express on port 3001 (tsx watch)

# Testing
npm test                   # Vitest (all workspaces)
npm run test:watch         # Watch mode
npm run test:e2e           # Playwright (requires dev server)

# Code quality
npm run lint               # ESLint across all workspaces
npm run typecheck          # tsc --noEmit across all workspaces

# Build
npm run build              # Full production build
npm run build:railway      # Backend only (for Railway CI)

# Data ingestion
npm run ingest -- --series=wpa-posters --limit=5 --random-embeddings   # dev (no Replicate)
npm run ingest -- --series=wpa-posters --limit=50                       # production
npm run ingest -- --series=wpa-posters --fixture=path/to/fixture.json  # from file
```

### Ingest Worker Flags

| Flag | Description |
|---|---|
| `--series=<slug>` | Target series (e.g., `wpa-posters`, `nasa-history`) |
| `--limit=<n>` | Cap records processed in this run |
| `--dpla-query=<q>` | Override default DPLA search query |
| `--fixture=<path>` | Load DPLA-format JSON instead of calling the API |
| `--random-embeddings` | Bypass Replicate; use random 768-dim unit vectors (dev only) |

---

## API Reference

All routes are prefixed `/api/`. Rate limited to 100 requests per 15 minutes. Input validated with Zod.

### `GET /api/health`

Returns server and database status.

```json
{ "status": "ok", "db": "connected", "timestamp": "2026-03-12T..." }
```

---

### `POST /api/search`

Execute a poster search in one of four modes.

**Request body:**
```typescript
{
  query?: string;          // required for text, hybrid, vibe modes (max 500 chars)
  image?: string;          // base64 data URI or HTTPS URL (required for image, hybrid)
  mode: "text" | "image" | "hybrid" | "vibe";
  series_filter?: string;  // series slug to scope results
  limit?: number;          // default 20, max 50
  session_id?: string;     // optional; server generates UUID if absent
}
```

**Response:**
```typescript
{
  results: Array<{
    poster: PosterResult;
    similarity_score: number;       // cosine similarity [0.0 – 1.0]
    confidence_level: "high" | "medium" | "low";
  }>;
  query_mode: "text" | "image" | "hybrid" | "vibe";
  human_handoff_needed: boolean;
  handoff_reason?: string;
}
```

---

### `GET /api/posters/:id`

Fetch full metadata for a single poster (UUID).

**Response:** `Poster` object — all metadata fields, no embedding vector.

---

### `GET /api/posters/:id/siblings`

Fetch the 5 most visually similar posters to the given poster.

**Response:** `VisualSibling[]` — `{ id, title, thumbnail_url, similarity_score }`

---

### `GET /api/series/:slug`

Paginated series browse.

**Query params:** `page` (default `1`), `limit` (default `20`)

**Response:**
```typescript
{
  series: Series;
  posters: PosterResult[];
  total: number;
  page: number;
  limit: number;
}
```

---

### `POST /api/chat` — Server-Sent Events

Stream a response from The Archivist.

**Request body:**
```typescript
{
  message: string;                          // user message (max 2000 chars)
  session_id: string;                       // UUID — create client-side, persist per tab
  poster_context_ids: string[];             // poster UUIDs from current search (max 20)
  poster_similarity_scores?: Record<string, number>;  // id → score
}
```

**SSE event stream:**
```
data: {"type":"token","content":"The WPA"}
data: {"type":"token","content":" Federal Art Project..."}
data: {"type":"done","citations":[...],"confidence":0.83,"session_id":"..."}
```

---

## Database Schema

### `posters`

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Internal ID |
| `nara_id` | text UNIQUE | NARA NAID or `dpla-{id}` fallback |
| `title` | text | Poster title |
| `date_created` | text | Date string (varies by source) |
| `creator` | text | Artist or agency |
| `description` | text | Archival description |
| `subject_tags` | text[] | Subject classifications |
| `series_id` | uuid FK | References `series.id` |
| `image_url` | text | Full-resolution image URL |
| `thumbnail_url` | text | Thumbnail URL |
| `embedding` | vector(768) | CLIP embedding (IVFFlat indexed) |
| `embedding_confidence` | float4 | Cosine sim vs series centroid [0–1] |
| `metadata_completeness` | float4 | Non-null field ratio [0–1] |
| `overall_confidence` | float4 | Weighted: `(emb×0.7)+(meta×0.3)` |

### `series`

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Internal ID |
| `slug` | text UNIQUE | URL-safe identifier (e.g., `wpa-posters`) |
| `title` | text | Display name |
| `description` | text | Series description |
| `centroid_embedding` | vector(768) | Mean of all poster embeddings |
| `poster_count` | int | Auto-updated via trigger |

### `poster_search_events`

Audit log for every search. Columns: `session_id`, `query_text`, `query_mode`, `result_ids`, `top_similarity`, `human_handoff_needed`, `handoff_reason`, `created_at`.

### `archivist_sessions`

Conversation state. Columns: `session_id`, `messages` (JSONB), `poster_context` (uuid[]), `turn_count`, `total_tokens`, `expires_at` (24h TTL). Cleaned up nightly via pg_cron.

### RPC Functions

| Function | Description |
|---|---|
| `match_posters(embedding, threshold, count, series_filter)` | pgvector cosine similarity search |
| `get_visual_siblings(poster_id, count)` | Top-K nearest neighbors for a given poster |

### Migrations

| File | Purpose |
|---|---|
| `20260001000000_create_series.sql` | Series table |
| `20260001000001_create_posters.sql` | Posters table + pgvector + constraints |
| `20260001000002_create_search_events.sql` | Search audit log |
| `20260001000003_create_archivist_sessions.sql` | Chat session storage |
| `20260001000004_rls_policies.sql` | Row Level Security |
| `20260001000005_rpc_match_posters.sql` | Vector similarity RPC |
| `20260001000006_rpc_get_visual_siblings.sql` | Visual sibling RPC |
| `20260001000008_fix_match_posters_cast.sql` | Type cast fix |
| `20260001000009_pg_cron_cleanup.sql` | Scheduled session expiry |
| `20260001000010_fix_get_visual_siblings_ambiguous_id.sql` | Column disambiguation |

---

## The Archivist (RAG Chatbot)

The Archivist is a grounded RAG assistant that helps users understand the historical context of posters. It is powered by **Claude Sonnet 4.6** with strict constraints to prevent hallucination.

### How It Works

1. User sends a message alongside the IDs and similarity scores of posters currently in view
2. Server fetches full metadata for up to 20 posters from Supabase
3. Metadata is assembled into an XML context block and injected into the system prompt
4. Claude streams a response token-by-token via SSE
5. Citations are extracted from the response and returned in the `done` event
6. Conversation history is saved to `archivist_sessions` (24h TTL)

### Guardrails

- **Temperature `0.2`** — deterministic, grounded responses
- **Source citation required** — every factual claim must reference a specific NARA metadata field
- **No speculation** — system prompt instructs: *"If the provided context does not contain enough information to answer, say so. Do not invent historical facts, dates, creators, or descriptions."*
- **Scope boundary** — only discusses posters and historical context directly supported by retrieved metadata
- **Token budget** — system prompt + context + history capped at 20,000 tokens; conversation history is compressed (oldest first) as the budget approaches the limit; context blocks are never truncated

### Configuration

| Setting | Value |
|---|---|
| Model | `claude-sonnet-4-6` |
| Temperature | `0.2` |
| Max tokens per response | `900` |
| Max posters in context | `20` |
| Token budget | `20,000` |
| Session TTL | `24 hours` |

---

## Search Modes

| Mode | Description |
|---|---|
| **text** | Embeds the query string with CLIP's text encoder; cosine similarity against stored poster embeddings |
| **image** | Embeds a provided image URL or base64 upload with CLIP's image encoder; same vector space |
| **hybrid** | Runs text + image search independently; merges results with Reciprocal Rank Fusion (RRF) |
| **vibe** | Uses Claude to expand the open-ended query into 3–5 concrete descriptive phrases; runs parallel text searches and RRF-merges the results |

All search paths call the `match_posters` RPC with a configurable threshold and return results sorted by cosine similarity.

### CLIP Preprocessing

Text queries are normalized before embedding: lowercased, stripped of punctuation, and truncated to CLIP's 77-token limit. Truncation is logged as a warning. Image queries are normalized to base64 internally regardless of whether a URL or data URI was provided.

---

## Confidence Scoring & Human Handoff

Every search result carries a `similarity_score` — the raw cosine similarity from CLIP. This drives two UI features:

### Confidence Levels

| Score Range | Level | UI Treatment |
|---|---|---|
| ≥ 0.85 | High | Green indicator, no annotation |
| 0.72 – 0.84 | Medium | Amber indicator, subtle label |
| < 0.72 | Low | Red indicator, note shown |

### Human Handoff (The Red Button)

When the top result's similarity score is below `0.20` — meaning CLIP could not find genuinely on-topic content — the `HandoffBanner` appears. It explains that the AI's confidence is low and surfaces a direct link to contact a human archivist at NARA.

The `human_handoff_needed` flag is set exclusively by `server/services/searchService.ts` and written to `poster_search_events`. The frontend never sets this flag itself.

---

## Design System

Tailwind CSS v4 is used in **CSS-first mode** — there is no `tailwind.config.js`. All design tokens are defined in `client/src/index.css` using the `@theme {}` directive.

### Principles

- All colors reference `var(--color-*)` CSS custom properties — no hardcoded hex values in components
- Dark mode via `.dark` class on `<html>` — toggled by the Header, persisted in `localStorage`
- No inline `style={{}}` objects — Tailwind utilities or CSS custom properties only

### Typography

| Variable | Font | Usage |
|---|---|---|
| `--font-sans` | Inter Variable | Body text, UI labels |
| `--font-serif` | Fraunces Variable | Headings, archival feel |
| `--font-mono` | JetBrains Mono Variable | Metadata, code |
| `--font-display` | Playfair Display | Hero text, branding |

### Color Palette

- **Primary** — deep amber (archival warmth)
- **Surface** — warm paper whites (light) / near-black cool undertone (dark)
- **Danger** — WPA-inspired red, used for The Red Button and low-confidence indicators
- **Success / Warning** — green and amber for high / medium confidence tiers

---

## Testing

### Unit & Integration Tests (Vitest)

```bash
npm test              # Single run
npm run test:watch    # Watch mode
```

- **253 tests** across 18 test files — all passing
- **99.54% statement coverage** / **92.48% branch coverage** across `server/services/`
- Tests co-located in `__tests__/` directories alongside the modules they test
- All AI API calls (Replicate, Anthropic) are mocked

| Service | Tests | Coverage |
|---|---|---|
| `archivistService` | 29 | 100% stmt / 95.83% branch |
| `searchService` | 24 | 100% stmt / 96.15% branch |
| `clipService` | 12 | 96.39% stmt / 84.44% branch |
| `posterService` | 14 | 100% stmt / 88.88% branch |
| `queryAnalyzer` | 10 | 100% stmt / 97.05% branch |

### E2E Tests (Playwright)

```bash
npm run test:e2e
```

- **31/31 tests passing** on Chromium
- API mocked via `page.route()` — no live server required
- Covers: search flows, Human Handoff triggering, poster detail, Archivist chat, dark mode, mobile layout

---

## Deployment

### Backend — Railway

- **URL**: `https://poster-pilot.up.railway.app`
- **Config**: `railway.toml` — nixpacks builder, custom build and start commands
- **Build command**: `npm run build:railway` (builds `shared` + `server` only)
- **Start command**: `node server/dist/index.js`
- **Port**: Railway injects `PORT=8080`
- **Health check**: `GET /api/health`

Required Railway environment variables (10 total):
`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REPLICATE_API_KEY`, `CLIP_MODEL_VERSION`, `DPLA_API_KEY`, `CLIENT_ORIGIN`, `NODE_ENV=production`, `NARA_API_KEY` (optional)

### Frontend — Vercel

- **URL**: `https://poster-pilot.vercel.app`
- **Root directory**: `./` (repo root — required for npm workspace resolution)
- **Build command**: `npm run build --workspace=shared && npm run build --workspace=client`
- **Output directory**: `client/dist`
- **SPA routing**: `client/vercel.json` rewrites all paths to `/index.html`
- **Env var**: `VITE_API_URL=https://poster-pilot.up.railway.app`

### CI Pipeline (GitHub Actions)

On every push and PR:
1. `npm run lint` — ESLint across all workspaces
2. `npm run typecheck` — TypeScript strict check (zero errors required)
3. `npm test` — Vitest suite
4. `npm audit --audit-level=high` — dependency vulnerability scan
5. `gitleaks` — scans for accidentally committed secrets

---

## Series Catalog

43 thematic collections, 5,000+ posters total.

| Category | Series Slugs |
|---|---|
| **Founding 4** | `wpa-posters` · `nasa-history` · `patent-medicine` · `wwii-propaganda` |
| **Travel & Nature** | `travel-tourism` · `national-parks` · `conservation` · `outdoor-recreation` |
| **Public Health** | `public-health` · `food-nutrition` · `safety` · `anti-drugs` |
| **WWII Home Front** | `war-bonds` · `victory-garden` · `civil-defense` · `red-cross` |
| **Social Movements** | `suffrage` · `prohibition` · `labor-unions` · `immigration` · `social-reform` |
| **Military** | `military-recruitment` · `aviation` |
| **Civic** | `fire-prevention` · `literacy-education` · `political-campaign` · `elections` · `communist-socialist` |
| **World Events** | `world-fairs` |
| **Entertainment** | `music-concerts` · `opera-classical` · `theater-drama` · `silent-films` · `dance-ballet` · `art-exhibitions` · `radio-television` · `folk-festivals` · `vaudeville` · `wpa-arts` |
| **Sports** | `sports-recreation` · `olympics` · `boxing-wrestling` |

---

## Security

- **No API keys in the client** — all Anthropic, Supabase service-role, and Replicate calls go through the Express server
- **CORS** — explicit `origin` allowlist; never `*` in production
- **Rate limiting** — 100 requests / 15 minutes on all `/api/` routes via `express-rate-limit`
- **Helmet** — secure HTTP headers on every response
- **Input validation** — Zod schemas on every route that accepts user input
- **Row Level Security** — enabled on all Supabase tables; public can only read `posters`; writes require service role
- **`gitleaks`** — secret scanning runs in CI on every PR
- **`npm audit`** — builds fail on HIGH or CRITICAL vulnerabilities
- **`.env` in `.gitignore`** — only `.env.example` (with placeholders) is committed

---

## Data Source

Poster metadata is sourced from the **DPLA API** (`api.dp.la/v2/items`), which aggregates holdings from NARA, the Library of Congress, the Smithsonian Institution, and other institutions. The source data is **read-only** — Poster Pilot indexes and surfaces this content; it never modifies upstream records.

CLIP embeddings are computed once at ingest time using `openai/clip-vit-large-patch14` (768-dim vectors via Replicate) and stored in the `posters.embedding` column. Embeddings are never regenerated at query time.

---

## License

This project was built as part of an AI engineering course. Source code is available at [github.com/sjtroxel/AI-Masterclass-Week-5](https://github.com/sjtroxel/AI-Masterclass-Week-5).


---

**Special Acknowledgements**

As always, I was capably assisted in all phases of this project by my cats, PingFoot and Strawberry. They are the best cats in the whole world.

PingFoot is eleven years old and he provided constant, consistent reminders that he must be fed his prime delicacy of Fancy Feast every afternoon, supplemented by generous 24/7 bottomless supply of dry food. He also requires liberal helpings of cat treats. PingFoot supervised the Poster Pilot project sparingly but preferred to monitor the feeding schedule. Nevertheless, PingFoot provided great emotional support to the project and I am thankful for his distinguished generosity.

Strawberry is five years old and she snoozed peacefully and happily in her warm, soft catbed next to my feet every day whilst I worked on the project. Strawberry's constant proximity, punctuated by purring was evident and appreciated. Strawberry is an extremely good little girl cat. She loves treats very, very much. Also, Strawberry enjoys playing with her cat toys and hair-bands that my sisters leave behind when they visit! I am eternally grateful for Strawberry.