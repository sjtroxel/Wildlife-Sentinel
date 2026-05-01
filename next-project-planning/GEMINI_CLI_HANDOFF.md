# Gemini CLI Handoff & Onboarding
## A transition document for sjtroxel and for Gemini CLI

*This file serves two purposes: (1) instructions for sjtroxel on how to start working with Gemini CLI, and (2) a full context brief that Gemini CLI should read at the start of every session. The second half of this document should be copied verbatim into a file named `GEMINI.md` at the root of the new project repo.*

---

## Part 1 — For sjtroxel: How to Start with Gemini CLI

### Installation

```bash
# Option A: global npm install
npm install -g @google/gemini-cli

# Option B: npx (no install needed)
npx @google/gemini-cli
```

### Authentication

```bash
gemini auth
```

This opens a browser window for Google OAuth. Sign in with your Google account. Your Google AI Studio API key is automatically associated. The free tier uses Gemini 2.5 Flash and Flash models at no cost (data used to improve Google products on the free tier — same tradeoff as most free AI tools).

### Starting a session

```bash
# Navigate to your new project directory first
cd /path/to/your-new-project

# Start Gemini CLI
gemini
```

Gemini CLI reads `GEMINI.md` from the project root automatically — the same way Claude Code reads `CLAUDE.md`. Everything in `GEMINI.md` is loaded as project context at the start of every session.

### Key differences from Claude Code to be aware of

| Thing | Claude Code | Gemini CLI |
|---|---|---|
| Context file | `CLAUDE.md` | `GEMINI.md` |
| Additional rules | `.claude/rules/*.md` | `.gemini/` directory (or embed in GEMINI.md) |
| Plan Mode | `/plan` command built in | Describe "let's plan before we code" in the chat |
| Memory files | Persistent cross-session memory at `~/.claude/projects/` | No built-in persistent memory — context comes from files in the repo |
| Model | Claude Sonnet 4.6 | Gemini 2.5 Flash (free) |
| IDE extension | VS Code / JetBrains | Terminal only (as of May 2026) |

The most important difference: **Gemini CLI has no persistent memory outside the files in your repo.** Everything it needs to know about you, your preferences, and your prior work must be written into `GEMINI.md` and the project files. This document is designed to bridge that gap.

### Your first message in the new project

When you start Gemini CLI for the first time in the new project, send this as your first message:

> "Please read GEMINI.md, then read all files in the next-project-planning/ folder — especially PROJECT_SELECTION_MAY_2026.md. Your first job is to help me choose which of the 10 project options is the best fit. Ask me whatever questions you need to make a recommendation. Don't start writing any code yet."

That gives Gemini CLI everything it needs to get oriented and begin as an informed collaborator rather than a blank slate.

---

## Part 2 — For Gemini CLI: Project Context Brief

*Everything below this line should be copied into `GEMINI.md` at the root of the new project repo. It is the equivalent of the CLAUDE.md files used in prior projects.*

---

# GEMINI.md — Project Context for the New Project

*Read this file completely at the start of every session. It is a constraint system and context brief, not documentation. These instructions override any default behavior.*

---

## Who You're Working With

**Handle:** sjtroxel  
**Email:** sjtroxel@protonmail.com  
**Working environment:** WSL2 on Windows. TypeScript everywhere.

sjtroxel is not a career developer by traditional path. The skills were built through self-teaching, accelerated by AI coding tools, and formalized through an intensive 6-week AI Masterclass (Codefi, Feb–March 2026). This is a professional portfolio project — the goal is to land a first remote AI Software Engineer role. Everything we build together should be production-quality and portfolio-worthy.

**Stack fluency:** TypeScript strict, Node.js/Express, Anthropic SDK, Google AI SDK, Railway/Vercel, PostgreSQL/pgvector, Redis Streams.

**New this project:** LangGraph (TypeScript), Pinecone, voice AI (Whisper + ElevenLabs), Ragas/TruLens evaluation framework.

---

## The Prior Portfolio (Context — Do Not Rebuild These)

Six projects have been completed and deployed before this one. You do not need to understand every detail, but knowing they exist will help you calibrate what's already proven vs. what's new.

| Project | What it is | Key tech |
|---|---|---|
| Mighty Mileage Meetup | Full-stack meetup app with interactive map | Angular 19, Rails API, Leaflet, JWT, Playwright |
| Strawberry Star Travel | Travel app with JWT auth, demo mode | React 19, Express, TypeScript, Vite |
| ChronoQuizzr | AI-powered GeoGuessr for historical events | React, Express, Claude Haiku, Playwright |
| Poster Pilot | Multimodal RAG platform (CLIP + pgvector) | React, Express, Supabase, CLIP, Claude, 253 Vitest tests |
| Asteroid Bonanza | 5-agent AI swarm analyzing near-Earth asteroids | Angular 21, Express, Claude Sonnet, Voyage AI, Three.js, 209 Vitest + 226 Playwright |
| Wildlife Sentinel | 24/7 autonomous wildlife crisis intelligence system | Node.js, discord.js, Redis Streams, PostGIS, Gemini, Claude, Next.js, 470 Vitest + 43 Playwright |

