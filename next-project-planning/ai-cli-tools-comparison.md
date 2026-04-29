# AI CLI Coding Tools — Comparison & Research
*Researched: April 28, 2026 — live web sources*

---

## Context

This document compares the major AI CLI coding tools available as of late April 2026, with notes on pricing, VS Code integration, and what's coming in May 2026. The goal is to inform the next project stack decision, specifically whether to add a second AI CLI alongside Claude Code.

---

## Claude Code (Anthropic)

**Current CLI version:** v2.1.122 (released April 28, 2026 — today)

**Cost:** $20/month Pro subscription (included in existing plan)

**Model options:**
- Default: Claude Sonnet 4.6 (`claude-sonnet-4-6`)
- Upgrade: Claude Opus 4.7 (`claude-opus-4-7`) — most capable, slower, uses more Pro quota

**Update command:**
```bash
claude update
```
Claude Code auto-updates by default. Can be disabled with `DISABLE_UPDATES=1`.

**VS Code integration:** Native VS Code extension + integrated terminal. First-class support.

**April 2026 notable features shipped:**
- **Ultraplan** (early preview, v2.1.98+): Draft a plan in the cloud from the CLI, review and comment in a web editor, run remotely or pull back local
- **Computer Use** (research preview): Claude can open native apps, click through UI, and verify changes from the terminal
- **Monitor tool**: Streams background process events into the conversation
- **`/loop` command**: Self-paces iterations when no interval is given
- **`/team-onboarding`**: Packages your setup into a replayable guide
- **`/autofix-pr`**: Turns on PR auto-fix from your terminal
- **PR URL Resume**: Paste a PR URL into `/resume` to find the session that created it (GitHub, GitLab, Bitbucket)
- **NO_FLICKER rendering engine** (v2.1.90)

**Knowledge cutoff note:** The CLI version and the model's knowledge cutoff are separate. The CLI being on v2.1.122 does not update the model's training data. Use Claude Code's built-in web search for current information — this is the correct solution, not a newer CLI version.

**Sources:**
- https://github.com/anthropics/claude-code/releases
- https://help.apiyi.com/en/claude-code-changelog-2026-april-updates-en.html

---

## Gemini CLI (Google)

**Status:** Fully available. Open source (Apache 2.0).

**Cost structure (as of April 1, 2026 — billing overhauled):**

| Tier | Models Available | Cost |
|---|---|---|
| Free | Gemini 2.5 Flash, 2.5 Flash-Lite, 3 Flash Preview, 3.1 Flash-Lite Preview, Gemma 4, Embedding models | Free (data used to improve Google products) |
| Paid | All of the above + Gemini 2.5 Pro, 3.1 Pro Preview, image/video/music generation | Pay-per-token (see below) |

**Paid tier pricing examples:**
- Gemini 2.5 Flash: $0.30/1M input, $2.50/1M output
- Gemini 3.1 Flash-Lite: $0.25/1M input, $1.50/1M output

**Monthly spend caps (enforced April 1, 2026):**
- Tier 1: $250/month cap — API pauses when reached
- Tier 2: $2,000/month
- Tier 3: $20K–$100K+

**Key change (March 25, 2026):** Pro models (Gemini 2.5 Pro, 3.1 Pro) are now **paid-only**. Free tier is capped to Flash family models.

**Privacy note:** Free tier — your data is used to improve Google's products. Paid tier — it is not.

**VS Code integration:** Terminal-based. No official VS Code extension as of April 2026. Works in the integrated terminal like Claude Code.

**Verdict for next project:** Genuinely free and capable for Flash-tier work. Good second CLI for learning without additional cost. If you need Pro models, it's pay-per-token (no flat subscription option).

**Sources:**
- https://ai.google.dev/gemini-api/docs/pricing
- https://agentdeals.dev/gemini-api-pricing-2026
- https://github.com/google-gemini/gemini-cli/discussions/22970

---

## OpenAI Codex CLI

**Status:** Fully available. Open source (built in Rust).

**Cost structure:**

