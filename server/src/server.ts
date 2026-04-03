import 'dotenv/config';
import { app } from './app.js';
import { setDbConnected, setRedisConnected } from './routes/health.js';
import { config } from './config.js';
import { sql } from './db/client.js';
import { redis } from './redis/client.js';
import { startBot } from './discord/bot.js';
import { startScouts } from './scouts/index.js';
import { startEnrichmentAgent } from './agents/EnrichmentAgent.js';
import { startHabitatAgent } from './agents/HabitatAgent.js';
import { startSpeciesContextAgent } from './agents/SpeciesContextAgent.js';
import { startThreatAssessmentAgent } from './agents/ThreatAssessmentAgent.js';
import { startSynthesisAgent } from './agents/SynthesisAgent.js';
import { startDiscordPublisher } from './discord/publisher.js';
import { startRefinerScheduler } from './refiner/RefinerScheduler.js';
import { startWeeklyDigestScheduler } from './discord/weeklyDigest.js';

/**
 * Wraps an agent loop with automatic restart on crash.
 * Agent loops are long-lived and should never die permanently.
 * A transient Redis/DB error should not kill the agent forever.
 */
async function startWithRestart(name: string, fn: () => Promise<void>): Promise<void> {
  while (true) {
    try {
      await fn();
    } catch (err) {
      console.error(`[${name}] Agent loop crashed — restarting in 5s:`, err);
      await new Promise<void>(r => setTimeout(r, 5_000));
    }
  }
}

async function main(): Promise<void> {
  try {
    await sql`SELECT 1`;
    setDbConnected();
    console.log('[startup] Database connected');
  } catch (err) {
    console.error('[startup] Database connection failed:', err);
    process.exit(1);
  }

  try {
    await redis.ping();
    setRedisConnected();
    console.log('[startup] Redis connected');
  } catch (err) {
    console.error('[startup] Redis connection failed:', err);
    process.exit(1);
  }

  await startBot();

  // Start the pipeline — long-lived async loops, each wrapped with auto-restart
  startScouts();
  void startWithRestart('enrichment', startEnrichmentAgent);
  void startWithRestart('habitat', startHabitatAgent);
  void startWithRestart('species-context', startSpeciesContextAgent);
  void startWithRestart('threat-assess', startThreatAssessmentAgent);
  void startWithRestart('synthesis', startSynthesisAgent);
  void startWithRestart('discord-publisher', startDiscordPublisher);
  startRefinerScheduler();
  startWeeklyDigestScheduler();

  app.listen(config.port, () => {
    console.log(`[startup] Wildlife Sentinel running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled rejection (agent loop crash):', reason);
  // Do NOT exit — keep the server alive so /health and the other agents continue
});
