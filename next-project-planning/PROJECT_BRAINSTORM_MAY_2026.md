# Next Project Brainstorm — May 2026

*Written for sjtroxel. Companion to `DEVELOPER_PROFILE_MAY_2026.md`.*

*Goal: Identify the best next project given the portfolio gaps identified, the job market reality, and the developer's genuine interests. This is a decision document — concrete options with honest tradeoffs, leading to a recommendation.*

---

## What We're Optimizing For

Before listing ideas, the selection criteria. Not all of these are equal — some are must-haves, some are nice-to-haves.

**Must-haves:**
1. **Web app as primary output.** Recruiters won't join a Discord server. The project must have a live URL someone can visit and use in 30 seconds. No explanation required.
2. **New technical territory.** The portfolio already proves TypeScript, multi-agent pipelines, Redis Streams, RAG, PostGIS, Discord bots, SSE streaming. The next project should cover ground not yet demonstrated.
3. **Demonstrable in 30 seconds.** A recruiter should be able to open the URL, try one thing, and say "oh, that's interesting." Not a thesis to read — an experience to have.

**Strong preferences:**
4. **Emotional resonance.** The user explicitly attributes finishing Wildlife Sentinel and Asteroid Bonanza in part to caring about the subject. This is not soft — it's a productivity variable. Projects built on genuine interest get finished; projects that feel like exercises don't.
5. **Addresses the LangChain/LangGraph keyword gap.** This shows up in many job postings. Even if direct SDK usage is architecturally superior (and it often is), demonstrating familiarity with LangGraph signals fluency to a broader set of interviewers.
6. **Introduces at least one new AI modality.** Voice or computer vision. Not because they're shiny — because they are genuinely distinct engineering skills that the current portfolio doesn't demonstrate.

**Nice-to-haves:**
7. **Cost control mechanism.** The user liked Wildlife Sentinel's `/pause` and `/resume` commands. Something similar — the ability to easily halt and restart AI processing — is worth designing in.
8. **Evaluation as a first-class feature.** The job market research flagged Ragas/TruLens as increasingly expected. A project with explicit output quality evaluation built in would address this.

---

## The LangChain/LangGraph Question

This deserves a direct answer before the project ideas, because it affects the architecture choice for whatever comes next.

### What LangChain is

LangChain is a framework that wraps LLM calls, adds memory management, provides pre-built "chains" and "agents," and handles routing and tools. In 2023-2024, it was the dominant way people built LLM apps.

**Why the course told you to avoid it:** The Masterclass instructor's position — "direct SDK usage always" — is correct for a specific reason: LangChain abstracts away the things that matter most when something breaks. When a LangChain chain fails, you're debugging framework internals you didn't write, not code you understand. The 12-factor agent principles explicitly warn against "framework black boxes."

**The industry reality in 2026:** LangChain is still widely listed in job postings, but senior engineers often have complicated feelings about it. It's a useful library for quickly prototyping ideas. It's less appropriate for production systems where you need control. Many teams use LangChain to get started, then replace it with custom code as they scale.

### What LangGraph is

LangGraph is different from LangChain and worth taking seriously. It's specifically a **state machine orchestration framework** for multi-agent workflows. It defines nodes (agents/functions) and edges (transitions between them), including conditional branching and cycles. It handles complex orchestration patterns that are genuinely tedious to implement from scratch.

**The honest assessment:**

What you built in Wildlife Sentinel (Redis Streams pipeline with typed consumers) and Asteroid Bonanza (typed SwarmState with parallel execution and handoff) demonstrates the *underlying patterns* that LangGraph formalizes. You understand state machines and typed inter-agent communication deeply. LangGraph would feel familiar because you've already invented most of its concepts.