| Plan | Codex Access | Cost |
|---|---|---|
| ChatGPT Plus | Included | $20/month |
| ChatGPT Pro | Included (5-hour limits at 25x Plus through May 31, 2026) | $200/month |
| API direct | Pay-per-token | See below |

**API pricing (as of April 2, 2026 — token-based):**
- `codex-mini-latest`: $1.50/1M input, $6/1M output
- **75% prompt caching discount** available

**Models:**
- `codex-mini-latest` (default for CLI, based on o4-mini)
- GPT-5.3-Codex-Spark (research preview) — fast, day-to-day coding
- o3 and o4-mini accessible via CLI

**Key features:**
- Runs entirely locally from terminal
- MCP (Model Context Protocol) support — extend with additional tools
- Parallel subagents for complex tasks
- Switch between models mid-session

**Promotion (through May 31, 2026):** Doubled usage on the $100/month tier; Pro $200/month plan at 5-hour Codex limits 25x through end of May.

**VS Code integration:** Terminal-based CLI. No official VS Code extension — runs in integrated terminal.

**Verdict for next project:** If you already have a ChatGPT Plus subscription, Codex CLI is free to add. Otherwise, the API is competitive at $1.50/1M input with caching.

**Sources:**
- https://developers.openai.com/codex/pricing
- https://developers.openai.com/codex/cli
- https://flowith.io/blog/openai-codex-pricing-2026-api-costs-token-limits/

---

## Grok / xAI

**Status:** No standalone CLI available yet. Watch closely for May 2026.

### What exists today (April 2026)

**Grok Code Fast 1** — xAI's coding-focused model, not a CLI tool:
- Available in VS Code via partner integrations: GitHub Copilot, Cursor, Cline, Roo Code, Kilo Code, opencode, Windsurf
- Free for a limited time via these partners
- Not a CLI you install and run independently

### What's coming (Grok Build)

A local-first CLI coding agent with:
- CLI-first interface with optional web UI
- All code executes locally — nothing transmitted to xAI servers
- GitHub integration
- Up to **8 parallel agents** per session
- Multi-agent "Arena Mode"

**Current status:** Waitlisted as of April 2026. On April 16, Elon Musk indicated "next week" — had not shipped as of April 28. Watch for May 2026 release.

