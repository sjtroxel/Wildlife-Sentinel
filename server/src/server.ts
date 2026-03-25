import 'dotenv/config';
import { app } from './app.js';
import { config } from './config.js';
import { sql } from './db/client.js';
import { redis } from './redis/client.js';
import { startBot } from './discord/bot.js';
import { startScouts } from './scouts/index.js';
import { startEnrichmentAgent } from './agents/EnrichmentAgent.js';
import { startDiscordPublisher } from './discord/publisher.js';

async function main(): Promise<void> {
  try {
    await sql`SELECT 1`;
    console.log('[startup] Database connected');
  } catch (err) {
    console.error('[startup] Database connection failed:', err);
    process.exit(1);
  }

  try {
    await redis.ping();
    console.log('[startup] Redis connected');
  } catch (err) {
    console.error('[startup] Redis connection failed:', err);
    process.exit(1);
  }

  await startBot();

  // Start the pipeline — these run as long-lived async loops
  startScouts();
  void startEnrichmentAgent();
  void startDiscordPublisher();

  app.listen(config.port, () => {
    console.log(`[startup] Wildlife Sentinel running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
