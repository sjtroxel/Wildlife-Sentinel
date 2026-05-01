# ChronoQuizzr

> *Drop a pin. Trust your gut. History doesn't lie — but the clues might.*

ChronoQuizzr is a historically-based [GeoGuessr](https://www.geoguessr.com/)-style geography quiz. Each round presents an obfuscated clue drawn from a real historical event — no place names, no landmarks, no easy answers. Drop a pin on the interactive world map, submit your guess, and find out just how well you know where history happened.

**Live app:** [chrono-quizzr.vercel.app](https://chrono-quizzr.vercel.app)
**Backend API:** [chrono-quizzr.up.railway.app](https://chrono-quizzr.up.railway.app)

---

## Features

- **5-round game sessions** — each round reveals a new obfuscated historical clue
- **Haversine-based scoring** — score up to 5,000 points per round based on real-world distance accuracy (max 25,000 per game)
- **AI-generated events** — the Chronicler Engine uses Claude Haiku to generate and adversarially verify historical events
- **Coordinate privacy** — true event coordinates are withheld server-side until after each guess is submitted
- **Dark & Light themes** — "Inky Night" (default) and "Aged Map" parchment, persisted to localStorage
- **Responsive design** — full desktop two-column layout, mobile-optimised drawer panel
- **Round Logbook** — final score screen shows a ledger of all five rounds with distances and scores
- **71-test suite** — five-layer test coverage: unit, service, integration, component, and E2E

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Vite 7, Tailwind CSS v4, Leaflet + react-leaflet |
| **Backend** | Node.js, Express, TypeScript (compiled CommonJS) |
| **LLM** | Anthropic Claude Haiku (`claude-haiku-4-5-20251001`) |
| **Testing** | Vitest, React Testing Library, Playwright (Chromium) |
| **Frontend host** | Vercel |
| **Backend host** | Railway (Railpack) |

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- An [Anthropic API key](https://console.anthropic.com/) (required for LLM event generation; the static event pool works without it)

### First-Time Setup

Run these once after cloning:

```bash
npm install                        # root: installs concurrently only
npm install --prefix client        # React, Vite, Leaflet, Tailwind, TS deps
npm install --prefix server        # Express, Vitest, ts-node-dev, @types/*
```

### Environment Variables

Create `server/.env`:

```env
ANTHROPIC_API_KEY=your_key_here
FRONTEND_URL=http://localhost:5173
```

### Running in Development

```bash
npm run dev
```

This starts both services concurrently:

| Service | URL |
|---|---|
| React frontend (Vite HMR) | http://localhost:5173 |
| Express backend | http://localhost:3001 |

---

## Project Structure

This is a **scripts-orchestration layout** — not an npm Workspaces monorepo. Each sub-package has its own `node_modules/`.

```
chrono-quizzr/
├── shared/
│   └── types.d.ts          # Canonical TypeScript contracts (declaration file, no runtime output)
├── client/                 # "The Map" — React/Vite frontend
│   ├── src/
│   │   ├── components/     # GameBoard, MapView, CluePanel, ResultsOverlay, FinalScoreScreen, ThemeToggle
│   │   └── context/        # ThemeContext (dark/light, localStorage)
│   └── e2e/                # Playwright E2E tests
├── server/                 # "The Brain" — Node/Express backend
│   ├── routes/             # GET /api/game/start, POST /api/game/guess
│   ├── utils/              # haversine.ts, scorer.ts, logger.ts
│   ├── services/           # chroniclerEngine.ts (AI two-agent loop), eventGenerator.ts
│   ├── providers/          # anthropicProvider.ts (primary), geminiProvider.ts (interface + legacy)
│   ├── scripts/            # generateBatch.ts — offline event batch generator
│   └── data/
│       ├── events.json               # 10 hand-curated seed events
│       └── generated_events.json     # 10 Haiku-generated events (batch output)
├── project-specs/          # Architecture, API spec, testing strategy, ADRs
├── railway.toml            # Railway deployment config (must live at repo root)
└── package.json            # Root: concurrently only
```

### Shared Types (`@shared` alias)

Both packages import from `shared/types.d.ts` using the `@shared` alias:

```typescript
import type { HistoricalEvent, GameEvent, Guess, GuessResult } from '@shared/types'
```

Always use `import type` — types are erased at compile time, zero runtime overhead.

---

## Scoring Formula

The scoring is calculated by `server/utils/scorer.ts` using the [Haversine formula](https://en.wikipedia.org/wiki/Haversine_formula) for distance:

```
score = Math.round( 5000 × e^(−distance_km / 2000) )
```

| Distance | Score |
|---|---|
| 0 km (perfect) | **5,000** |
| 500 km | ~3,894 |
| 1,000 km | ~3,033 |
| 2,000 km | ~1,839 |
| 10,000 km | ~34 |

Maximum per game: **25,000** (5 rounds × 5,000).

---

## API Reference

Base path: `/api/game`

### `GET /api/game/start`

Returns 5 shuffled historical events for a new session. **Coordinates are stripped** from all events before the response is sent — they cannot be extracted from the network response.

**Response:** `GameEvent[]`

```json
[
  {
    "id": "sarajevo-1914",
    "clue": "In a narrow street of an old Austro-Hungarian city, a young nationalist fired the shots that ignited a continental war.",
    "year": 1914,
    "difficulty": "medium",
    "locationName": "Sarajevo, Bosnia",
    "source_url": "https://en.wikipedia.org/wiki/Assassination_of_Archduke_Franz_Ferdinand"
  }
]
```

### `POST /api/game/guess`

Submits a pin-drop guess. Returns the score and reveals the true coordinates.

**Request body:**
```json
{ "eventId": "sarajevo-1914", "lat": 44.5, "lng": 18.7 }
```

**Response:**
```json
{
  "distance": 14.3,
  "score": 4812,
  "trueCoords": { "lat": 43.8563, "lng": 18.4131 }
}
```

---

## Testing

Five layers of test coverage — 71 tests total.

| Layer | Framework | Count |
|---|---|---|
| Backend unit | Vitest | 14 |
| Backend service | Vitest + MockProvider | 8 |
| Backend integration | Vitest + supertest | 17 |
| Frontend component | Vitest + jsdom + RTL | 30 |
| E2E | Playwright (Chromium) | 2 |

```bash
# Server tests (39 Vitest tests)
npm test --prefix server

# Client unit tests (30 Vitest tests)
npm test --prefix client

# E2E tests (2 Playwright tests — starts dev stack if needed)
cd client && npx playwright test

# TypeScript type-checking
cd client && npx tsc -b --noEmit
cd server && npx tsc --noEmit
```

---

## Offline Event Generation

Generate a fresh batch of 10 AI-verified historical events:

```bash
npm run generate --prefix server
# writes → server/data/generated_events.json
```

Requires `ANTHROPIC_API_KEY` in `server/.env`. The Chronicler Engine runs a Generate → Adversary → Rewrite loop (up to 3 retries per event) to ensure each clue meets the obfuscation standard — no place names, no direct geographic identifiers, but fully solvable.

---

## Deployment

### Railway (Backend)

- **Root Directory in Railway UI:** leave **blank** (repo root must be in the build container so `shared/` is reachable)
- **Required env vars:** `ANTHROPIC_API_KEY`, `FRONTEND_URL`
- **Do not set `PORT`** — Railway injects it automatically

`railway.toml` at the repo root handles build and start:

```toml
[build]
buildCommand = "cd server && npm ci --include=dev && npm run build"

[deploy]
startCommand = "node server/dist/index.js"
```

### Vercel (Frontend)

- **Root Directory:** `client`
- **Required env var:** `VITE_API_URL=https://chrono-quizzr.up.railway.app`
- Framework, build command, and output directory are auto-detected

---

## The Two Personas

The project was designed with two expert personas to keep domain concerns separated:

**The Cartographer** — Leaflet.js, Tailwind v4 UI, coordinate-system edge cases, all `client/src/components/`

**The Chronicler** — Historical event sourcing, clue obfuscation, `events.json` curation, the AI event-generation pipeline

---

## License

MIT

---

## Acknowledgements

### A Note on the True Architects of This Project

No weekend of creative work is accomplished alone. Behind every great app stands a great support team, and this one was no exception.

---

**Strawberry** 🍓 *(she/her)*

Strawberry served as this project's Director of Ambient Ambience, stationed in her cat bed approximately twelve inches from the keyboard for the duration of development. Her contribution cannot be overstated. While lesser consultants might demand standups or deliverables, Strawberry offered something rarer: the soft, continuous hum of a purr that transforms even the most confounding TypeScript error into a manageable problem. She slept with the focused intensity of someone who has completely solved every open issue in her personal backlog and is now, wisely, resting. Her warm, contented presence was a constant reminder that some things in life simply work, and that is enough.

*Primary contributions: emotional regulation, ambient warmth, purr-based morale support.*

---

**PingFoot** 🐾 *(he/him)*

PingFoot assumed the role of Senior Wellness Engineer and Timekeeper, conducting scheduled rounds throughout the day with the quiet authority of someone who has read every RFC on the subject of dinnertime. His check-ins were precisely calibrated — close enough to the build pipeline to be noticed, well-timed enough to ensure that no work session stretched so long that its author forgot to feed his cats. PingFoot understands something that most project managers do not: that a developer who has not fed his cats is a developer who will write a bug. His presence near dinnertime was not merely punctual — it was *principled*.

*Primary contributions: time management, enforced break scheduling, critical path management (the critical path being: food bowl → developer → repeat).*

---

*To Strawberry and PingFoot: this one's for you. You didn't write a single line of code, and the codebase is better for it.*
