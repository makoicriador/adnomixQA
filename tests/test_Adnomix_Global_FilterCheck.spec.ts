import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { GlobalFilterDrawer } from '../pages/GlobalFilterDrawer';
import { FILTER_PAGES } from './utils/globalFilterPages';
import { attachPageHealthMonitor, describeIssues, PageIssue } from './utils/errorScraper';

const BASE_URL = process.env.ADX_BASE_URL || 'https://adxmanager.dev';
const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

/**
 * Site-wide UI + functional coverage of the "Filter" button/drawer
 * component: every page reachable from https://adxmanager.dev/v2/home that
 * exposes a `[data-kt-drawer-toggle$="-index-drawer"]` Filter button (the
 * same mechanism as the Dashboard's own
 * `data-kt-drawer-toggle="#form-dashboard-index-drawer"`), discovered by
 * crawling the full sidebar rather than assuming it's limited to Service
 * Providers — see `tests/utils/globalFilterPages.ts` for the full list (24
 * pages) and the pages confirmed to have none.
 *
 * Each page gets the same three checks, since this suite tests the shared
 * Filter *mechanism* rather than any one page's business filtering logic
 * (several Service Providers pages already have deeper, page-specific
 * filter coverage elsewhere):
 *  1. UI + functional: the button opens the drawer, applying the page's
 *     first real filter control updates the URL with that filter, and
 *     Reset clears it again.
 *  2. Negative: closing the drawer without clicking "Update" never applies
 *     the picked option (no silent side effect from just opening it).
 *  3. Negative: an unexpected filter value injected directly via the URL
 *     does not crash the page (no unhandled 500, no raw exception text).
 *
 * One login is shared across the whole file (a fresh `storageState`, not a
 * shared browser context) so each page's tests still run in their own
 * isolated context and can run in parallel across workers. A page-health
 * monitor (tests/utils/errorScraper.ts) watches every test for uncaught JS
 * exceptions or same-origin 5xx responses.
 */
test.describe('Adnomix Global Filter Check', () => {
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let storageState: Awaited<ReturnType<BrowserContext['storageState']>>;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    test.setTimeout(30_000);

    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    storageState = await authContext.storageState();
    await authContext.close();
  });

  for (const config of FILTER_PAGES) {
    test.describe(config.name, () => {
      test.describe.configure({ timeout: 45_000 });

      let context: BrowserContext;
      let page: Page;
      let issues: PageIssue[];
      let filter: GlobalFilterDrawer;

      test.beforeEach(async ({ browser }) => {
        test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
        context = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
        page = await context.newPage();
        issues = attachPageHealthMonitor(page);
        filter = new GlobalFilterDrawer(page, config.drawerId);

        await page.goto(`${BASE_URL}${config.path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      });

      test.afterEach(async () => {
        if (issues.length) console.warn(`[Page health] ${config.name}: ${issues.length} issue(s):\n${describeIssues(issues)}`);
        expect(issues, `No uncaught JS exceptions or 5xx server errors on ${config.name}`).toEqual([]);
        await context?.close();
      });

      test('Filter button opens the drawer, applies a filter, and Reset clears it', async () => {
        await expect(filter.toggleButton).toBeVisible();
        await filter.open();
        await expect(filter.drawer).toBeVisible();

        await filter.pickConfiguredOption(config);
        await filter.submit();

        const appliedUrl = new URL(page.url());
        expect(appliedUrl.searchParams.getAll(config.paramName)).toContain(config.optionValue);

        await filter.open();
        await filter.clickReset();

        const resetUrl = new URL(page.url());
        // Reset's own target isn't always the bare URL (e.g. Order Payments
        // resets to its own default-filtered view, not "no filter" — see
        // project_conventions.md) — the one thing every page's Reset must
        // do is actually clear the specific value this test just applied.
        expect(resetUrl.searchParams.getAll(config.paramName)).not.toContain(config.optionValue);
      });

      test('closing the drawer without clicking Update does not apply the filter', async () => {
        const urlBefore = page.url();

        await filter.open();
        await filter.pickConfiguredOption(config);
        await filter.close();

        expect(page.url()).toBe(urlBefore);
      });

      test('an unexpected filter value in the URL does not crash the page', async () => {
        const bogusUrl = `${BASE_URL}${config.path}?${encodeURIComponent(config.paramName)}=__qa_bogus_value__`;
        await page.goto(bogusUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

        const bodyText = await page.locator('body').innerText();
        expect(/internal server error|exception|stack trace|sqlstate/i.test(bodyText)).toBe(false);
      });
    });
  }
});
