import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { FreightForwardersPage, buildFakeFreightForwarderData } from '../pages/FreightForwardersPage';
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
 * End-to-end coverage for Service Providers > Freight Forwarders on
 * adxmanager.dev: search (by name/contact/location/email), the Status
 * filter (Active, Inactive, Active + Inactive, plus combining a filter with
 * a search), CSV export, and a full create -> add bank account -> search
 * round trip against a throwaway fixture this suite creates itself (so the
 * read-only assertions above it never depend on that fixture, and the real,
 * pre-existing freight forwarders are never mutated). A page-health monitor
 * (tests/utils/errorScraper.ts) watches the whole suite for uncaught JS
 * exceptions or same-origin 5xx responses.
 */
test.describe('Service Providers > Freight Forwarders Index', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let freightForwarders: FreightForwardersPage;
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
    await home.navigateToFreightForwarders();

    freightForwarders = new FreightForwardersPage(page);
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
    if (issues.length) console.warn(`[Page health] ${issues.length} issue(s) detected:\n${describeIssues(issues)}`);
    expect(issues, 'No uncaught JS exceptions or 5xx server errors should occur during this suite').toEqual([]);
  });

  test.beforeEach(async () => {
    await freightForwarders.resetToCleanState();
  });

  test('search bar finds a freight forwarder by company name', async () => {
    const row = await freightForwarders.findRowWithValue('company');
    await freightForwarders.search(row.company);
    expect(await freightForwarders.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(freightForwarders.rowsContaining(row.company).first()).toBeVisible();
  });

  test('search bar finds a freight forwarder by contact name', async () => {
    const row = await freightForwarders.findRowWithValue('contact');
    await freightForwarders.search(row.contact);
    expect(await freightForwarders.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(freightForwarders.rowsContaining(row.contact).first()).toBeVisible();
  });

  test('search bar finds a freight forwarder by location', async () => {
    const row = await freightForwarders.findRowWithValue('location');
    const citySegment = row.location.split(',')[0].trim();
    await freightForwarders.search(citySegment);
    expect(await freightForwarders.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(freightForwarders.rowsContaining(citySegment).first()).toBeVisible();
  });

  test('search bar finds a freight forwarder by email', async () => {
    const row = await freightForwarders.findRowWithValue('email');
    await freightForwarders.search(row.email);
    expect(await freightForwarders.getResultsCount()).toBeGreaterThanOrEqual(1);
    await expect(freightForwarders.rowsContaining(row.email).first()).toBeVisible();
  });

  test('filters freight forwarders by status = Active', async () => {
    await freightForwarders.filterByStatus(['Active']);
    activeCount = await freightForwarders.getResultsCount();
    expect(activeCount).toBeGreaterThan(0);
  });

  test('filters freight forwarders by status = Inactive', async () => {
    await freightForwarders.filterByStatus(['Inactive']);
    inactiveCount = await freightForwarders.getResultsCount();
    expect(inactiveCount).toBeGreaterThanOrEqual(0);
  });

  test('filters freight forwarders by status = Active + Inactive', async () => {
    await freightForwarders.filterByStatus(['Active', 'Inactive']);
    const combinedCount = await freightForwarders.getResultsCount();
    expect(combinedCount).toBe(activeCount + inactiveCount);
  });

  test('combines a search term with a status filter', async () => {
    await freightForwarders.filterByStatus(['Active']);
    const baselineActiveCount = await freightForwarders.getResultsCount();
    const row = await freightForwarders.findRowWithValue('company');
    await freightForwarders.search(row.company);
    const narrowedCount = await freightForwarders.getResultsCount();
    expect(narrowedCount).toBeGreaterThanOrEqual(1);
    expect(narrowedCount).toBeLessThanOrEqual(baselineActiveCount);
    await expect(freightForwarders.rowsContaining(row.company).first()).toBeVisible();
  });

  test('downloads the freight forwarders list as CSV', async () => {
    const download = await freightForwarders.downloadCsv();
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const content = fs.readFileSync(filePath!, 'utf-8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
  });

  test('end to end: creates a freight forwarder with a bank account and finds it via search', async () => {
    const data = buildFakeFreightForwarderData();

    // The Bank Accounts section lives inside the same Create drawer form
    // (confirmed live) — createFreightForwarder's optional `bankAccount`
    // adds it before the drawer's own Create button submits everything
    // together in one request.
    await freightForwarders.createFreightForwarder(data, { bankAccount: buildFakeBankAccountData() });
    await expect(freightForwarders.successAlert.first()).toContainText('Freight forwarder created successfully.');

    await freightForwarders.resetToCleanState();
    await freightForwarders.search(data.companyName);
    const row = freightForwarders.rowsContaining(data.companyName).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(`${data.city}, ${data.country}`);
  });
});
