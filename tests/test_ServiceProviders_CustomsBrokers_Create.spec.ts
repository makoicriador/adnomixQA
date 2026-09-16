import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { CustomsBrokersPage, buildFakeCustomsBrokerData } from '../pages/CustomsBrokersPage';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Service Providers > Customs Brokers > Add Customs
 * Broker on adxmanager.dev: a happy-path creation with FakeFiller-style
 * random data (@faker-js/faker, see
 * CustomsBrokersPage.buildFakeCustomsBrokerData), and two negative-path
 * checks. One authenticated session is shared across the suite (serial
 * mode) since login is a real network round trip against a live app.
 */
test.describe('Service Providers > Customs Brokers Create', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let customsBrokers: CustomsBrokersPage;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    // describe.configure({ timeout }) only applies to test bodies, not hooks —
    // beforeAll needs its own timeout extended explicitly for the real login
    // + navigation round trip against the live app.
    test.setTimeout(60_000);

    // Step 1-2: log in and navigate to Customs Brokers (login -> /home ->
    // /v2/home -> sidebar) inside a throwaway, unrecorded context — the
    // request is to start the recording once we reach the Customs Brokers
    // index itself, not during login/navigation.
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToCustomsBrokers();
    const storageState = await authContext.storageState();
    await authContext.close();

    // Step 3-4: a fresh, already-authenticated context/page — recording (if
    // headed) starts here, and the very first navigation it performs is a
    // direct hit of /v2/service-providers/customs-brokers (not another pass
    // through /v2/home + sidebar), so the recording begins exactly at the
    // URL under test rather than one step earlier.
    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();

    customsBrokers = new CustomsBrokersPage(page);
    await customsBrokers.goto();
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
  });

  test.beforeEach(async () => {
    await customsBrokers.resetToCleanState();
  });

  test('creates a new customs broker with all required fields filled', async () => {
    const data = buildFakeCustomsBrokerData();

    await customsBrokers.createCustomsBroker(data);
    await expect(customsBrokers.successAlert.first()).toContainText('Customs broker created successfully.');

    await customsBrokers.search(data.companyName);
    const row = customsBrokers.rowsContaining(data.companyName).first();
    await expect(row).toBeVisible();
    // Verified against the live app: this section's Location column is
    // "{city}, {state}, {country}" — a third, different format from both
    // Suppliers ("{state}, {country}") and Freight Forwarders
    // ("{city}, {country}"). Confirmed live, not assumed to match either.
    await expect(row).toContainText(`${data.city}, ${data.state}, ${data.country}`);
    await expect(row).toContainText(data.contactName);
  });

  test('shows a validation error when Company Name is left blank', async () => {
    const { companyName, ...withoutCompanyName } = buildFakeCustomsBrokerData();
    void companyName;

    await customsBrokers.submitCreateDrawer(withoutCompanyName);
    await expect(customsBrokers.errorAlert.first()).toContainText('The company name field is required.');
  });

  test('shows a validation error when City is left blank', async () => {
    // Verified against the live app: unlike Suppliers, City here fails
    // gracefully (a proper validation message, not an unhandled 500) —
    // checked live before writing this test, see project_conventions.md.
    const { city, ...withoutCity } = buildFakeCustomsBrokerData();
    void city;

    await customsBrokers.submitCreateDrawer(withoutCity);
    await expect(customsBrokers.errorAlert.first()).toContainText('The city field is required.');
  });
});
