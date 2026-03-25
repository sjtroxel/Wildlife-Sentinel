import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      DATABASE_URL: 'postgresql://fake:fake@fake.neon.tech/fake?sslmode=require',
      REDIS_URL: 'redis://localhost:6379',
      DISCORD_BOT_TOKEN: 'fake_token',
      DISCORD_GUILD_ID: '123456789',
      DISCORD_CHANNEL_WILDLIFE_ALERTS: '123456789',
      DISCORD_CHANNEL_SENTINEL_OPS: '123456789',
      NASA_FIRMS_API_KEY: 'fake_key',
      GOOGLE_AI_API_KEY: 'fake_key',
      ANTHROPIC_API_KEY: 'fake_key',
      IUCN_API_TOKEN: 'fake_token',
      NODE_ENV: 'test',
    },
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 },
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/**/*.d.ts', 'src/db/migrations/**'],
      reporter: ['text', 'html'],
    },
  },
});
