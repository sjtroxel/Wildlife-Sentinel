Verify the Redis Streams pipeline configuration and schema compliance for Wildlife Sentinel.

1. **Stream Schema Audit** — check `server/src/pipeline/` and all agent files for:
   - Do published message shapes match the interfaces in `.claude/rules/redis.md`?
   - Are all required fields present in XADD payloads?
   - Do consumers expect the correct field names?

2. **Consumer Group Registration** — verify each consumer creates its group with the try/catch pattern:
   ```typescript
   try {
     await redis.xgroup('CREATE', streamName, groupName, '0', 'MKSTREAM');
   } catch (e) { /* already exists */ }
   ```

3. **Drop Logic** — confirm the Enrichment Agent correctly drops events with no habitat overlap (does NOT publish to `disaster:enriched`).

4. **Threat Level Routing** — confirm the Synthesis Agent routes correctly:
   - 'low' → no publish, DB log only
   - 'critical' → #sentinel-ops (HITL)
   - 'medium'/'high' → #wildlife-alerts (auto)

5. **XACK Pattern** — verify every consumer calls XACK after successful processing, in a try/finally or equivalent that guarantees acknowledgment.

6. **Deduplication** — verify Scout agents check and set Redis dedup keys before publishing.

7. **Type Safety** — check that stream message fields are serialized as JSON strings (XADD only accepts string key-value pairs) and deserialized correctly by consumers.

Report any schema mismatches, missing XACK calls, or incorrect routing logic with file:line references.