**VS Code:** Available today *via partner tools* only (not xAI's own extension). When Grok Build ships, direct VS Code integration is expected.

**Verdict for next project:** Not a reliable choice today. If Grok Build ships in May as anticipated, re-evaluate — the 8-parallel-agents pitch is interesting for complex projects.

**Sources:**
- https://x.ai/news/grok-code-fast-1
- https://ai2.work/blog/xai-grok-build-multi-agent-arena-mode-redefines-ai-coding
- https://www.adwaitx.com/grok-build-vibe-coding-cli-agent/

---

## Mistral Vibe (Mistral AI)

**Status:** Fully available. Mistral Vibe 2.0 shipped.

**Model:** Devstral 2 (Mistral's coding-focused model family)

**Cost:**
- Le Chat Pro plan (includes Vibe access)
- Le Chat Team plan
- Bring-your-own API key (pay-as-you-go credits)

**Key features (Vibe 2.0):**
- Terminal-native CLI agent
- Conversational interface to your codebase — natural language to explore, modify, interact
- File manipulation, code search, version control, command execution tools built in
- **Custom subagents**: Build specialized agents for deploy scripts, PR reviews, test generation — invoke on demand
- **Slash-command skills**: Load skills with `/` — preconfigured workflows for linting, deploying, docs generation (similar to Claude Code's `/` commands)
- Project-aware context: automatically scans file structure and Git status
- **Auto-updates**: Always on latest version automatically
- VS Code integration via Agent Communication Protocol (ACP)

**Verdict for next project:** The most direct Mistral answer to Claude Code. More feature-complete than Gemini CLI for a Claude Code-style workflow. Worth evaluating if you want a second primary agent rather than just a second model to query.

**Sources:**
- https://mistral.ai/news/mistral-vibe-2-0
- https://docs.mistral.ai/mistral-vibe/introduction
- https://www.datacamp.com/blog/mistral-vibe-2-0

---

## Running Multiple AI CLIs in the Same Project

### The short answer
They don't interfere with each other at a technical level. They're separate processes that read and write files independently — no communication, no awareness of each other.

### What works well
- One CLI as **primary** (Claude Code) for your main editing loop
- Second CLI in a separate terminal for **second opinions**, planning discussions, or tasks suited to a different model's strengths
- Using each for **different parts of the codebase** simultaneously (different files, different features)
- Asking one to **review** what the other just wrote

### Where it gets messy
- Both actively editing the **same file simultaneously** — last write wins, no coordination, you get conflicts
- Re-briefing the second AI on what the first one just did — each has no awareness of the other's actions
- Cognitive overhead of managing two active contexts

### Best practices
1. **Commit before switching** — git is your rollback if either AI makes unwanted changes
2. **Never run both on the same file at the same time** — treat them like two developers who need to take turns
3. **Be explicit about shared context**: "The other AI just refactored X, here's what it looks like now"
4. Use git branches if doing significant parallel experimentation with two agents

---

## Cursor

*Researched April 29, 2026 — live web sources*

**Type:** IDE — standalone application (fork of VS Code). Not a CLI tool.

You open Cursor instead of VS Code. There is no `cursor` command in your terminal that functions like `claude` or `aider`. This distinction matters: Cursor is editor-centric, Claude Code is terminal-centric. Your existing VS Code extensions transfer over since it's a fork.

**Pricing (April 2026):**

| Tier | Cost | Notes |
|---|---|---|
| Hobby | Free | Limited agent requests and tab completions |
| Pro | $20/month | Extended limits, frontier models, cloud agents |
| Pro+ | $60/month | 3x usage credits on Claude, GPT-4o, Gemini models — recommended for heavy users |
| Ultra | $200/month | 20x usage, priority access to new features |
| Teams | $40/user/month | Shared rules, commands, org controls |
| Enterprise | Custom | SSO, advanced security |

**Important billing change (June 2025):** Cursor replaced fixed "fast request" allotments with a credit-based billing model tied to actual API costs. The rollout was rocky — Cursor publicly apologized on July 4, 2025, and issued refunds for unexpected charges. On the Pro plan, your $20 credit gets roughly 225 Claude Sonnet requests, 500 GPT-4o requests, or 550 Gemini requests. Auto mode is unlimited and doesn't consume credits; manually selecting a premium model draws from the pool.

**Models:** Model-agnostic. Claude Sonnet 4.6, GPT-4o, Gemini — you choose per session.

**Key features:**
- **Cursor Agent (formerly Composer):** Multi-file editing, terminal command execution, error iteration — the full agentic loop inside the IDE.
- **Cloud agents (Pro+):** Run AI tasks in the cloud without tying up your local machine.
- **@ context injection:** `@file`, `@folder`, `@codebase`, `@docs`, `@web`, `@git` for precise context feeding.
- **Codebase indexing:** Cursor pre-indexes your repo for semantic retrieval — different from Claude Code which reads files on demand.
- **`.cursorrules`:** Project-level rules file, equivalent to `CLAUDE.md`.

**Verdict for next project:** At $20/month (Pro), it's the same cost as your Claude Code subscription. The main question is whether you prefer IDE-centric or terminal-centric development. Cursor's pre-indexed codebase context is its strongest differentiator. If you primarily code in an editor window, Cursor is worth a trial. If you're terminal-native (which your Wildlife Sentinel workflow suggests), it may feel like extra overhead.

---

## GitHub Copilot

*Researched April 29, 2026 — live web sources*

**Type:** Primarily a VS Code extension (also JetBrains, Neovim). Has a very limited CLI subcommand (`gh copilot`) for shell help only.

**Critical distinction:** The `gh copilot` CLI does **not** read your codebase, does not write files, and does not run agentic loops. It suggests or explains shell commands. It is not comparable to Claude Code. The agent-comparable feature is Copilot's **VS Code Agent Mode**.

**Pricing (April 2026):**

| Tier | Cost | Key features |
|---|---|---|
| Free | $0 | Limited completions, 50 chat messages/mo |
| Pro | $10/month | Unlimited completions, cloud agent access, premium model allowance |
| Pro+ | $39/month | Higher premium model allowance, priority features |
| Business | $19/user/month | Org policy controls, audit logs, IP indemnity, no training data retention |
| Enterprise | $39/user/month | Knowledge bases, PR summaries, Copilot Workspace |

**⚠️ Active disruption (April 2026):** As of April 20, 2026, GitHub has **temporarily paused new sign-ups** for Copilot Pro, Pro+, and student plans. Existing subscribers are unaffected. This is likely related to the upcoming billing overhaul.

**Upcoming billing change (June 1, 2026):** All Copilot plans will switch to usage-based billing using "GitHub AI Credits." Pro includes $10/month in credits; Pro+ includes $39/month in credits. Developer sentiment has been mixed — some coverage is headlined "You Will Get Less, but Pay the Same Price."

**Models:** GitHub controls the model lineup. Currently includes Claude Sonnet 4.6 and GPT-4o selectable in chat. Not fully model-agnostic.

**Key features:**
- **Inline autocomplete (ghost text):** Copilot's historic strength — trained on billions of lines of real GitHub code. Extremely accurate as you type.
- **VS Code Agent Mode:** Multi-file edits, terminal execution, error iteration. Maturing feature.
- **Copilot Workspace:** Browser-based, issue-driven agent. Open a GitHub issue → Copilot plans + writes the code → you review the PR. Useful for structured issue-driven development.
- **Copilot cloud agent:** Accessible from the Pro plan — runs async tasks without keeping your terminal open.

**`gh copilot` CLI — what it actually does:**
```bash
gh copilot explain "git rebase -i HEAD~3"    # explains a shell command
gh copilot suggest "compress all PNGs here"  # suggests a shell command
```
Useful for shell workflow. Not a substitute for any coding agent.

**Verdict for next project:** Best if: (1) inline autocomplete quality matters most to you, (2) you work heavily with GitHub issues and want Copilot Workspace's issue→PR workflow, or (3) you want the cheapest entry at $10/month. VS Code Agent Mode is still maturing relative to Claude Code's depth. The June billing switch and current sign-up pause makes this a "wait and see" moment — hold off on subscribing until those changes settle.

---

## Perplexity AI

*Researched April 29, 2026 — live web sources*

**Does Perplexity have a coding agent or CLI? Not officially — but they've expanded significantly in 2026.**

Perplexity is primarily a search/research AI, but the picture is more nuanced than "no coding tools":

**Perplexity Computer (launched February 25, 2026):**
An agentic product that creates and executes entire workflows that "reason, delegate, search, build, remember, code, and deliver." It can run for hours or months autonomously. This is an emerging product — not yet a developer tool in the same category as Claude Code or Aider, but more capable than search alone.

**Perplexity Agent API:**
Available at `POST https://api.perplexity.ai/v1/agent`. Programmatic access to Perplexity's capabilities for building into workflows.

**Perplexity as MCP server:**
Perplexity's search capability is available as an MCP server, making it usable as a research tool within Claude Code, Cursor, Copilot, and other MCP-supporting agents — including Wildlife Sentinel's own pipeline architecture.

**Community CLIs:** Third-party CLIs exist (e.g., github.com/noQuli/perplexity-cli) that wrap the Perplexity API in a terminal interface. These are not official Perplexity products.

**Pricing:**
- Free: basic search, limited Pro searches/day
- Pro: $20/month or $200/year — unlimited Pro searches, file upload analysis, access to better models

**Verdict for next project:** Still primarily a research companion, not a coding agent. Its value in a developer workflow is answered-and-cited information about APIs, libraries, and error messages — with real web sources, which is the gap your model's training cutoff creates. The Perplexity Computer launch is worth watching as it matures into something more structured for developers. If you want web-grounded answers during development, Perplexity Pro at $20/month fills a different niche than any of the coding agents in this document.

---

## Aider

*Researched April 29, 2026 — live web sources*

**Type:** CLI tool (pure terminal). The most mature open-source alternative to Claude Code.

**Cost:** Free and open source. You pay only for LLM API calls — no Aider subscription. Running Claude Sonnet 4.6 through Aider costs roughly $3–8/hour of heavy usage at current API rates.

**Scale:** 39,000+ GitHub stars, 4.1 million+ installs, 15 billion tokens processed per week. Largest deployed user base of any open-source coding CLI.

**Models:** Supports any model with an OpenAI-compatible API endpoint. First-class: Claude (all versions), GPT-4o, DeepSeek Coder, Gemini, Llama (via Ollama), Mistral. Aider publishes a live LLM coding leaderboard at aider.chat — useful for comparing model cost vs. quality.

**Cost strategies:**
- Claude Haiku 4.5 via Anthropic API: cheapest Claude option, good for bulk edits
- DeepSeek Coder via OpenRouter: ~$0.14/1M input — near-zero cost for large refactors
- Local models via Ollama: $0 (fully private, quality lower)
- **Architect mode:** Use Claude Sonnet for planning, DeepSeek for execution — cuts cost on large tasks

**Key features:**
- **Git-native:** Every change is auto-committed with a descriptive message. Full `git reset` undo trail. You never lose work.
- **Explicit file context:** Use `/add` and `/drop` to tell Aider exactly which files are in context. More control than Claude Code's implicit repo search, but more friction.
- **Edit formats:** Adapts prompt format by model — "diff" for capable models (sends only changes), "whole" for weaker ones.
- **Architect mode:** Two-model pipeline — planner model proposes, executor model implements. Reduces cost significantly on large refactors.
- **Lint/test loop:** Runs your test suite after edits and feeds failures back to the model automatically.

**Compared to Claude Code:**

| | Aider | Claude Code |
|---|---|---|
| Model lock-in | None — any API | Anthropic only |
| Context management | Explicit (`/add` files) | Implicit (searches repo) |
| Git integration | Auto-commit every change | Commit when you ask |
| Shell depth | Limited | Deep (runs commands, monitors processes) |
| IDE integration | None | VS Code extension, full integration |
| Cost floor | ~$0 with local models | Anthropic API minimum |
| Maturity | 2023, very mature | 2025, official + fast-evolving |

**Verdict for next project:** Install Aider alongside Claude Code. Use Claude Code for complex reasoning and design decisions; use Aider + a cheap model for mechanical bulk edits (rename this pattern in 40 files, update all test fixtures, etc.). The cost savings on repetitive tasks are significant. The explicit file context model takes some adjustment but gives you precision that implicit search doesn't.

---

## Cline (VS Code Extension)

*Researched April 29, 2026 — live web sources*

**Type:** VS Code extension (also JetBrains in Enterprise tier). Not a CLI. Free and open source.

**Scale:** 5 million+ developers. One of the most-installed AI coding extensions on the VS Code marketplace.

**GitHub:** github.com/cline/cline (formerly "Claude Dev" — renamed when it expanded beyond Claude)

**Pricing:**
- **Individual:** Free — pay only for LLM API calls (no Cline subscription). Typical cost: $5–50/month depending on usage volume.
- **Teams:** $20/user/month (as of Q1 2026) — adds team management, 10 free seats, centralized billing, dashboard.
- **Enterprise:** Custom — JetBrains extension, SSO/OIDC/SCIM, audit logs, VPC deployment, SLA, OpenTelemetry, priority support.

**Models:** Fully model-agnostic. Any OpenRouter-compatible model, plus direct APIs for Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure, GCP Vertex, Cerebras, Groq. You use the same Anthropic API key you already have.

**Key features:**
- **Full agentic loop inside VS Code:** Creates/edits files, executes terminal commands, reads output, iterates on errors — all within VS Code panels.
- **Browser control:** Cline can open a browser, take screenshots, and interact with web UIs via Puppeteer. Useful for E2E testing or researching live documentation.
- **MCP support:** Connects to Model Context Protocol servers (filesystem, databases, search, etc.).
- **Plan and Act modes:** Cline proposes what it will do before executing — you approve the plan before it touches code.
- **Per-action approval:** Configurable — shows each proposed file write or command before running. Can auto-approve for speed.
- **`@` context mentions:** Reference files, URLs, terminal output, or web pages directly in chat.

**Verdict for next project:** The best free complement to your existing Claude Code setup if you work primarily inside VS Code. Uses your existing Anthropic API key — no new subscription. Adds browser control that Claude Code lacks. The Plan and Act separation is useful for larger tasks where you want to review the approach before any files change. Not a replacement for Claude Code's terminal-native capabilities, but a strong VS Code companion.

---

## Windsurf (by Codeium → now Cognition AI)

*Researched April 29, 2026 — live web sources*

**Type:** IDE — standalone application (fork of VS Code). Not a CLI.

**⚠️ Ownership situation (complex — verify before relying on this):**
- Early May 2025: OpenAI announced a $3B acquisition of Windsurf/Codeium.
- July 11, 2025: The deal collapsed. OpenAI's relationship with Microsoft (which would have gained IP access) killed it.
- Also July 2025: Google signed a $2.4B non-exclusive licensing deal for Windsurf's technology. Windsurf CEO and key team members went to Google.
- December 2025: Cognition AI (the company behind Devin) acquired Windsurf's remaining assets for ~$250M. Jeff Wang was promoted to CEO.
- **Current status:** Windsurf operates under Cognition AI ownership, with plans to integrate Devin's autonomous agent capabilities into the IDE.

**Pricing (March 2026, post-acquisition):** Free tier was locked out for many users — $15/month Pro is now required for meaningful use. Teams/Enterprise above that.

**Key features:**
- **Cascade (agent):** Multi-file edits, terminal execution, continuous agent execution without approval prompts at each step.
- **SWE-1:** Codeium's own coding-focused model (pre-acquisition). Post-acquisition direction is uncertain.
- **Devin integration (in progress):** Plans to embed Cognition's fully-autonomous Devin capabilities into the Windsurf IDE.

**Verdict for next project:** The ownership churn (three parties in one year) creates significant product uncertainty. The Cognition/Devin integration is interesting but unproven in the IDE context. At $15/month it undercuts Cursor, but with more risk. If Devin integration ships well, re-evaluate in late 2026. For now, Cursor is the safer IDE choice if you want an alternative to VS Code.

---

## Other CLI Agents Worth Knowing

*Researched April 29, 2026 — live web sources*

### OpenCode

**Type:** CLI tool with TUI (Terminal User Interface). Open source, written in Go.

**GitHub:** github.com/opencode-ai/opencode

A terminal-native coding agent built for flexibility — supports 75+ LLM providers including local models via Ollama. The TUI gives it a more polished terminal experience than Aider's plain interface. Specific agent types: Build (full development), Plan (analysis only, no changes), Review (read-only code review), Debug (investigation), Docs (documentation writing).

**OpenCode Zen:** A curated model service — pay-as-you-go, $20 balance, tests and benchmarks models specifically for coding agent tasks. Alternative to managing your own API keys.

Positioned as the most model-flexible CLI agent — if you want to swap between Claude, GPT, Gemini, and local models freely without reconfiguring, OpenCode handles that cleanly.

### Goose (by Block → Agentic AI Foundation / Linux Foundation)

**Type:** CLI + desktop app + API. Open source (Apache 2.0), built in Rust.

**GitHub:** github.com/aaif-goose/goose

**Scale:** 29,400+ GitHub stars, 368+ contributors, 2,600+ forks. Launched to the open source community in early April 2026.

Fully autonomous — installs packages, edits files, executes shell commands, runs tests, reads results. Block developed it for internal engineering automation; now maintained by the Agentic AI Foundation under the Linux Foundation.

Strong fit for DevOps tasks, script generation, and system administration in addition to coding. Local-first with bring-your-own-key model support.

### What's NOT in This Category

**Devin (Cognition AI):** Web app, not a CLI. Fully autonomous cloud agent. ~$500/month — not viable for solo dev cost-wise. Now also owns Windsurf (see above).

**Warp Terminal:** A modern terminal emulator with AI shell suggestions. Not a coding agent — does not write or edit code files. Worth using as your terminal, but separate category.

**Continue:** VS Code + JetBrains extension. Open source, bring-your-own-key. More focused on chat + inline editing than agentic loops. Less autonomous than Cline.

---

## Quick Decision Matrix

*Updated April 29, 2026*

| Tool | Type | Ready? | Cost | Best use case |
|---|---|---|---|---|
| Claude Code | CLI | Yes | $20/mo (you have it) | Primary — best terminal-native agent, deep VS Code integration |
| **Aider** | **CLI** | **Yes** | **Free (pay API only)** | **Best CLI complement — cheapest at scale, model-agnostic** |
| **OpenCode** | **CLI** | **Yes** | **Free (pay API or Zen $20)** | **Best CLI if you want maximum model flexibility (75+ providers)** |
| **Goose** | **CLI + app** | **Yes** | **Free (pay API)** | **Best CLI for DevOps/automation tasks; Rust-fast, Linux Foundation** |
| Gemini CLI | CLI | Yes | Free (Flash models) | Zero cost second CLI for learning |
| Codex CLI | CLI | Yes | Free if Plus subscriber | Alternative perspective; fast execution |
| Mistral Vibe | CLI | Yes | Le Chat Pro plan | Full Claude Code alternative if you want non-Anthropic |
| Grok Build | CLI | No (still waiting) | TBD | Re-evaluate when it ships; 8-parallel-agents is interesting |
| Cursor | IDE | Yes | $20–$60/mo | Best IDE alternative if you prefer editor over terminal |
| Windsurf | IDE | Yes (ownership uncertain) | $15/mo | Cheaper IDE option; Devin integration coming but uncertain |
| GitHub Copilot | VS Code ext | Yes (sign-ups paused) | $10/mo Pro | Best if inline autocomplete + GitHub-native workflow matters |
| **Cline** | **VS Code ext** | **Yes** | **Free (pay API)** | **Best VS Code complement — uses your existing Anthropic key** |
| Perplexity | Web/research | Yes | $20/mo | Research companion — not a coding agent, different niche |

### For sjtroxel specifically

**Primary:** Keep Claude Code — nothing matches it for the terminal-native + VS Code + complex reasoning combination you use on Wildlife Sentinel.

**Best addition for cost control:** Aider with a cheap model (Claude Haiku or DeepSeek via OpenRouter). Use Claude Code for design and reasoning; Aider for bulk mechanical edits.

**Best VS Code companion:** Cline — free, uses your existing Anthropic API key, adds browser control.

**Worth watching:** Grok Build (when it ships), Windsurf/Devin integration, GitHub Copilot after the June billing switch settles.

---

*Research: Sections 1–5 (Claude Code through Mistral Vibe) performed April 28, 2026. Sections 6+ (Cursor through Goose) performed April 29, 2026. All via live web sources. Pricing and availability subject to change.*

Sources (April 29 research):
- [Cursor Pricing — cursor.com](https://cursor.com/pricing)
- [Cursor Models & Pricing Docs](https://cursor.com/docs/models-and-pricing)
- [GitHub Copilot Plans](https://github.com/features/copilot/plans)
- [GitHub Copilot Usage-Based Billing Announcement](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/)
- [Devs React to Copilot Pricing Change — Visual Studio Magazine](https://visualstudiomagazine.com/articles/2026/04/27/devs-sound-off-on-usage-based-copilot-pricing-change-you-will-get-less-but-pay-the-same-price.aspx)
- [Perplexity Computer Launch](https://www.perplexity.ai/hub/blog/introducing-perplexity-computer)
- [Aider — aider.chat](https://aider.chat/)
- [OpenAI Windsurf Deal Collapse — Fortune](https://fortune.com/2025/07/11/the-exclusivity-on-openais-3-billion-acquisition-for-coding-startup-windsfurf-has-expired/)
- [Windsurf + Cognition / Google — DeepLearning.AI](https://www.deeplearning.ai/the-batch/google-cognition-carve-up-windsurf-after-openais-failed-3b-acquisition-bid/)
- [Cline — cline.bot](https://cline.bot/)
- [OpenCode — opencode.ai](https://opencode.ai/)
- [Goose by Block/AAIF — goose-docs.ai](https://goose-docs.ai/)
- [Top 5 CLI Coding Agents 2026 — Pinggy](https://pinggy.io/blog/top_cli_based_ai_coding_agents/)
