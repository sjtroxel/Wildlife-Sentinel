import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      DATABASE_URL: 'postgresql://fake:fake@fake.neon.tech/fake?sslmode=require',
      REDIS_URL: 'redis://localhost:6379',
      DISCORD_BOT_TOKEN: 'fake_token',
      DISCORD_CLIENT_ID: '111111111111111111',
      DISCORD_GUILD_ID: '123456789',
      DISCORD_CHANNEL_WILDLIFE_ALERTS: '123456789',
      DISCORD_CHANNEL_SENTINEL_OPS: '123456789',
      NASA_FIRMS_API_KEY: 'fake_key',
      GOOGLE_AI_API_KEY: 'fake_key',
      ANTHROPIC_API_KEY: 'fake_key',
      IUCN_API_TOKEN: 'fake_token',
      GFW_API_KEY: 'fake_gfw_key',
      NODE_ENV: 'test',
    },
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 },
      include: ['src/**/*.ts'],
      exclude: [
        'src/server.ts',
        'src/**/*.d.ts',
        'src/db/migrations/**',
        'src/db/client.ts',         // connection singleton — no testable logic
        'src/redis/client.ts',      // connection singleton — no testable logic
        'src/discord/bot.ts',       // discord.js lifecycle — integration only
        'src/discord/hitl.ts',      // reaction collector — integration only
        'src/scouts/index.ts',      // cron startup wrapper — integration only
        'src/refiner/RefinerScheduler.ts', // node-cron lifecycle — integration only
      ],
      reporter: ['text', 'html'],
    },
  },
});