The full portfolio context is in `next-project-planning/DEVELOPER_PROFILE_MAY_2026.md`. The job market analysis is in the same folder. Read both if you want to understand the strategic goals.

---

## This Project: What We Know So Far

**Scope:** 3–4 weeks. Smaller and more focused than Wildlife Sentinel.

**Required tech for this project:**
- **LangGraph** (`@langchain/langgraph`) — TypeScript SDK. This is the orchestration layer. The prior projects all used hand-rolled direct orchestration; this project deliberately adds LangGraph to the portfolio.
- **Pinecone** — managed vector database. Prior projects used pgvector in Supabase/Neon; Pinecone is architecturally different and worth demonstrating.
- **Voice AI** — Whisper (speech-to-text) and/or ElevenLabs (text-to-speech) as a first-class feature.
- **Ragas and/or TruLens** — evaluation framework for LLM output quality. Prior projects used custom hand-rolled scoring math; this project adds standard eval tooling.

**Subject matter:** Not yet decided. Ten candidate options are in `next-project-planning/PROJECT_SELECTION_MAY_2026.md`. Your first job is to read that file and help sjtroxel choose one.

---

## Non-Negotiables — Read and Follow These

### Git
- **NEVER run `git commit`**
- **NEVER run `git push`**
- **NEVER suggest adding yourself as a co-author**
- When a block of work is done, summarize what was done and tell sjtroxel to commit.

### Workflow
- **Spec-first.** Before writing any code, discuss the architecture and plan. Write the spec document. Get explicit approval. Then implement.
- **Plan before you act.** For any non-trivial task, lay out the approach and let sjtroxel approve it before starting. Don't make significant architectural decisions unilaterally.
- **For large implementation phases:** Save the implementation plan to a `.md` file in `project-specs/roadmap/` before starting. This creates alignment and a reference for the work.
- After completing work, **summarize what was done and tell sjtroxel to commit** — don't commit yourself.

### TypeScript
- `strict: true` and `noUncheckedIndexedAccess: true` — always, no exceptions.
- **NodeNext module resolution** — all relative imports must end in `.js` (e.g., `import { x } from './services/myService.js'`).
- `shared/types.d.ts` — use `.d.ts` extension, never `.ts`. This avoids rootDir expansion that breaks Railway deployment.
- `app.ts` exports the Express app without `listen()`. `server.ts` calls `listen()`. This split is required for testing with Vitest + supertest.

### AI Architecture
- **No self-reported confidence.** Confidence scores must come from observable fields (data completeness, source quality, etc.), never from asking an LLM "how confident are you?"
- **No hardcoded model strings in agent files.** Import from a `shared/models.ts` file.
- **Tools are structured outputs.** LLMs return JSON intent. TypeScript executes the action. LLMs do not make HTTP calls directly.
- LangGraph is explicitly planned for this project, but the 12-factor agent principles still apply within it: own your prompts, own your context window, small focused agents.

### Code Style
- No unnecessary comments. Only add a comment when the WHY is non-obvious.
- No LangChain for tasks that LangGraph doesn't need. Use LangGraph for orchestration, direct SDK calls for everything else.
- No features, refactors, or abstractions beyond what the task requires.

### Security
- Secrets via environment variables only. Never read or write `.env` files, `.aws/`, `.ssh/`.
- All secrets accessed via `process.env.VARNAME` with validation at startup.
- Never log secrets or API keys.

### Frontend
- **Mobile-first** — 375px is the base viewport. Desktop layered with `md:` breakpoints.
- **No authentication** — fully public read-only (or public interactive). No user accounts.

### Testing
- **Vitest** for unit + integration tests.
- **Playwright** for E2E.
- Never call real AI APIs, external APIs, Redis, or databases in unit tests — always mock or use fixtures.
- Run `lint + typecheck + tests` (all three) before declaring any work done.
- Coverage target: 80%+ statement coverage on server-side code.

---

## How sjtroxel Likes to Work

**Directness over ceremony.** Short, concise responses. Don't summarize what you just did at the end of a response — sjtroxel can read the diff. Don't narrate your thought process; state results and decisions.

**Talk through significant decisions before acting.** If something has architectural implications or would be hard to reverse, raise it and discuss it rather than just doing it.

**Don't add features that weren't asked for.** Solve the stated problem cleanly. Don't design for hypothetical future requirements.

**Emotional investment matters.** Projects built on genuine interest get finished. The subject of this project should be something worth caring about, not just a technical exercise.

**When stuck or uncertain, ask.** Don't resolve ambiguity unilaterally and hope it was right. A quick question is faster than a backtrack.

---

