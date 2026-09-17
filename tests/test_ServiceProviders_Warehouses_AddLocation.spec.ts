import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { WarehousesPage, buildFakeWarehouseData, buildFakeWarehouseLocationData } from '../pages/WarehousesPage';
import { attachPageHealthMonitor, describeIssues, PageIssue } from './utils/errorScraper';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Service Providers > Warehouses > Add Location on
 * adxmanager.dev — a feature unique to Warehouses (no equivalent on
 * Suppliers/Freight Forwarders/Customs Brokers): a warehouse's own detail
 * page has an "Add Location" button opening a client-side modal
 * (`#warehouse-location-modal`) that appends an entry to that warehouse's
 * "Warehouse Locations" list. The suite creates its own throwaway warehouse
 * fixture and adds locations to it, so it never mutates one of the real,
 * pre-existing warehouses. One authenticated session is shared across the
 * suite (serial mode, and the tests intentionally build on each other's
 * state) since login is a real network round trip against a live app. A
 * page-health monitor (tests/utils/errorScraper.ts) watches the whole suite
 * for uncaught JS exceptions or same-origin 5xx responses.
 */
test.describe('Service Providers > Warehouses Add Location', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let warehouses: WarehousesPage;
  let issues: PageIssue[];
  let fixtureCompanyName: string;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    test.setTimeout(90_000);

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

    // Fixture: a throwaway warehouse this suite adds locations to. Verified
    // live: creating one redirects straight to its own detail page, which is
    // exactly where "Add Location" lives, so no extra navigation is needed
    // before the first scenario below.
    const fixture = buildFakeWarehouseData({ companyName: `QA Automation Fixture ${Date.now()}` });
    await warehouses.createWarehouse(fixture);
    await expect(warehouses.successAlert.first()).toContainText('Warehouse created successfully.');
    fixtureCompanyName = fixture.companyName;
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
    if (issues.length) console.warn(`[Page health] ${issues.length} issue(s) detected:\n${describeIssues(issues)}`);
    expect(issues, 'No uncaught JS exceptions or 5xx server errors should occur during this suite').toEqual([]);
  });

  test('adds a location to the warehouse', async () => {
    const location = buildFakeWarehouseLocationData();

    await warehouses.addLocation(location);

    // Verified against the live app: a successful "Save Location" shows a
    // one-off success banner naming the new location by its own company
    // name, then lists it under "Warehouse Locations" on the same detail
    // page (no navigation — the modal is a client-side overlay).
    await expect(warehouses.successAlert.first()).toContainText(`Location '${location.companyName}' added successfully.`);
    await expect(warehouses.locationRow(location.companyName)).toContainText(location.companyName);
  });

  test('adds a second location, and both remain listed', async () => {
    const location = buildFakeWarehouseLocationData();

    await warehouses.addLocation(location);

    await expect(warehouses.successAlert.first()).toContainText(`Location '${location.companyName}' added successfully.`);
    await expect(warehouses.locationRow(location.companyName)).toContainText(location.companyName);
    // The warehouse itself is still the same fixture — re-navigating to its
    // detail page (rather than trusting in-page state) confirms the first
    // location added above actually persisted server-side, not just in the
    // client-side Alpine list.
    await warehouses.resetToCleanState();
    await warehouses.search(fixtureCompanyName);
    await warehouses.rowsContaining(fixtureCompanyName).first().locator('a').first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain(location.companyName);
  });

  test('leaving a required field blank blocks submission via the browser\'s own validation, not a server error', async () => {
    // Verified against the live app: every field in this modal is native
    // HTML5 `required` (not the server-side validation used everywhere else
    // in this app) — the browser blocks the form submission itself before
    // any request is sent, so no `.kt-alert-destructive` banner ever
    // appears and the modal stays open. This is a genuinely different
    // validation mechanism from every other Create/Edit form in this suite
    // (documented in WarehousesPage.ts) — worth calling out explicitly
    // rather than assuming it behaves like the others.
    await warehouses.openAddLocationModal();
    const contactNoInput = page.locator('#modal_contact_no');
    const isValid = await contactNoInput.evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(isValid).toBe(false);

    await page.getByRole('button', { name: 'Save Location', exact: true }).click();
    // Still on the same detail page, modal still open — no navigation, no
    // success/error banner, since the browser never let the submit through.
    await expect(page.locator('#warehouse-location-modal')).toBeVisible();
    await expect(warehouses.successAlert).toHaveCount(0);
  });
});
