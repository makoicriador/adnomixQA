import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { CustomsBrokersPage, buildFakeCustomsBrokerData } from '../pages/CustomsBrokersPage';
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
 * End-to-end coverage for Service Providers > Customs Brokers on
 * adxmanager.dev: search (by name/contact/location/email), the Status
 * filter (Active, Inactive, Active + Inactive, plus combining a filter with
 * a search), CSV export, and a full create -> add bank account -> search
 * round trip against a throwaway fixture this suite creates itself (so the
 * read-only assertions above it never depend on that fixture, and the real,
 * pre-existing customs brokers are never mutated). A page-health monitor
 * (tests/utils/errorScraper.ts) watches the whole suite for uncaught JS
 * exceptions or same-origin 5xx responses.
 */
test.describe('Service Providers > Customs Brokers Index', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let customsBrokers: CustomsBrokersPage;
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
    await home.navigateToCustomsBrokers();

    customsBrokers = new CustomsBrokersPage(page);
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
    if (issues.length) console.warn(`[Page health] ${issues.length} issue(s) detected:\n${describeIssues(issues)}`);
    expect(issues, 'No uncaught JS exceptions or 5xx server errors should occur during this suite').toEqual([]);
  });

  test.beforeEach(async () => {
    await customsBrokers.resetToCleanState();
  });

  test('search bar finds a customs broker by company name', async () => {
    const row = await customsBrokers.findRowWithValue('company');
    await customsBrokers.search(row.company);
    expect(await customsBrokers.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(customsBrokers.rowsContaining(row.company).first()).toBeVisible();
  });

  test('search bar finds a customs broker by contact name', async () => {
    const row = await customsBrokers.findRowWithValue('contact');
    await customsBrokers.search(row.contact);
    expect(await customsBrokers.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(customsBrokers.rowsContaining(row.contact).first()).toBeVisible();
  });

  test('search bar finds a customs broker by location', async () => {
    const row = await customsBrokers.findRowWithValue('location');
    const citySegment = row.location.split(',')[0].trim();
    await customsBrokers.search(citySegment);
    expect(await customsBrokers.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(customsBrokers.rowsContaining(citySegment).first()).toBeVisible();
  });

  test('search bar finds a customs broker by email', async () => {
    const row = await customsBrokers.findRowWithValue('email');
    await customsBrokers.search(row.email);
    expect(await customsBrokers.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(customsBrokers.rowsContaining(row.email).first()).toBeVisible();
  });

  test('filters customs brokers by status = Active', async () => {
    await customsBrokers.filterByStatus(['Active']);
    activeCount = await customsBrokers.getResultsCount();
    expect(activeCount).toBeGreaterThan(0);
  });

  test('filters customs brokers by status = Inactive', async () => {
    await customsBrokers.filterByStatus(['Inactive']);
    inactiveCount = await customsBrokers.getResultsCount();
    expect(inactiveCount).toBeGreaterThanOrEqual(0);
  });

  test('filters customs brokers by status = Active + Inactive', async () => {
    await customsBrokers.filterByStatus(['Active', 'Inactive']);
    const combinedCount = await customsBrokers.getResultsCount();
    expect(combinedCount).toBe(activeCount + inactiveCount);
  });

  test('combines a search term with a status filter', async () => {
    await customsBrokers.filterByStatus(['Active']);
    const baselineActiveCount = await customsBrokers.getResultsCount();
    const row = await customsBrokers.findRowWithValue('company');
    await customsBrokers.search(row.company);
    const narrowedCount = await customsBrokers.getResultsCount();
    expect(narrowedCount).toBeGreaterThanOrEqual(1);
    expect(narrowedCount).toBeLessThanOrEqual(baselineActiveCount);
    await expect(customsBrokers.rowsContaining(row.company).first()).toBeVisible();
  });

  test('downloads the customs brokers list as CSV', async () => {
    const download = await customsBrokers.downloadCsv();
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const content = fs.readFileSync(filePath!, 'utf-8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
  });

  test('end to end: creates a customs broker with a bank account and finds it via search', async () => {
    const data = buildFakeCustomsBrokerData();

    // The Bank Accounts section lives inside the same Create drawer form
    // (confirmed live) — createCustomsBroker's optional `bankAccount` adds
    // it before the drawer's own Create button submits everything together
    // in one request.
    await customsBrokers.createCustomsBroker(data, { bankAccount: buildFakeBankAccountData() });
    await expect(customsBrokers.successAlert.first()).toContainText('Customs broker created successfully.');

    await customsBrokers.resetToCleanState();
    await customsBrokers.search(data.companyName);
    const row = customsBrokers.rowsContaining(data.companyName).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(`${data.city}, ${data.state}, ${data.country}`);
  });
});
