import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { CustomsBrokersPage, buildFakeCustomsBrokerData } from '../pages/CustomsBrokersPage';
import { attachPageHealthMonitor, describeIssues, PageIssue } from './utils/errorScraper';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Service Providers > Customs Brokers > Deactivate
 * on adxmanager.dev. Like Suppliers, Customs Brokers' kebab menu has no
 * hard "Delete" action at all — only a "Deactivate" status toggle
 * (confirmed live) — so this suite exercises that toggle (and its
 * "Activate" reverse) instead of a delete flow. Each test creates its own
 * throwaway fixture so the real, pre-existing customs brokers used by the
 * Index suite are never touched. One authenticated session is shared
 * across the suite (serial mode) since login is a real network round trip
 * against a live app.
 */
test.describe('Service Providers > Customs Brokers Deactivate', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let customsBrokers: CustomsBrokersPage;
  let issues: PageIssue[];

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    // describe.configure({ timeout }) only applies to test bodies, not hooks —
    // beforeAll needs its own timeout extended explicitly for the real login
    // + navigation round trip against the live app.
    test.setTimeout(60_000);

    // Step 1-2: log in and navigate to Customs Brokers (login -> /home ->
    // /v2/home -> sidebar) inside a throwaway, unrecorded context — the
    // request is to start the recording once we reach /v2/home, not during
    // login.
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToCustomsBrokers();
    const storageState = await authContext.storageState();
    await authContext.close();

    // Step 3-4: a fresh, already-authenticated context/page — recording (if
    // headed) starts here, from the very first navigation to /v2/home, then
    // the same sidebar path into Customs Brokers as the throwaway context
    // above so the recorded run shows the whole real navigation.
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

  test('deactivates a customs broker and removes it from the default (Active) index view', async () => {
    const fixture = buildFakeCustomsBrokerData({ companyName: `QA Automation Deactivate Fixture ${Date.now()}` });
    await customsBrokers.createCustomsBroker(fixture);
    await expect(customsBrokers.successAlert.first()).toContainText('Customs broker created successfully.');

    await customsBrokers.resetToCleanState();
    await customsBrokers.search(fixture.companyName);
    await expect(customsBrokers.rowsContaining(fixture.companyName).first()).toBeVisible();

    await customsBrokers.deactivateFor(fixture.companyName);

    // Verified live: unlike Suppliers, this stays on the plain index URL
    // (no redirect to a detail page) — the success banner renders there.
    await expect(page).toHaveURL(/\/service-providers\/customs-brokers$/);
    await expect(customsBrokers.successAlert.first()).toContainText('Successfully deactivated the customs broker.');

    // Confirm it disappeared from the default index view, which only shows
    // Active customs brokers by default (confirmed live) — asserted via
    // the "No customs brokers found" empty state rather than a
    // `rowsContaining` row count, since that empty state itself renders
    // inside a `<tr>` echoing the searched company name back, which would
    // otherwise false-positive as a "found" row.
    await customsBrokers.resetToCleanState();
    await customsBrokers.search(fixture.companyName);
    await expect(page.getByText(/No customs brokers found/i)).toBeVisible();

    // Only the Filter drawer's "Inactive" toggle surfaces it again.
    await customsBrokers.resetToCleanState();
    await customsBrokers.filterByStatus(['Inactive']);
    await customsBrokers.search(fixture.companyName);
    await expect(customsBrokers.rowsContaining(fixture.companyName).first()).toBeVisible();
  });

  test('reactivating a deactivated customs broker restores it to the default index view', async () => {
    const fixture = buildFakeCustomsBrokerData({ companyName: `QA Automation Reactivate Fixture ${Date.now()}` });
    await customsBrokers.createCustomsBroker(fixture);
    await expect(customsBrokers.successAlert.first()).toContainText('Customs broker created successfully.');

    await customsBrokers.resetToCleanState();
    await customsBrokers.search(fixture.companyName);
    await customsBrokers.deactivateFor(fixture.companyName);
    await expect(customsBrokers.successAlert.first()).toContainText('Successfully deactivated the customs broker.');

    await customsBrokers.resetToCleanState();
    await customsBrokers.filterByStatus(['Inactive']);
    await customsBrokers.search(fixture.companyName);
    await expect(customsBrokers.rowsContaining(fixture.companyName).first()).toBeVisible();

    await customsBrokers.activateFor(fixture.companyName);

    // Verified live: same as Deactivate, stays on the plain index URL.
    await expect(page).toHaveURL(/\/service-providers\/customs-brokers$/);
    await expect(customsBrokers.successAlert.first()).toContainText('Successfully activated the customs broker.');

    await customsBrokers.resetToCleanState();
    await customsBrokers.search(fixture.companyName);
    await expect(customsBrokers.rowsContaining(fixture.companyName).first()).toBeVisible();
  });
});
