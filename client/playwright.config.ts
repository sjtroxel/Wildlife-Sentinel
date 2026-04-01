import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3001',
    viewport: { width: 375, height: 812 },
  },
  webServer: {
    command: 'npm run dev',
    port: 3001,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
