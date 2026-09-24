import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { CustomsBrokersPage, buildFakeCustomsBrokerData } from '../pages/CustomsBrokersPage';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * Evidence capture for a confirmed live bug (see .agent-memory/project_conventions.md,
 * 2026-09-19 Suppliers/FF/CB field-round-trip entry): "Customs Notes" is
 * saved correctly (visible again when re-opening the Edit drawer) but never
 * rendered anywhere on the customs broker's own detail page — absent even
 * from the page's raw HTML, not just an off-screen/invisible-text gap.
 * Standalone evidence-capture spec, not part of the routine suite.
 */
test.describe('Service Providers > Customs Brokers > Detail page never shows Customs Notes (bug repro)', () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let customsBrokers: CustomsBrokersPage;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    test.setTimeout(60_000);

    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToCustomsBrokers();
    const storageState = await authContext.storageState();
    await authContext.close();

    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();

    const home = new HomePage(page);
    await home.gotoV2Home();
    await home.navigateToCustomsBrokers();
    customsBrokers = new CustomsBrokersPage(page);
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
  });

  test("a new customs broker's Customs Notes never appear on its own detail page", async () => {
    const data = buildFakeCustomsBrokerData();
    await customsBrokers.createCustomsBroker(data);
    await expect(customsBrokers.successAlert.first()).toContainText('Customs broker created successfully.');

    await customsBrokers.search(data.companyName);
    const row = customsBrokers.rowsContaining(data.companyName).first();
    await Promise.all([
      page.waitForURL(/\/service-providers\/customs-brokers\/[^/]+$/, { timeout: 15_000 }),
      row.locator('td').first().locator('a').first().click(),
    ]);

    const detail = page.locator('main#content');
    await expect(page.getByRole('heading', { name: data.companyName, exact: true })).toBeVisible();

    // The bug: Customs Notes was set on create, but it never renders as
    // VISIBLE text on this detail page. The value does exist in the raw DOM
    // (server-rendered inline inside the hidden Edit drawer's own
    // `#customs_notes_edit` textarea) — a plain `toContainText`/`textContent`
    // check would find it there and false-negative, so this checks
    // `innerText` instead, which (unlike `textContent`) excludes hidden
    // elements and reflects what a user actually sees on screen.
    const visibleText = await detail.innerText();
    expect(visibleText).not.toContain(data.customsNotes!);

    if (isHeaded) await page.waitForTimeout(2_000);
  });
});
