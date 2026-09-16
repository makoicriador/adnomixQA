import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { FreightForwardersPage, buildFakeFreightForwarderData } from '../pages/FreightForwardersPage';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Service Providers > Freight Forwarders > Add
 * Freight Forwarder on adxmanager.dev: a happy-path creation with
 * FakeFiller-style random data (@faker-js/faker, see
 * FreightForwardersPage.buildFakeFreightForwarderData), and two
 * negative-path checks. One authenticated session is shared across the
 * suite (serial mode) since login is a real network round trip against a
 * live app.
 */
test.describe('Service Providers > Freight Forwarders Create', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let freightForwarders: FreightForwardersPage;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    // describe.configure({ timeout }) only applies to test bodies, not hooks —
    // beforeAll needs its own timeout extended explicitly for the real login
    // + navigation round trip against the live app.
    test.setTimeout(60_000);

    // Step 1-2: log in and navigate to Freight Forwarders (login -> /home ->
    // /v2/home -> sidebar) inside a throwaway, unrecorded context — the
    // request is to start the recording once we reach the Freight
    // Forwarders index itself, not during login/navigation.
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToFreightForwarders();
    const storageState = await authContext.storageState();
    await authContext.close();

    // Step 3-4: a fresh, already-authenticated context/page — recording (if
    // headed) starts here, and the very first navigation it performs is a
    // direct hit of /v2/service-providers/freight-forwarders (not another
    // pass through /v2/home + sidebar), so the recording begins exactly at
    // the URL under test rather than one step earlier.
    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();

    freightForwarders = new FreightForwardersPage(page);
    await freightForwarders.goto();
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
  });

  test.beforeEach(async () => {
    await freightForwarders.resetToCleanState();
  });

  test('creates a new freight forwarder with all required fields filled', async () => {
    const data = buildFakeFreightForwarderData();

    await freightForwarders.createFreightForwarder(data);
    // Verified live: same duplicate desktop/mobile markup pattern
    // documented for Suppliers — `.first()` rather than assuming a single
    // match, even where this particular Create button only rendered once.
    await expect(freightForwarders.successAlert.first()).toContainText('Freight forwarder created successfully.');
    // Verified against the live app: unlike Suppliers/Customs Brokers
    // (which stay on the index after a successful create), this section
    // redirects straight to the new record's detail page — back to the
    // index explicitly before asserting on the list row.
    await freightForwarders.resetToCleanState();

    await freightForwarders.search(data.companyName);
    const row = freightForwarders.rowsContaining(data.companyName).first();
    await expect(row).toBeVisible();
    // Verified against the live app: this section's Location column is
    // "{city}, {country}" — a different format from Suppliers'
    // "{state}, {country}". Confirmed live, not assumed to match.
    await expect(row).toContainText(`${data.city}, ${data.country}`);
    await expect(row).toContainText(data.contactName);
  });

  test('shows a validation error when Company Name is left blank', async () => {
    const { companyName, ...withoutCompanyName } = buildFakeFreightForwarderData();
    void companyName;

    await freightForwarders.submitCreateDrawer(withoutCompanyName);
    await expect(freightForwarders.errorAlert.first()).toContainText('The company name field is required.');
  });

  test('shows a validation error when City is left blank', async () => {
    // Verified against the live app: unlike Suppliers, City here fails
    // gracefully (a proper validation message, not an unhandled 500) —
    // checked live before writing this test, see project_conventions.md.
    const { city, ...withoutCity } = buildFakeFreightForwarderData();
    void city;

    await freightForwarders.submitCreateDrawer(withoutCity);
    await expect(freightForwarders.errorAlert.first()).toContainText('The city field is required.');
  });
});