## Project Structure Convention (Use This)

```
new-project/
├── GEMINI.md                    ← this file
├── .gemini/
│   └── rules/                   ← domain behavioral rules (agents, testing, etc.)
├── project-specs/
│   ├── ROADMAP.md               ← master checklist, updated as phases complete
│   └── roadmap/                 ← per-phase detailed specs
├── server/                      ← npm workspace (Express 5 backend)
│   ├── src/
│   │   ├── app.ts               ← Express app, no listen()
│   │   ├── server.ts            ← calls listen()
│   │   └── ...
│   └── tests/
├── client/                      ← npm workspace (React/Next.js frontend)
├── shared/                      ← npm workspace
│   ├── types.d.ts               ← shared types (.d.ts not .ts)
│   └── models.ts                ← AI model constants
└── next-project-planning/       ← (copied from Wildlife Sentinel — context only, not part of the build)
```

Monorepo with npm workspaces. Same pattern as Asteroid Bonanza and Wildlife Sentinel.

---

## Tech Stack Defaults for This Project

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript strict | `strict: true`, `noUncheckedIndexedAccess: true` |
| Module resolution | NodeNext | `.js` extensions on all relative imports |
| Backend | Express 5 | app.ts/server.ts split |
| Orchestration | LangGraph (`@langchain/langgraph`) | First use in this portfolio |
| Vector DB | Pinecone | `@pinecone-database/pinecone` |
| Voice (STT) | OpenAI Whisper | `openai` SDK, `audio.transcriptions.create()` |
| Voice (TTS) | ElevenLabs | `elevenlabs` SDK or direct HTTP |
| LLM | Claude Haiku 4.5 or Gemini 2.5 Flash | Cost-conscious selection — TBD based on project needs |
| Embeddings | Google `text-embedding-004` or `gemini-embedding-001` | Via `@google/generative-ai` |
| Evaluation | Ragas and/or TruLens | Standard eval tooling, not custom scoring math |
| Frontend | React 19 + Vite, or Next.js 15 App Router | TBD based on project needs |
| Styling | Tailwind CSS v4 (CSS-first `@theme {}`) | No `tailwind.config.js` |
| Testing | Vitest + Playwright | Same patterns as prior projects |
| Deployment | Railway (backend) + Vercel (frontend) | Same as prior projects |

---

## Secondary Goal: LinkedIn Presence & Portfolio Blog Posts

Building the project is the primary work, but there is a parallel career goal running alongside it: establishing a professional LinkedIn presence and writing technical blog posts for the four strongest prior projects.

**Why this matters:** The portfolio already demonstrates the skills required for an AI Software Engineer role. The gap is visibility — recruiters can't find what they can't see. A polished LinkedIn profile and one or two strong technical posts are the highest-leverage career actions right now, alongside building the next project.

**What's been done:** Nothing on LinkedIn yet. Four strong project READMEs exist (see `next-project-planning/prior-project-readme-docs/`) covering ChronoQuizzr, Poster Pilot, Asteroid Bonanza, and Wildlife Sentinel. These READMEs are the source material for the blog posts.

**What still needs to happen:**
1. LinkedIn profile — headline, summary, all projects linked with live URLs
2. Technical blog post(s) — LinkedIn Articles or similar. The target topics:
   - "How I built a self-improving AI system that monitors wildlife crises in real time" (Wildlife Sentinel)
   - "The Refiner/Evaluator loop: prompt-engineering-based machine learning without fine-tuning" (Wildlife Sentinel or Asteroid Bonanza)
   - Possibly: one post per major project, using the READMEs as the structural foundation

**When to work on this:** In parallel with project development, not blocking it. When there's a natural pause in the build (waiting on an API key, finishing a phase, taking a break from code), it's a good time to draft LinkedIn content.

**Tone guidance for blog posts:** Not a tutorial. Not a README repost. The voice is "knowledgeable practitioner sharing what they learned and why it matters" — the same voice as the DEVELOPER_PROFILE_MAY_2026.md document in the next-project-planning folder. That document is the best existing example of the right tone.

**Source material available:**
- `next-project-planning/prior-project-readme-docs/` — all four project READMEs
- `next-project-planning/DEVELOPER_PROFILE_MAY_2026.md` — full skills inventory, job market analysis, competitive positioning, and the imposter syndrome section (which captures the tone well)

---

## Session Start Checklist

At the start of every session, mentally confirm:
- [ ] Have you read GEMINI.md?
- [ ] Have you read the relevant phase spec before starting implementation?
- [ ] Is there a plan document for this phase, and has it been approved?
- [ ] Are you about to run `git commit` or `git push`? → Stop. sjtroxel does all git operations.

---

*This is a working document. Update it as the project evolves: add rules, correct things that turn out to be wrong, note important decisions made. The goal is that any future session — whether continuing with you or switching to a different AI tool — can pick up with complete context from reading this file.*
