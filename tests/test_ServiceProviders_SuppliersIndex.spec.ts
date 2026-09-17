import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
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
 * End-to-end coverage for Service Providers > Suppliers on adxmanager.dev:
 * search (by name/contact/location/email), the Status filter (Active,
 * Inactive, Active + Inactive), combining a filter with a search, CSV
 * export, and a full create -> add bank account -> search round trip
 * against a throwaway fixture this suite creates itself. Re-verified live
 * on 2026-09-17: the Status filter is now the same "Filter" button + drawer
 * + single "Update" button used by Freight Forwarders/Customs
 * Brokers/Warehouses (see SuppliersPage.filterByStatus) — the "Add Filter"
 * dropdown + "Status: ..." chip this suite originally exercised no longer
 * exists anywhere on the live page. One authenticated session is shared
 * across the suite (serial mode) since login is a real network round trip
 * against a live app. A page-health monitor (tests/utils/errorScraper.ts)
 * watches the whole suite for uncaught JS exceptions or same-origin 5xx
 * responses.
 */
test.describe('Service Providers > Suppliers Index', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let suppliers: SuppliersPage;
  let issues: PageIssue[];
  let activeCount = 0;
  let inactiveCount = 0;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    // describe.configure({ timeout }) only applies to test bodies, not hooks —
    // beforeAll needs its own timeout extended explicitly for the real login
    // + navigation round trip against the live app.
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
    await home.navigateToSuppliers();

    suppliers = new SuppliersPage(page);
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

  test('search bar finds a supplier by supplier name', async () => {
    const row = await suppliers.findRowWithValue('supplier');
    await suppliers.search(row.supplier);
    expect(await suppliers.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(suppliers.rowsContaining(row.supplier).first()).toBeVisible();
  });

  test('search bar finds a supplier by contact name', async () => {
    const row = await suppliers.findRowWithValue('contact');
    await suppliers.search(row.contact);
    expect(await suppliers.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(suppliers.rowsContaining(row.contact).first()).toBeVisible();
  });

  test('search bar finds a supplier by location', async () => {
    const row = await suppliers.findRowWithValue('location');
    // Verified against the live app: search matches the city/country as
    // separate tokens, not the literal "City, Country" display string (that
    // exact string, comma included, returns 0 results). Search the city segment.
    const citySegment = row.location.split(',')[0].trim();
    await suppliers.search(citySegment);
    expect(await suppliers.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(suppliers.rowsContaining(citySegment).first()).toBeVisible();
  });

  test('search bar finds a supplier by email', async () => {
    const row = await suppliers.findRowWithValue('email');
    await suppliers.search(row.email);
    expect(await suppliers.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(suppliers.rowsContaining(row.email).first()).toBeVisible();
  });

  test('filters suppliers by status = Active', async () => {
    await suppliers.filterByStatus(['Active']);
    activeCount = await suppliers.getResultsCount();
    expect(activeCount).toBeGreaterThan(0);
  });

  test('filters suppliers by status = Inactive', async () => {
    await suppliers.filterByStatus(['Inactive']);
    inactiveCount = await suppliers.getResultsCount();
    expect(inactiveCount).toBeGreaterThanOrEqual(0);
  });

  test('filters suppliers by status = Active + Inactive', async () => {
    await suppliers.filterByStatus(['Active', 'Inactive']);
    const combinedCount = await suppliers.getResultsCount();
    // Independent of how many suppliers exist right now, Active + Inactive
    // must equal the sum of the two prior single-status scenarios.
    expect(combinedCount).toBe(activeCount + inactiveCount);
  });

  test('combines a search term with a status filter', async () => {
    await suppliers.filterByStatus(['Active']);
    const baselineActiveCount = await suppliers.getResultsCount();
    const row = await suppliers.findRowWithValue('supplier');
    await suppliers.search(row.supplier);
    const narrowedCount = await suppliers.getResultsCount();
    expect(narrowedCount).toBeGreaterThanOrEqual(1);
    expect(narrowedCount).toBeLessThanOrEqual(baselineActiveCount);
    await expect(suppliers.rowsContaining(row.supplier).first()).toBeVisible();
  });

  test('downloads the suppliers list as CSV', async () => {
    const download = await suppliers.downloadCsv();
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const content = fs.readFileSync(filePath!, 'utf-8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain('Supplier');
    expect(lines[0]).toContain('Status');
  });

  test('end to end: creates a supplier with a bank account and finds it via search', async () => {
    const data = buildFakeSupplierData();

    // The Bank Accounts section lives inside the same Create drawer form
    // (confirmed live) — createSupplier's optional `bankAccount` adds it
    // before the drawer's own Create button submits everything together in
    // one request.
    await suppliers.createSupplier(data, { bankAccount: buildFakeBankAccountData() });
    await expect(suppliers.successAlert.first()).toContainText('Supplier created successfully.');

    await suppliers.resetToCleanState();
    await suppliers.search(data.companyName);
    const row = suppliers.rowsContaining(data.companyName).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(`${data.state}, ${data.country}`);
  });
});