**The strategic move:** Build one project that explicitly uses LangGraph's API. Not because it's better architecture for your needs (it probably isn't), but because you'll be able to say in an interview: "I've used LangGraph. Here's what it's good at. Here's where I prefer direct orchestration. Here's why." That nuanced answer is more impressive than either "I've never used it" or "I use it for everything."

**TypeScript note:** LangGraph has a TypeScript SDK (`@langchain/langgraph`). The core concepts (StateGraph, addNode, addEdge, addConditionalEdges, compile) work in TypeScript. You don't need to go to Python to use it.

---

## The Gemini CLI Plan

You want to get familiar with Gemini CLI in case Claude Code is removed from the Pro plan. This is smart.

**The AI-CLI-TOOLS-COMPARISON.md document already in this folder is your reference.** The short version:
- Gemini CLI is free for Flash-tier models (Gemini 2.5 Flash, Flash-Lite, 3 Flash Preview)
- It works in your terminal just like Claude Code
- It uses `GEMINI.md` instead of `CLAUDE.md` for project context
- No official VS Code extension yet — terminal only
- Data used to improve Google products on the free tier (privacy note)

**How to use Gemini CLI alongside Claude Code in the next project:**

Don't try to use both on the same file at the same time. Instead, assign different responsibilities:

| Task | Tool |
|---|---|
| Architecture decisions, complex reasoning, code review | Claude Code (primary) |
| Bulk mechanical edits (rename, refactor, reformat) | Gemini CLI |
| Second opinion on a design decision | Gemini CLI |
| Generate test fixtures or boilerplate | Gemini CLI |
| Any GEMINI.md-style context work for practice | Gemini CLI |

**The setup to do before the next project starts:**
```bash
# Install
npm install -g @google/gemini-cli
# or
brew install gemini-cli

# Authenticate
gemini auth

# In your new project, create a GEMINI.md alongside your CLAUDE.md
# Same structure — project context, constraints, conventions
```

This accomplishes two things: you get genuinely familiar with a second tool, and you have a concrete backup plan if the Claude Code Pro situation changes.

---

## Voice AI: What It Actually Is (Not Scary)

You said you might be avoiding voice because you don't know it, not because you've evaluated it. Fair self-assessment. Here's what voice AI actually involves for a TypeScript developer in 2026:

**Speech-to-Text (STT):** User speaks → text. The main options:
- **OpenAI Whisper** (via API): `POST /v1/audio/transcriptions` with an audio file. Returns text. TypeScript SDK support. Price: ~$0.006/minute.
- **Deepgram**: Real-time streaming STT. WebSocket-based. TypeScript SDK. Cheaper than Whisper for live streams.
- **AssemblyAI**: Good TypeScript SDK, auto-detects speakers, good for meeting transcription.

**Text-to-Speech (TTS):** Text → audio. The main options:
- **ElevenLabs**: Highest quality voices, streaming supported. TypeScript SDK. ~$0.30/1K characters.
- **OpenAI TTS**: `POST /v1/audio/speech`. Simple, good quality, cheaper. Already in the OpenAI SDK you may have.
- **Google Cloud TTS**: Good quality, many voices, TypeScript support.

**What "voice AI in a project" actually looks like in practice:**

```typescript
// 1. Record audio in browser (MediaRecorder API)
const recorder = new MediaRecorder(stream);
const chunks: Blob[] = [];
recorder.ondataavailable = e => chunks.push(e.data);
recorder.onstop = () => {
  const blob = new Blob(chunks, { type: 'audio/webm' });
  sendToTranscription(blob);
};

// 2. Send to transcription API (server-side)
const formData = new FormData();
formData.append('file', audioBlob, 'recording.webm');
formData.append('model', 'whisper-1');
const response = await openai.audio.transcriptions.create({ ... });
const text = response.text;

// 3. Process with LLM (your existing skills)
const result = await llm.complete({ userMessage: text });

// 4. Optionally speak the response back
const speech = await openai.audio.speech.create({
  model: 'tts-1', voice: 'alloy', input: result
});
// stream the audio back to the browser
```

That's it. The browser recording, the STT call, the TTS call — each is ~10 lines of code you already know how to write. The hard part you already know: the LLM in the middle.

**Is it worth it for the portfolio?** Yes. Voice is a distinct enough modality that "I built a voice-enabled AI application" is a meaningful credential. It shows you can navigate the real-time audio pipeline, browser permissions, audio streaming, and latency considerations. Companies building voice products are actively hiring, and it's genuinely underrepresented in TypeScript portfolios.

---

## Computer Vision: What It Actually Is (Also Not Scary)

You already used computer vision in Poster Pilot (CLIP via Replicate). What you haven't done is used a **vision-capable LLM** — Claude's vision capability, GPT-4V, or Gemini Vision — to *understand* and *reason about* images.

**What vision-capable LLMs do:**

```typescript
// Claude can see images directly
const response = await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
      { type: 'text', text: 'What is happening in this image? Extract any text you see.' }
    ]
  }]
});
```

That's it. You already know how to call Claude. Giving it an image instead of just text is one additional parameter. The model understands the image, can describe it, extract text from it, identify objects, read charts, understand documents.

**Use cases that are actually impressive:**
- Upload a receipt/invoice → extract structured data (vendor, amount, date, line items)
- Screenshot analysis → convert UI screenshots into descriptions or code
- Chart/graph analysis → extract data points and describe trends
- Document understanding → extract key clauses from a contract
- The "eyestone" pattern from Week 6 — analyze what someone was looking at and describe their context

**Is it worth it for the portfolio?** Yes for the right project. "I built an application that understands images and documents using vision AI" is a meaningful credential, especially for companies building document intelligence, accessibility tools, or productivity software.

---

## Project Ideas

### Idea 1: VoiceNotes Intelligence — Smart Voice Memo Analyzer
**Elevator pitch:** Record or upload a voice memo → get structured intelligence back: action items, key decisions, follow-up questions, summary, mood/tone.

**Why it's interesting:** Every knowledge worker has a backlog of voice memos, meeting recordings, or audio notes that are essentially dark data. This makes them searchable, structured, and actionable.

**Tech stack:**
- Voice input: browser MediaRecorder → Whisper API (STT) or Deepgram (real-time)
- Voice output: TTS reads back the summary/action items (ElevenLabs or OpenAI TTS)
- LangGraph: orchestrates parallel extraction agents (action items agent, decisions agent, questions agent, summary agent)
- RAG: store transcripts + embeddings for semantic search across all memos
- Frontend: React/Next.js, audio recorder component, structured output display, search
- Backend: Express + LangGraph + pgvector

**New skills demonstrated:**
- Voice AI (STT + TTS)
- LangGraph orchestration (TypeScript)
- Multi-modal input (audio → text → structured output → audio)

**Demo value:** "Record yourself for 30 seconds about anything. Watch it extract your action items." Every recruiter immediately gets it.

**Emotional hook:** Universal. Everyone has this problem. You'll use it yourself while building it.

**Cost control:** Processing is on-demand (user triggers transcription). No background polling. LLM costs only when the user submits a memo.

**Concerns:**
- Whisper API cost is minimal but not zero. Need to be thoughtful about large file uploads.
- Audio file handling in the browser has edge cases (different codecs).

---

### Idea 2: DocVision — Intelligent Document Understanding Platform
**Elevator pitch:** Drop any document (PDF, image, screenshot, contract, receipt) → AI extracts structured data, makes it queryable, and answers questions about it.

**Why it's interesting:** Document AI is one of the most commercially valuable AI applications right now. Companies are actively building this. The skills are deeply transferable.

**Tech stack:**
- Vision AI: Claude vision API for image/document understanding
- LangGraph: document type detection → structured extraction pipeline → indexing
- RAG: every document becomes searchable via pgvector
- Frontend: drag-and-drop upload, document viewer, chat interface, extracted data panels
- Backend: Express + LangGraph + Neon/pgvector

**New skills demonstrated:**
- Computer vision (document understanding via vision LLM)
- LangGraph orchestration (conditional branching based on document type)
- Structured output extraction from unstructured inputs

**Demo value:** Upload a restaurant receipt, a contract page, a screenshot of a UI, a hand-written note. Each comes back with structured data and is instantly searchable. Recruiter sees it in 30 seconds.

**Emotional hook:** Moderate. Solving a real problem but not deeply personal. Good fit if you're interested in document intelligence as a domain.

**Cost control:** On-demand. Processing only when user uploads. Vision LLM calls are cheap (Claude Haiku handles this well).

---

### Idea 3: CodeScope — Multi-Agent Code Review Intelligence
**Elevator pitch:** Paste a code snippet or PR diff → five specialized agents review it simultaneously (security, performance, correctness, architecture, style) → synthesized prioritized feedback with confidence scores.

**Why it's interesting:** Every developer understands the value immediately. Directly demonstrates AI engineering competence to technical interviewers. And code review is the most relatable domain for a recruiter evaluating a developer's portfolio.

**Tech stack:**
- LangGraph: parallel agent execution (5 reviewers) → synthesis → prioritized output
- Evaluation built in: each agent produces confidence scores; evaluator assesses coverage
- Frontend: code editor with syntax highlighting (CodeMirror or Monaco), inline annotations, severity ratings
- No RAG required (or optional: RAG over common vulnerability patterns)
- Backend: Express + LangGraph

**New skills demonstrated:**
- LangGraph parallel agent execution
- Evaluation as a first-class feature (confidence scoring, coverage metrics)
- Monaco/CodeMirror editor integration (new UI challenge)

**Demo value:** Paste any code → get professional multi-dimensional review in 10-15 seconds. The recruiter reading your portfolio is a developer. This hits close to home for them.

**Emotional hook:** High if you genuinely care about code quality. This is a tool you'd actually use.

**Cost control:** On-demand. Only processes when the user submits code. Claude Haiku for individual reviewers, Sonnet for final synthesis — cost per review is <$0.05.

**Concerns:**
- Not a new subject domain — it's a developer tool about code. Less emotionally resonant if you want to build something about the world, not about software.
- Competitive space (GitHub Copilot review, CodeRabbit, etc.) — but your implementation would be demonstrably custom and your own architecture.

---

### Idea 4: NightMap — Real-Time Bird Migration Intelligence (The Migration, redesigned)
**Elevator pitch:** Every evening during migration season, NightMap shows you what's happening in the sky above North America right now — and why. A web app first, Discord optional.

**Why it's interesting (re-examining the original concern):**

The user's concern was: "it's another Discord bot." The redesign: make the **web app the primary product**, Discord optional. The BirdCast API provides genuinely stunning real-time data (hundreds of millions of birds moving in a single night). A Leaflet map showing migration traffic intensity by region, overlaid on weather patterns, with an LLM-generated narrative of what's happening tonight — that's a compelling web experience.

**Tech stack:**
- BirdCast API (migration traffic, nightly forecasts) + eBird API (species observations)
- Open-Meteo (weather conditions per region)
- LangGraph: nightly data assembly pipeline (forecast → weather enrichment → species identification → narrative generation)
- Refiner/Evaluator: morning-after accuracy agent compares prediction to actual radar data (demonstrates the learning loop again, but in a new domain)
- Frontend: Next.js + Leaflet map with migration traffic heatmap, animated overnight flight paths, species panel
- Discord: secondary output (opt-in, not primary)
- RAG: species ecology facts index (which species are likely flying tonight in each region and why)

**New skills demonstrated:**
- BirdCast + eBird as new data sources
- LangGraph orchestration
- Migration traffic visualization (heatmap patterns in Leaflet, not just point markers)
- Possibly voice: nightly audio briefing read by TTS

**Demo value:** Open the URL during spring or fall migration season → see hundreds of millions of birds moving across North America right now. Say "that's what's happening above us tonight." Powerful. Non-birders are surprised by the scale.

**Emotional hook:** High — especially if you care about nature. The invisible becomes visible. There's a "wait, really?" moment when you see the scale of migration. This is the same hook that made Wildlife Sentinel compelling — showing what's happening in the natural world that most people don't know about.

**Concerns:**
- Migration is seasonal (peak seasons: March–June, August–November). The project would look quieter in December.
- Similar to Wildlife Sentinel in overall architecture. The new skills are more about data sources and Leaflet visualization patterns than truly new AI patterns.
- The emotional hook exists, but you already have Wildlife Sentinel. Is there a stronger subject domain you haven't explored?

---

### Idea 5: The Screen Intelligence Platform (eyestone-inspired)
**Elevator pitch:** Capture your screen activity, understand it with vision AI, make your own work history searchable by meaning — not keywords.

**Why it's interesting:** The Week 6 class literally built a demo of this. It's the most ambitious project in the list. A local-first web app (or Electron desktop app) that periodically captures your screen, sends it through a vision model for description, embeds the description in a vector DB, and lets you search your own work history by intent rather than exact text.

**Tech stack:**
- Screen capture: Electron (desktop app) or browser screen capture API (`getDisplayMedia()`)
- Vision AI: Claude Haiku vision to describe frames
- LangGraph: batch processing pipeline (capture → dedup → describe → embed → store)
- Vector DB: pgvector or Chroma for semantic search
- Search frontend: semantic query → retrieve relevant moments → show screenshots with descriptions
- Refiner: the class demo's refiner pattern — agents that propose better description strategies, test them, score results, feed back

**New skills demonstrated:**
- Computer vision (multi-frame scene understanding)
- LangGraph with the full refiner/evaluator loop (different from Wildlife Sentinel's refiner)
- Electron or screen capture browser API (new platform)
- The complete observe → propose → test → score → refine loop from Week 6

**Demo value:** "Search your own screen history by meaning." Show it finding something the user was looking at 30 minutes ago by describing it in natural language. Instantly understandable.

**Emotional hook:** Highly personal — you use it yourself. Very self-referential for a developer who works on a computer all day.

**Concerns:**
- Privacy concerns make it harder to demo publicly (your screen has private things)
- Electron development adds a new platform layer
- Complex to get right — screen capture has platform-specific edge cases
- WSL2 complicates screen capture (the Canvas 2D fallback lesson from Asteroid Bonanza, but more severe)

---

### Idea 6: ResearchMind — Deep Research Agent Platform
**Elevator pitch:** Ask a complex question, deploy a swarm of research agents, get a comprehensive sourced report with explicit knowledge gaps identified.

**Why it's interesting:** Directly replicates what expensive AI research tools charge for — but open and transparent about how it works. The agent reasoning is fully observable (SSE streaming, your existing skill).

**Tech stack:**
- LangGraph: complex orchestration — initial query analysis → parallel specialized research agents → synthesis → fact-checking → gap identification
- Web search via Perplexity MCP or Brave Search API → feeds into RAG
- Evaluation built in: source quality scoring, coverage metrics
- Frontend: query input, live agent activity SSE panel (familiar from Asteroid Bonanza), structured report output with citations
- Backend: Express + LangGraph + pgvector (for session memory)

**New skills demonstrated:**
- LangGraph with complex conditional flows
- Web search integration in an agent pipeline
- Evaluation as a first-class feature

**Demo value:** "Ask it to research anything." The live agent activity panel shows it working in real time. Report comes back with citations and explicit knowledge gaps. Compelling for anyone who does research.

**Emotional hook:** Universal intellectual curiosity. The subject is the research itself.

**Concerns:**
- Web search costs can add up depending on search API pricing
- Quality ceiling is limited by what's publicly searchable
- Competitive: Perplexity, Gemini Research Mode, Claude Projects all do versions of this

---

## Technology Decision: LangGraph in TypeScript

Regardless of which project you choose, here's how to use LangGraph in TypeScript:

```bash
npm install @langchain/langgraph @langchain/core @langchain/anthropic
```

Basic structure (maps to what you already know from SwarmState in Asteroid Bonanza):

```typescript
import { StateGraph, END } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// Define your state type — equivalent to SwarmState in Asteroid Bonanza
interface WorkflowState {
  input: string;
  agentAOutput?: string;
  agentBOutput?: string;
  finalOutput?: string;
}

// Build the graph
const workflow = new StateGraph<WorkflowState>({
  channels: {
    input: null,
    agentAOutput: null,
    agentBOutput: null,
    finalOutput: null,
  }
});

// Add nodes — each is a function that takes state and returns partial state
workflow.addNode("agentA", async (state) => {
  // call your LLM, return partial state update
  return { agentAOutput: "result from agent A" };
});

workflow.addNode("synthesizer", async (state) => {
  const combined = `A: ${state.agentAOutput}, B: ${state.agentBOutput}`;
  return { finalOutput: combined };
});

// Add edges
workflow.addEdge("__start__", "agentA");
workflow.addEdge("agentA", "synthesizer");
workflow.addEdge("synthesizer", END);

// Compile and run
const app = workflow.compile();
const result = await app.invoke({ input: "your question here" });
```

Key concepts that map to your existing knowledge:
- `StateGraph` = your typed `SwarmState` + orchestrator
- `addNode` = your individual agent functions
- `addEdge` = explicit agent execution order
- `addConditionalEdges` = the conditional handoff logic you built manually in Asteroid Bonanza

The learning curve is minimal because you've already implemented these patterns manually. LangGraph is just the formalized version.

---

## Recommendation

**Option 1 (if you want maximum new skills + job market impact): VoiceNotes Intelligence**

This is the highest-value choice for the portfolio because it introduces two skills in one project (voice AI + LangGraph), is universally relatable (anyone who has voice memos benefits), and the demo is compelling in 30 seconds. The subject matter is productivity — useful to literally everyone, including recruiters. Cost control is easy (on-demand processing only). And it's a domain none of your prior projects have touched.

**The first 30-second recruiter experience:** "Record anything you want for 30 seconds. Hit submit. Watch your action items appear."

**Option 2 (if you want a stronger emotional hook + familiar architecture): NightMap (The Migration)**

If the "watching the invisible world" emotional hook from Wildlife Sentinel resonated deeply and you want another project like that — something that shows people something real and beautiful they didn't know was happening — NightMap is the right choice. The architecture is familiar enough that the build will go quickly. The web-first design addresses the Discord-demo problem.

**The first 30-second recruiter experience:** "Open this during migration season. This is how many birds are flying over North America right now."

**Option 3 (if you want the most direct job-search impact): CodeScope (Code Review)**

If the primary goal is demonstrating AI engineering skills to technical interviewers as quickly as possible, CodeScope is the most efficient choice. It's the most immediately relatable to a developer evaluating your portfolio. It explicitly covers LangGraph + evaluation. The cost is trivial. The demo is instant.

**The first 30-second recruiter experience:** "Paste any function you're proud of, or any function you know has a problem. Hit review."

---

## Open Questions to Decide Before Starting

1. **Domain preference:** Do you want to build something that shows people the natural world (NightMap), something that improves personal productivity (VoiceNotes), or something that demonstrates pure AI engineering depth (CodeScope or DocVision)?

2. **Voice AI comfort level:** The voice pipeline is not technically hard (it's ~30 lines of code you already know how to write in a new shape), but do you want to deal with audio file handling, browser permissions, and transcription latency? It's solvable — is it interesting?

3. **Emotional hook priority:** How important is it that you genuinely love the subject matter? If it's very important, NightMap or VoiceNotes. If portfolio efficiency matters more, CodeScope.

4. **New framework vs. familiar architecture:** Do you want to use LangGraph explicitly (VoiceNotes, CodeScope, NightMap variant) or keep building direct TypeScript orchestration at a higher level (any option)?

5. **Timeline:** How long do you want to spend on this project before starting the job search? A simpler project (CodeScope) could be portfolio-ready in 4–6 weeks. A more ambitious one (VoiceNotes or DocVision) might take 8–10 weeks to production quality.

---

## What to NOT Do

- Don't rebuild Wildlife Sentinel with different data sources. The architecture is nearly identical. Job interviewers will see through it.
- Don't build anything that requires a login or approval to demo. "You have to create an account first" kills the recruiter experience.
- Don't choose a domain because it sounds impressive on paper if you don't care about it. Asteroid Bonanza got finished because near-Earth asteroid economics is genuinely interesting. Wildlife Sentinel got finished because endangered species matter to you. The next project needs a similar hook or it stalls.
- Don't spend weeks learning LangGraph before starting. The patterns map directly to what you already built. Start building.

---

## Notes on Portfolio Visibility (from DEVELOPER_PROFILE_MAY_2026.md)

Before starting a new project, two things are worth doing:

1. **Ensure your GitHub READMEs are recruiter-ready.** You noted you have READMEs for Asteroid Bonanza (https://github.com/sjtroxel/AI-Masterclass-Week-6), Poster Pilot (https://github.com/sjtroxel/AI-Masterclass-Week-5), and ChronoQuizzr (https://github.com/sjtroxel/AI-Masterclass-Week-4). The Wildlife Sentinel README was written April 30, 2026 (443 lines). Review all of them for: live demo link at the top, clear one-paragraph "what this is and why it matters," architecture diagram or explanation, tech stack table, and test count.

2. **Poster Pilot caveat:** You mentioned Poster Pilot doesn't feel as strong because 1,000 posters is too small a dataset to demonstrate real semantic search. Note: this is a data density problem, not an architecture problem. You could write a note in the README acknowledging this and explaining what the system would do at scale. That actually demonstrates engineering maturity — knowing why something works the way it does, not just that it works. Or, if you'd rather not call attention to it, simply list Poster Pilot as "demonstrating CLIP multimodal search, RAG, and SSE streaming" rather than showcasing it as your best search demo.

---

*Written: April 30, 2026*
*Decision expected: Start of May 2026, before any implementation begins.*
