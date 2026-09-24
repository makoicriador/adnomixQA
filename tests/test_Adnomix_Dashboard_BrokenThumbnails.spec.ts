import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * Evidence capture for a confirmed live bug (see .agent-memory/project_conventions.md,
 * 2026-09-19 Warehouses/Products audit entry): the `/v2/home` dashboard
 * deterministically 404s roughly 18 `storage/marketplace_image/*.jpg`
 * thumbnails on every load — distinct from the already-documented
 * *intermittent* 502s on product-detail marketplace images under
 * concurrent load. Standalone evidence-capture spec, not part of the
 * routine suite.
 */
test.describe('Dashboard > Product thumbnails 404 on every load (bug repro)', () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    test.setTimeout(60_000);

    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    const storageState = await authContext.storageState();
    await authContext.close();

    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
  });

  test('dashboard product thumbnails 404 instead of loading', async () => {
    const failedThumbnails: string[] = [];
    page.on('response', (response) => {
      if (response.status() === 404 && /storage\/marketplace_image\//i.test(response.url())) {
        failedThumbnails.push(response.url());
      }
    });

    await new HomePage(page).gotoV2Home();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1_500);

    // Scroll the product list into view so the broken-image icons are
    // actually on screen for the recording, not just detected via network.
    const firstThumbnail = page.locator('img[src*="marketplace_image"]').first();
    if (await firstThumbnail.count()) {
      await firstThumbnail.scrollIntoViewIfNeeded();
    }

    console.log(`Confirmed ${failedThumbnails.length} 404'd thumbnail(s):`, failedThumbnails.slice(0, 5));
    expect(failedThumbnails.length, 'Expected at least one marketplace_image thumbnail to 404 on the dashboard').toBeGreaterThan(0);

    if (isHeaded) await page.waitForTimeout(2_000);
  });
});
