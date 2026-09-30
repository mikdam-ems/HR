import { defineConfig, devices } from '@playwright/test';

// End-to-end tests: the real app in a real browser (npm run test:e2e). Unit tests stay in vitest (npm test).
// The app runs in demo mode on its own in-memory database, so every run starts from the same sample team
// and never touches .data/.
const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // One walkthrough, in order: later steps build on earlier ones (a shift added, then swapped).
  fullyParallel: false,
  workers: 1,
  timeout: 5 * 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1360, height: 900 },
    timezoneId: 'Asia/Amman',
  },
  webServer: {
    // E2E_NO_BUILD=1 skips the build when .next is already fresh (e.g. right after npm run build).
    command: process.env.E2E_NO_BUILD ? 'npm run start' : 'npm run build && npm run start',
    url: `http://localhost:${PORT}/api/health`,
    timeout: 5 * 60_000,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      DEMO_MODE: 'true',
      AUTH_SECRET: 'e2e-only-secret-not-for-production-000000',
      DATABASE_URL: 'memory',
    },
  },
});
