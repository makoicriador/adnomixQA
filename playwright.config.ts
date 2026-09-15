import { defineConfig, devices } from '@playwright/test';

/**
 * Central Playwright configuration.
 * The Healer agent parses the JSON + JUnit reports generated here, so both
 * reporters must stay enabled and their paths must match .agent-memory tooling.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 15_000,
  expect: { timeout: 5_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/results.xml' }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://example.com',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 5_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
