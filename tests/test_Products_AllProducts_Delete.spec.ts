import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { ProductsPage, buildFakeProductData } from '../pages/ProductsPage';
import { attachPageHealthMonitor, describeIssues, PageIssue } from './utils/errorScraper';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Products > All Products > Delete on
 * adxmanager.dev. Each test creates its own throwaway product fixture so
 * the real, pre-existing products used by the Index suite are never
 * touched. Confirmed live and documented in ProductsPage's doc comment:
 * unlike every Service Providers section (which either Deactivates/
 * Activates a status flag or hard-deletes via a kebab menu), "Delete" here
 * is a SOFT delete behind a native `confirm()` dialog — the record's own
 * detail page keeps rendering at the same URL afterward (HTTP 200, all data
 * intact, a "Deleted" badge shown) rather than 404ing, and it only
 * disappears from the index's default listing/search (there is no
 * "Deleted" option in the Filter drawer's Status choices at all, only
 * Active/Discontinued). One authenticated session is shared across the
 * suite (serial mode) since login is a real network round trip against a
 * live app.
 */
test.describe('Products > All Products Delete', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let products: ProductsPage;
  let issues: PageIssue[];

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    // describe.configure({ timeout }) only applies to test bodies, not hooks —
    // beforeAll needs its own timeout extended explicitly for the real login
    // + navigation round trip against the live app.
    test.setTimeout(60_000);

    // Step 1-2: log in and navigate to All Products (login -> /home ->
    // /v2/home -> sidebar) inside a throwaway, unrecorded context — the
    // request is to start the recording once we reach /v2/home, not during
    // login.
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToAllProducts();
    const storageState = await authContext.storageState();
    await authContext.close();

    // Step 3-4: a fresh, already-authenticated context/page — recording (if
    // headed) starts here, from the very first navigation to /v2/home, then
    // the same sidebar path into All Products as the throwaway context
    // above so the recorded run shows the whole real navigation.
    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();
    issues = attachPageHealthMonitor(page);

    const home = new HomePage(page);
    await home.gotoV2Home();
    await home.navigateToAllProducts();

    products = new ProductsPage(page);
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
    if (issues.length) console.warn(`[Page health] ${issues.length} issue(s) detected:\n${describeIssues(issues)}`);
    expect(issues, 'No uncaught JS exceptions or 5xx server errors should occur during this suite').toEqual([]);
  });

  test.beforeEach(async () => {
    await products.resetToCleanState();
  });

  test('deletes a product and removes it from the default index search', async () => {
    const fixture = buildFakeProductData({ productName: `QA Automation Delete Fixture ${Date.now()}` });
    await products.createProduct(fixture);
    await expect(products.successAlert.first()).toContainText('Product created successfully.');
    const detailUrl = page.url();

    await products.resetToCleanState();
    await products.search(fixture.productName);
    await expect(products.rowsContaining(fixture.productName).first()).toBeVisible();

    await products.openProductDetail(fixture.productName);
    await products.deleteCurrentProduct();

    // Verified live: redirects to the plain (unfiltered) index with a
    // success banner — same duplicate desktop/mobile markup pattern
    // documented elsewhere in this app, so `.first()` rather than assuming
    // a single match.
    await expect(page).toHaveURL(/\/v2\/products$/);
    await expect(products.successAlert.first()).toContainText('Product deleted successfully.');

    // Confirm it actually disappeared from the default search, not just
    // that a banner appeared.
    await products.resetToCleanState();
    await products.search(fixture.productName);
    await expect(page.getByText(/No products found/i)).toBeVisible();

    // Documents the soft-delete quirk itself: the record's own detail page
    // is still reachable at the same URL (HTTP 200, not a 404), with a
    // "Deleted" badge, rather than being truly removed.
    const response = await page.goto(detailUrl);
    expect(response?.status()).toBe(200);
    await expect(page.getByText('Deleted', { exact: true })).toBeVisible();
  });

  test('dismissing the confirmation dialog leaves the product untouched', async () => {
    const fixture = buildFakeProductData({ productName: `QA Automation Cancel Delete Fixture ${Date.now()}` });
    await products.createProduct(fixture);
    await expect(products.successAlert.first()).toContainText('Product created successfully.');
    const detailUrl = page.url();

    await products.cancelDeleteCurrentProduct();

    // Verified live: dismissing the native confirm() leaves the page
    // exactly where it was — no navigation, no deletion.
    await expect(page).toHaveURL(detailUrl);

    await products.resetToCleanState();
    await products.search(fixture.productName);
    await expect(products.rowsContaining(fixture.productName).first()).toBeVisible();
  });
});
