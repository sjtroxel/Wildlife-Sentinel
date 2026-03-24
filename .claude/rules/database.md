# Database Rules

## Database: Neon (PostgreSQL)

We use **Neon**, not Supabase. Key differences:
- No Supabase client SDK — use `postgres.js` directly
- Connection string from `process.env.DATABASE_URL`
- Same PostgreSQL under the hood — all SQL, PostGIS, pgvector work identically
- Migrations are plain `.sql` files run via a migration script, not Supabase CLI

## Client Setup

```typescript
// server/src/db/client.ts
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: 'require',              // Neon requires SSL
  max: 10,                     // connection pool size
  idle_timeout: 30,
  connect_timeout: 10,
});

export default sql;
```

Always import `sql` from `db/client.ts`. Never create a new postgres() instance per file.

## PostGIS Rules

PostGIS extension must be enabled in your Neon project: `CREATE EXTENSION IF NOT EXISTS postgis;`

### Habitat proximity query (the core query of this system)
```sql
SELECT
  s.id,
  s.species_name,
  s.iucn_status,
  s.iucn_species_id,
  ST_Distance(s.geom::geography, ST_Point($1, $2)::geography) / 1000 AS distance_km
FROM species_ranges s
WHERE ST_DWithin(
  s.geom::geography,
  ST_Point($1, $2)::geography,  -- $1 = lng, $2 = lat (PostGIS uses lng,lat order!)
  $3                             -- $3 = radius in METERS (not km!)
)
ORDER BY distance_km ASC;
```

**Critical:** `ST_Point` takes `(longitude, latitude)` — NOT `(latitude, longitude)`. This is the most common PostGIS mistake. Always verify parameter order.

**Critical:** `ST_DWithin` with `::geography` cast takes meters, not kilometers. Pass `radius_km * 1000`.

### Spatial index (required for performance)
```sql
CREATE INDEX idx_species_ranges_geom ON species_ranges USING GIST (geom);
```

Without this index, every habitat query does a full table scan. Performance will be unacceptable at scale.

## pgvector Rules

pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector;`

### Embedding columns
```sql
-- For Google text-embedding-004: 768 dimensions
embedding vector(768)
```

### Similarity search
```sql
SELECT id, content, metadata,
       1 - (embedding <=> $1::vector) AS similarity
FROM species_facts
WHERE 1 - (embedding <=> $1::vector) > 0.40
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

`<=>` is cosine distance. `1 - distance = similarity`. Higher similarity = more relevant.

### Embedding storage
Embeddings come from the Google AI SDK as `number[]`. Store as a cast:
```typescript
await sql`
  INSERT INTO species_facts (content, embedding, metadata)
  VALUES (${content}, ${JSON.stringify(embedding)}::vector, ${metadata})
`;
```

## Schema Conventions

- All tables use `id UUID DEFAULT gen_random_uuid() PRIMARY KEY`
- All tables have `created_at TIMESTAMPTZ DEFAULT NOW()`
- `updated_at` on mutable tables: `DEFAULT NOW()` + trigger
- Snake_case for all column names
- Never use `TEXT` for enum-like values — use `VARCHAR` with a CHECK constraint or a PostgreSQL enum
- Nullable fields that are AI-populated: add a comment `-- populated by <agent name>`

## Migrations

Migrations live in `server/src/db/migrations/`. Filename format: `0001_description.sql`.

Each migration file has:
```sql
-- Migration: 0001_initial_schema
-- Up
CREATE TABLE ...;

-- Down (rollback)
DROP TABLE ...;
```

Run migrations with a script in `scripts/`. Never run migrations manually against production from your local machine — always via the Railway-deployed migration runner.

## Key Tables Reference

| Table | Purpose |
|---|---|
| `species_ranges` | IUCN habitat polygons (PostGIS geometry) |
| `disaster_events` | All events that passed PostGIS filter, with full enrichment |
| `alerts` | Assessed alerts with threat level + predictions |
| `agent_prompts` | Agent system prompts (updatable by Refiner) |
| `refiner_scores` | Prediction accuracy scores over time (for trend chart) |
| `species_facts` | RAG index: species ecology, threats, conservation status |
| `conservation_context` | RAG index: broader conservation context docs |

Full schema in `docs/DATABASE_SCHEMA.md`.

## What NOT to Do

- Do NOT use the Supabase client (`@supabase/supabase-js`) — we're on Neon
- Do NOT store large blobs in PostgreSQL — species shapefiles load into `species_ranges` geometry columns, not blob storage
- Do NOT do `SELECT *` in production queries — always name columns
- Do NOT create postgres() instances per file — use the shared `db/client.ts`
- Do NOT pass lat/lng in the wrong order to `ST_Point` — it expects `(lng, lat)`
