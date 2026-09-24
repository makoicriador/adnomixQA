import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { FreightForwardersPage, buildFakeFreightForwarderData } from '../pages/FreightForwardersPage';
import { attachPageHealthMonitor, describeIssues, PageIssue } from './utils/errorScraper';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Service Providers > Freight Forwarders > Delete
 * on adxmanager.dev. Each test creates its own throwaway fixture so the
 * real, pre-existing freight forwarders used by the Index suite are never
 * touched. Confirmed live and documented in FreightForwardersPage's doc
 * comment: unlike Suppliers/Customs Brokers (which only offer a
 * "Deactivate" status toggle from their kebab menu), Freight Forwarders'
 * kebab has a hard "Delete" button behind a native `confirm()` dialog. One
 * authenticated session is shared across the suite (serial mode) since
 * login is a real network round trip against a live app.
 */
test.describe('Service Providers > Freight Forwarders Delete', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let freightForwarders: FreightForwardersPage;
  let issues: PageIssue[];

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    // describe.configure({ timeout }) only applies to test bodies, not hooks —
    // beforeAll needs its own timeout extended explicitly for the real login
    // + navigation round trip against the live app.
    test.setTimeout(60_000);

    // Step 1-2: log in and navigate to Freight Forwarders (login -> /home ->
    // /v2/home -> sidebar) inside a throwaway, unrecorded context — the
    // request is to start the recording once we reach /v2/home, not during
    // login.
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToFreightForwarders();
    const storageState = await authContext.storageState();
    await authContext.close();

    // Step 3-4: a fresh, already-authenticated context/page — recording (if
    // headed) starts here, from the very first navigation to /v2/home, then
    // the same sidebar path into Freight Forwarders as the throwaway context
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

  test('deletes a freight forwarder and removes it from the default index search', async () => {
    const fixture = buildFakeFreightForwarderData({ companyName: `QA Automation Delete Fixture ${Date.now()}` });
    await freightForwarders.createFreightForwarder(fixture);
    await expect(freightForwarders.successAlert.first()).toContainText('Freight forwarder created successfully.');
    // Verified live (see FreightForwardersPage doc comment): a successful
    // create redirects straight to the new record's own detail page.
    const detailUrl = page.url();

    await freightForwarders.resetToCleanState();
    await freightForwarders.search(fixture.companyName);
    await expect(freightForwarders.rowsContaining(fixture.companyName).first()).toBeVisible();

    await freightForwarders.deleteFor(fixture.companyName);

    // Verified live: redirects to the plain (unfiltered) index with a
    // success banner.
    await expect(page).toHaveURL(/\/service-providers\/freight-forwarders$/);
    await expect(freightForwarders.successAlert.first()).toContainText('Freight forwarder deleted successfully.');

    // Confirm it actually disappeared from the default search. Asserting
    // on the "No freight forwarders found" empty state rather than a
    // `rowsContaining` row count — that empty state itself renders inside a
    // `<tr>` echoing the searched company name back, which would otherwise
    // false-positive as a "found" row.
    await freightForwarders.resetToCleanState();
    await freightForwarders.search(fixture.companyName);
    await expect(page.getByText(/No freight forwarders found/i)).toBeVisible();

    // Documents a genuine quirk confirmed live, distinct from Products' own
    // soft delete: the record's detail page is still reachable at the same
    // URL (HTTP 200, not a 404) with the exact pre-delete data intact —
    // status still "Active", Edit/Delete buttons still present — and with
    // no "Deleted" indicator anywhere, unlike Products' "Deleted" badge.
    const response = await page.goto(detailUrl);
    expect(response?.status()).toBe(200);
    await expect(page.getByText(fixture.companyName).first()).toBeVisible();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  });

  test('dismissing the confirmation dialog leaves the freight forwarder untouched', async () => {
    const fixture = buildFakeFreightForwarderData({ companyName: `QA Automation Cancel Delete Fixture ${Date.now()}` });
    await freightForwarders.createFreightForwarder(fixture);
    await expect(freightForwarders.successAlert.first()).toContainText('Freight forwarder created successfully.');

    await freightForwarders.resetToCleanState();
    await freightForwarders.search(fixture.companyName);
    const indexUrl = page.url();

    await freightForwarders.cancelDeleteFor(fixture.companyName);

    // Verified live: dismissing the native confirm() leaves the page
    // exactly where it was — no navigation, no deletion.
    await expect(page).toHaveURL(indexUrl);
    await expect(freightForwarders.rowsContaining(fixture.companyName).first()).toBeVisible();

    await freightForwarders.resetToCleanState();
    await freightForwarders.search(fixture.companyName);
    await expect(freightForwarders.rowsContaining(fixture.companyName).first()).toBeVisible();
  });
});
