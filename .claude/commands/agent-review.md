Review a Wildlife Sentinel agent implementation against the project's architectural spec.

Usage: /agent-review [agent name or file path]

If no agent is specified, review all agents in `server/src/agents/` and `server/src/scouts/`.

For each agent, check:

**12-Factor Agent Compliance:**
- [ ] `buildSystemPrompt()` is an explicit function (not inline string concatenation)
- [ ] Model string imported from `shared/models.ts` — not hardcoded
- [ ] Agent does not import AI SDKs directly — calls ModelRouter only
- [ ] Agent function signature matches the standard pattern (event, state, options) → AgentOutput
- [ ] Output interface includes `status`, `confidence`, `sources`

**Confidence Scoring:**
- [ ] Confidence is computed from observable fields (dataCompleteness, sourceQuality, etc.)
- [ ] No self-reported confidence ("how confident are you?" patterns)
- [ ] Confidence formula is documented in comments

**Redis Stream Compliance:**
- [ ] Agent publishes to the correct stream (per redis.md stream definitions)
- [ ] Agent uses XREADGROUP / consumer group pattern for consuming
- [ ] Agent calls XACK after successful processing
- [ ] Agent does NOT call another agent directly — only publishes to Redis

**Error Handling:**
- [ ] Agent handles API failures gracefully (does not crash the process)
- [ ] Errors are logged to #sentinel-ops channel, not silently swallowed
- [ ] Agent status field reflects partial/failed states accurately

**For Scout Agents specifically:**
- [ ] Does NOT import Anthropic or Google AI SDKs
- [ ] Implements deduplication via Redis TTL set
- [ ] Normalizes to `RawDisasterEvent` schema before publishing
- [ ] Runs as a cron job (not a persistent loop)

**For the Refiner/Evaluator specifically:**
- [ ] Scoring formula uses deterministic math (not LLM judgment)
- [ ] System prompt updates are written to `agent_prompts` table
- [ ] Score is logged to `refiner_scores` table for trend visualization
- [ ] Runs 24h AND 48h after each fire/storm alert

Report findings as: PASS / FAIL / WARNING with specific line numbers for any issues.
