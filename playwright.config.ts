import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

// Same flag the Suppliers spec checks — a person is actually watching a
// headed run, so always keep the recording (not just on failure) and slow
// every action down so it's legible rather than a blur.
//
// `--headed` only appears in process.argv of the main CLI process; worker
// processes run as `workerProcessEntry.js` with no CLI args at all. This
// config module is re-evaluated in every worker too, so stash the result in
// an env var here (in the main process) that workers inherit at spawn time.
const isHeaded = process.argv.includes('--headed') || process.env.ADNOMIX_HEADED === '1';
if (isHeaded) process.env.ADNOMIX_HEADED = '1';

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
  timeout: isHeaded ? 120_000 : 15_000,
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
    video: isHeaded ? 'on' : 'retain-on-failure',
    actionTimeout: 5_000,
    launchOptions: {
      slowMo: isHeaded ? 1_000 : 0,
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
