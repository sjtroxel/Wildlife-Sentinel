/**
 * Applies unapplied .sql migrations in order.
 * Usage: npm run migrate
 * Reads DATABASE_URL from environment.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) { console.error('DATABASE_URL required'); process.exit(1); }

const sql = postgres(databaseUrl, { ssl: 'require' });
const migrationsDir = join(__dirname, '../server/src/db/migrations');

async function run(): Promise<void> {
  // Create tracking table if needed
  await sql`
    CREATE TABLE IF NOT EXISTS migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  const applied = new Set(
    (await sql<{ filename: string }[]>`SELECT filename FROM migrations`).map(r => r.filename)
  );

  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const filename of files) {
    if (applied.has(filename)) { console.log(`[migrate] Skip ${filename}`); continue; }

    const content = readFileSync(join(migrationsDir, filename), 'utf8');
    const upSection = content.split('-- Down')[0] ?? content;

    console.log(`[migrate] Applying ${filename}...`);
    await sql.begin(async (tx) => {
      await tx.unsafe(upSection);
      await tx`INSERT INTO migrations (filename) VALUES (${filename})`;
    });
    console.log(`[migrate] Done: ${filename}`);
  }

  console.log('[migrate] All migrations current.');
  await sql.end();
}

run().catch(err => { console.error('[migrate] Fatal:', err); process.exit(1); });
