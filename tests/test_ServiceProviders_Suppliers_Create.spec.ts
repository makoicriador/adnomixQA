import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { SuppliersPage, buildFakeSupplierData } from '../pages/SuppliersPage';
import { buildFakeBankAccountData } from '../pages/BankAccountsSection';
import { attachPageHealthMonitor, describeIssues, PageIssue } from './utils/errorScraper';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Service Providers > Suppliers > Add Supplier on
 * adxmanager.dev: a happy-path creation with FakeFiller-style random data
 * (@faker-js/faker, see SuppliersPage.buildFakeSupplierData), and a
 * negative-path check of a field the UI never marks as required but the
 * server rejects a submission without. One authenticated session is shared
 * across the suite (serial mode) since login is a real network round trip
 * against a live app.
 */
test.describe('Service Providers > Suppliers Create', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let suppliers: SuppliersPage;
  let issues: PageIssue[];

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    // describe.configure({ timeout }) only applies to test bodies, not hooks —
    // beforeAll needs its own timeout extended explicitly for the real login
    // + navigation round trip against the live app.
    test.setTimeout(60_000);

    // Step 1-2: log in and navigate to Suppliers (login -> /home -> /v2/home
    // -> sidebar) inside a throwaway, unrecorded context — the request is
    // to start the recording once we reach the Suppliers index itself, not
    // during login/navigation.
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToSuppliers();
    const storageState = await authContext.storageState();
    await authContext.close();

    // Step 3-4: a fresh, already-authenticated context/page — recording (if
    // headed) starts here, and the very first navigation it performs is a
    // direct hit of /v2/service-providers/suppliers (not another pass
    // through /v2/home + sidebar), so the recording begins exactly at the
    // URL under test rather than one step earlier.
    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();
    issues = attachPageHealthMonitor(page);

    suppliers = new SuppliersPage(page);
    await suppliers.goto();
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
    if (issues.length) console.warn(`[Page health] ${issues.length} issue(s) detected:\n${describeIssues(issues)}`);
    expect(issues, 'No uncaught JS exceptions or 5xx server errors should occur during this suite').toEqual([]);
  });

  test.beforeEach(async () => {
    await suppliers.resetToCleanState();
  });

  test('creates a new supplier with all required fields filled and a bank account', async () => {
    const data = buildFakeSupplierData();
    const bankAccount = buildFakeBankAccountData();

    // The Bank Accounts section lives inside the same Create drawer form
    // (confirmed live) — createSupplier's optional `bankAccount` adds it
    // before the drawer's own Create button submits everything together in
    // one request.
    await suppliers.createSupplier(data, { bankAccount });
    // Verified live: the success banner renders twice (same duplicate
    // desktop/mobile markup pattern as the two "Create" submit buttons) —
    // `.first()` rather than assuming a single match.
    await expect(suppliers.successAlert.first()).toContainText('Supplier created successfully.');

    await suppliers.search(data.companyName);
    const row = suppliers.rowsContaining(data.companyName).first();
    await expect(row).toBeVisible();
    // Verified against the live app: the Location column renders
    // "{state}, {country}" — not "{city}, {country}" as the Index suite's
    // seed-data examples might suggest (their "state" happens to hold a
    // city name for several Chinese suppliers). Since this test controls
    // its own fixture data, it asserts the real, unambiguous format.
    await expect(row).toContainText(`${data.state}, ${data.country}`);
    await expect(row).toContainText(data.contactName);

    // Confirm the bank account actually persisted, not just that the form
    // accepted it — reopen the supplier's own Edit drawer and check its
    // Bank Accounts section shows the bank name we just added.
    await suppliers.openEditFor(data.companyName);
    await expect(suppliers.bankAccounts.rowContaining(bankAccount.bankName)).toContainText(bankAccount.bankName);
  });

  test('shows a validation error when Balance Timing is left blank', async () => {
    // Verified against the live app: "Balance Timing" has no "*" in the UI
    // (unlike Company, Street Address, State, Country, Contact Name, Phone
    // Number, Email and Lead Time to US, which all do), but the server
    // still rejects a submission without it — gracefully, via a validation
    // alert, not a crash. Omit only that one field.
    const { balanceTiming, ...withoutBalanceTiming } = buildFakeSupplierData();
    void balanceTiming;

    await suppliers.submitCreateDrawer(withoutBalanceTiming);
    await expect(suppliers.errorAlert.first()).toContainText('The balance payment timing field is required.');
  });

  test('shows a validation error when Company is left blank', async () => {
    // Verified against the live app: unlike City and Balance Timing (see
    // the previous test and project_conventions.md), leaving a "*"-marked
    // field like Company blank fails gracefully — "The company name field
    // is required." — and creates no supplier.
    const { companyName, ...withoutCompanyName } = buildFakeSupplierData();
    void companyName;

    await suppliers.submitCreateDrawer(withoutCompanyName);
    await expect(suppliers.errorAlert.first()).toContainText('The company name field is required.');
  });
});
