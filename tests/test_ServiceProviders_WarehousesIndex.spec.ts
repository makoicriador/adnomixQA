import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
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
 * End-to-end coverage for Service Providers > Warehouses on adxmanager.dev:
 * search (by company name/address/contact/email), the Status filter
 * (Active, Inactive, Active + Inactive, plus combining a filter with a
 * search), CSV export, and a full create -> search round trip against a
 * throwaway fixture this suite creates itself (so the read-only assertions
 * above it never depend on that fixture, and the real, pre-existing
 * warehouses are never mutated). No bank account step here — confirmed
 * live that Warehouses has no Bank Accounts section at all, unlike
 * Suppliers/Freight Forwarders/Customs Brokers (see BankAccountsSection.ts
 * and WarehousesPage.ts doc comments). A page-health monitor
 * (tests/utils/errorScraper.ts) watches the whole suite for uncaught JS
 * exceptions or same-origin 5xx responses.
 */
test.describe('Service Providers > Warehouses Index', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let warehouses: WarehousesPage;
  let issues: PageIssue[];
  let activeCount = 0;
  let inactiveCount = 0;

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
    issues = attachPageHealthMonitor(page);

    const home = new HomePage(page);
    await home.gotoV2Home();
    await home.navigateToWarehouses();

    warehouses = new WarehousesPage(page);
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

  test('search bar finds a warehouse by company name', async () => {
    const row = await warehouses.findRowWithValue('company');
    await warehouses.search(row.company);
    expect(await warehouses.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(warehouses.rowsContaining(row.company).first()).toBeVisible();
  });

  test('search bar finds a warehouse by street address', async () => {
    const row = await warehouses.findRowWithValue('streetAddress');
    await warehouses.search(row.streetAddress);
    expect(await warehouses.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(warehouses.rowsContaining(row.streetAddress).first()).toBeVisible();
  });

  test('search bar finds a warehouse by contact name', async () => {
    const row = await warehouses.findRowWithValue('contactName');
    await warehouses.search(row.contactName);
    expect(await warehouses.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(warehouses.rowsContaining(row.contactName).first()).toBeVisible();
  });

  test('search bar finds a warehouse by email', async () => {
    const row = await warehouses.findRowWithValue('email');
    await warehouses.search(row.email);
    expect(await warehouses.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(warehouses.rowsContaining(row.email).first()).toBeVisible();
  });

  test('filters warehouses by status = Active', async () => {
    await warehouses.filterByStatus(['Active']);
    activeCount = await warehouses.getResultsCount();
    expect(activeCount).toBeGreaterThan(0);
  });

  test('filters warehouses by status = Inactive', async () => {
    await warehouses.filterByStatus(['Inactive']);
    inactiveCount = await warehouses.getResultsCount();
    expect(inactiveCount).toBeGreaterThanOrEqual(0);
  });

  test('filters warehouses by status = Active + Inactive', async () => {
    await warehouses.filterByStatus(['Active', 'Inactive']);
    const combinedCount = await warehouses.getResultsCount();
    expect(combinedCount).toBe(activeCount + inactiveCount);
  });

  test('combines a search term with a status filter', async () => {
    await warehouses.filterByStatus(['Active']);
    const baselineActiveCount = await warehouses.getResultsCount();
    const row = await warehouses.findRowWithValue('company');
    await warehouses.search(row.company);
    const narrowedCount = await warehouses.getResultsCount();
    expect(narrowedCount).toBeGreaterThanOrEqual(1);
    expect(narrowedCount).toBeLessThanOrEqual(baselineActiveCount);
    await expect(warehouses.rowsContaining(row.company).first()).toBeVisible();
  });

  test('downloads the warehouses list as CSV', async () => {
    const download = await warehouses.downloadCsv();
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const content = fs.readFileSync(filePath!, 'utf-8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
  });

  test('end to end: creates a warehouse and finds it via search', async () => {
    const data = buildFakeWarehouseData();
    await warehouses.createWarehouse(data);
    await expect(warehouses.successAlert.first()).toContainText('Warehouse created successfully.');

    await warehouses.resetToCleanState();
    await warehouses.search(data.companyName);
    const row = warehouses.rowsContaining(data.companyName).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(data.city);
    await expect(row).toContainText(data.contactName);
  });
});
