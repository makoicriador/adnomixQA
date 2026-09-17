import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { WarehousesPage, buildFakeWarehouseData } from '../pages/WarehousesPage';
import { attachPageHealthMonitor, describeIssues, PageIssue } from './utils/errorScraper';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Service Providers > Warehouses > Add Warehouse on
 * adxmanager.dev: a happy-path creation with FakeFiller-style random data
 * (@faker-js/faker, see WarehousesPage.buildFakeWarehouseData), plus two
 * negative-path checks — a genuinely-required field (Company Name, fails
 * gracefully) and a confirmed hidden-required-fields bug (Min/Max Stock
 * Level, neither marked "*" in the UI but both required server-side; unlike
 * every other validation message in this app, omitting either one produces
 * only a generic "Failed to create warehouse. Please try again." banner
 * instead of a specific per-field message — see project_conventions.md).
 * One authenticated session is shared across the suite (serial mode) since
 * login is a real network round trip against a live app. A page-health
 * monitor (tests/utils/errorScraper.ts) watches the whole suite for
 * uncaught JS exceptions or same-origin 5xx responses.
 */
test.describe('Service Providers > Warehouses Create', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let warehouses: WarehousesPage;
  let issues: PageIssue[];

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    test.setTimeout(60_000);

    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToWarehouses();
    const storageState = await authContext.storageState();
    await authContext.close();

    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();
    issues = attachPageHealthMonitor(page);

    warehouses = new WarehousesPage(page);
    await warehouses.goto();
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
    if (issues.length) console.warn(`[Page health] ${issues.length} issue(s) detected:\n${describeIssues(issues)}`);
    expect(issues, 'No uncaught JS exceptions or 5xx server errors should occur during this suite').toEqual([]);
  });

  test.beforeEach(async () => {
    await warehouses.resetToCleanState();
  });

  test('creates a new warehouse with all required fields filled', async () => {
    const data = buildFakeWarehouseData();

    await warehouses.createWarehouse(data);
    // Verified live: on success this redirects straight to the new
    // warehouse's own detail page (same as Freight Forwarders; unlike
    // Suppliers/Customs Brokers, which stay on the index).
    await expect(warehouses.successAlert.first()).toContainText('Warehouse created successfully.');
    await expect(page).toHaveURL(/\/service-providers\/warehouses\/\d+$/);

    await warehouses.resetToCleanState();
    await warehouses.search(data.companyName);
    const row = warehouses.rowsContaining(data.companyName).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(data.address);
    await expect(row).toContainText(data.city);
    await expect(row).toContainText(data.contactName);
  });

  test('shows a validation error when Company Name is left blank', async () => {
    const { companyName, ...withoutCompanyName } = buildFakeWarehouseData();
    void companyName;

    await warehouses.submitCreateDrawer(withoutCompanyName);
    await expect(warehouses.errorAlert.first()).toContainText('The company name field is required.');
  });

  test('BUG: leaving Min/Max Stock Level blank fails with a generic error instead of a specific validation message', async () => {
    // Verified against the live app: unlike every other required field on
    // this form (Company Name, Street Address, Country, Contact Name,
    // Telephone Number, Email, Shipping Speed — all fail with "The X field
    // is required."), Min Stock Level and Max Stock Level carry no "*" in
    // the UI yet are BOTH required server-side. Omitting either one alone
    // still fails the create, but with only a generic, unhelpful "Failed to
    // create warehouse. Please try again." — the same class of bug as
    // Suppliers' hidden-required Balance Timing/City fields, though this one
    // at least fails gracefully (a 302 redirect with a flashed banner, not
    // an unhandled 500). This test documents the bug as a regression guard
    // rather than silently accepting it as intended behavior.
    const { minStockLevel, maxStockLevel, ...withoutStockLevels } = buildFakeWarehouseData();
    void minStockLevel;
    void maxStockLevel;

    await warehouses.submitCreateDrawer(withoutStockLevels);
    await expect(warehouses.errorAlert.first()).toContainText('Failed to create warehouse. Please try again.');
  });
});
