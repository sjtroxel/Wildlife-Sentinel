# Database Schema — Wildlife Sentinel

**Database:** Neon (PostgreSQL). Extensions: `postgis`, `vector`.
**Client:** `postgres.js` — no Supabase client.
**Full schema details to be expanded in Phase 0 implementation.**

---

## Tables

| Table | Migration | Purpose |
|---|---|---|
| `species_ranges` | 0001 | IUCN habitat polygons (PostGIS MULTIPOLYGON) |
| `pipeline_events` | 0002 | Audit log: every event's stage progression |
| `alerts` | 0002 | Assessed alerts with predictions |
| `agent_prompts` | 0003 | Agent system prompts (updateable by Refiner) |
| `model_usage` | 0003 | LLM call log with token counts + estimated cost |
| `refiner_queue` | 0005 | Scheduled refiner evaluations (24h + 48h) |
| `refiner_scores` | 0005 | Prediction accuracy scores over time |
| `species_facts` | 0004 | RAG: species ecology + threats (pgvector 768d) |
| `conservation_context` | 0004 | RAG: broader conservation framing (pgvector 768d) |

---

## Key Schema Details

### species_ranges
```sql
id UUID PK | species_name TEXT | iucn_species_id TEXT | iucn_status TEXT
geom GEOMETRY(MULTIPOLYGON, 4326)  -- spatial index: GIST
created_at TIMESTAMPTZ
```

### alerts
```sql
id UUID PK | raw_event_id TEXT | source TEXT | event_type TEXT
coordinates JSONB | severity NUMERIC | enrichment_data JSONB
threat_level TEXT | confidence_score NUMERIC
prediction_data JSONB  -- used by Refiner for comparison
discord_message_id TEXT | created_at TIMESTAMPTZ
```

### agent_prompts
```sql
id UUID PK | agent_name TEXT UNIQUE | system_prompt TEXT
version INTEGER | last_updated_by TEXT | updated_at TIMESTAMPTZ
```

### species_facts / conservation_context
```sql
id UUID PK | content TEXT | embedding vector(768)
source_document TEXT | metadata JSONB | created_at TIMESTAMPTZ
-- ivfflat index on embedding for fast ANN search
```

---

## Migrations

Files in `server/src/db/migrations/`. Format: `NNNN_description.sql`.
Each file has `-- Up` and `-- Down` sections.
Runner: `scripts/migrate.ts` — reads DATABASE_URL, applies unapplied migrations in order.

*Full column definitions to be written in Phase 0 implementation.*
