import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
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
 * End-to-end coverage for Products > All Products on adxmanager.dev: search
 * (by product name and by SKU/code), the Status filter (Active,
 * Discontinued, Active + Discontinued), combining a filter with a search,
 * CSV export, and a full create -> search round trip against a throwaway
 * fixture this suite creates itself (so the read-only assertions above it
 * never depend on that fixture, and the real, pre-existing products are
 * never mutated). Scraped live and documented in
 * pages/ProductsPage.ts/project_conventions.md: the Filter drawer's
 * "Discontinued" checkbox is really `value="Inactive"`, "Active" is
 * pre-checked by default, and a much larger Create/Edit drawer than any
 * Service Providers section (see ProductsPage's own doc comment) — only
 * Product Name/SKU/Select Supplier are actually required server-side. One
 * authenticated session is shared across the suite (serial mode) since
 * login is a real network round trip against a live app. A page-health
 * monitor (tests/utils/errorScraper.ts) watches the whole suite for
 * uncaught JS exceptions or same-origin 5xx responses.
 */
test.describe('Products > All Products Index', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let products: ProductsPage;
  let issues: PageIssue[];
  let activeCount = 0;
  let discontinuedCount = 0;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    test.setTimeout(60_000);

    // Step 1-2: log in inside a throwaway, unrecorded context — the request
    // is to start the recording once we reach /v2/home, not during login.
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    const storageState = await authContext.storageState();
    await authContext.close();

    // Step 3-4: a fresh, already-authenticated context/page — recording (if
    // headed) starts here, i.e. from the very first navigation to /v2/home.
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

  test('search bar finds a product by name', async () => {
    const row = await products.findRowWithValue('name');
    await products.search(row.name);
    expect(await products.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(products.rowsContaining(row.name).first()).toBeVisible();
  });

  test('search bar finds a product by SKU/code', async () => {
    const row = await products.findRowWithValue('sku');
    await products.search(row.sku);
    expect(await products.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(products.rowsContaining(row.sku).first()).toBeVisible();
  });

  test('filters products by status = Active', async () => {
    await products.filterByStatus(['Active']);
    activeCount = await products.getResultsCount();
    expect(activeCount).toBeGreaterThan(0);
  });

  test('filters products by status = Discontinued', async () => {
    await products.filterByStatus(['Inactive']);
    discontinuedCount = await products.getResultsCount();
    expect(discontinuedCount).toBeGreaterThanOrEqual(0);
  });

  test('filters products by status = Active + Discontinued', async () => {
    await products.filterByStatus(['Active', 'Inactive']);
    const combinedCount = await products.getResultsCount();
    expect(combinedCount).toBe(activeCount + discontinuedCount);
  });

  test('combines a search term with a status filter', async () => {
    await products.filterByStatus(['Active']);
    const baselineActiveCount = await products.getResultsCount();
    const row = await products.findRowWithValue('name');
    await products.search(row.name);
    const narrowedCount = await products.getResultsCount();
    expect(narrowedCount).toBeGreaterThanOrEqual(1);
    expect(narrowedCount).toBeLessThanOrEqual(baselineActiveCount);
    await expect(products.rowsContaining(row.name).first()).toBeVisible();
  });

  test('downloads the products list as CSV', async () => {
    const download = await products.downloadCsv();
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const content = fs.readFileSync(filePath!, 'utf-8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
  });

  test('end to end: creates a product and finds it via search', async () => {
    const data = buildFakeProductData();
    await products.createProduct(data);
    await expect(products.successAlert.first()).toContainText('Product created successfully.');

    await products.resetToCleanState();
    await products.search(data.productName);
    const row = products.rowsContaining(data.productName).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(data.sku);
  });
});
