import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { SuppliersPage, buildFakeSupplierData } from '../pages/SuppliersPage';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * Evidence capture for a confirmed live bug (see .agent-memory/project_conventions.md,
 * 2026-09-19 Suppliers field-round-trip entry): City, State, and Country are
 * saved correctly on create (visible in Edit, and in the index's "Location"
 * column) but never rendered as visible text anywhere on the supplier's own
 * detail page. Standalone evidence-capture spec, not part of the routine
 * suite — same convention as the existing City-blank-crash repro specs.
 */
test.describe('Service Providers > Suppliers > Detail page never shows City/State/Country (bug repro)', () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let suppliers: SuppliersPage;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    test.setTimeout(60_000);

    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToSuppliers();
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
    await home.navigateToSuppliers();
    suppliers = new SuppliersPage(page);
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
  });

  test("a new supplier's City/State/Country never appear on its own detail page", async () => {
    const data = buildFakeSupplierData();
    await suppliers.createSupplier(data);
    await expect(suppliers.successAlert.first()).toContainText('Supplier created successfully.');

    // Suppliers stays on the index after create (confirmed live) — navigate
    // into the new record's own detail page via its row link.
    await suppliers.search(data.companyName);
    const row = suppliers.rowsContaining(data.companyName).first();
    await Promise.all([
      page.waitForURL(/\/service-providers\/suppliers\/[^/]+$/, { timeout: 15_000 }),
      row.locator('td').first().locator('a').first().click(),
    ]);

    const detail = page.locator('main#content');
    await expect(page.getByRole('heading', { name: data.companyName, exact: true })).toBeVisible();

    // The bug: city/state/country are nowhere VISIBLE on the detail page,
    // even though the record was created with them (they show fine in the
    // index's "Location" column). Using `innerText` (not `textContent`) so
    // this only fails if a user could actually see the text — the values do
    // technically sit in the DOM as the hidden Edit drawer's own input
    // `value="..."` attributes, but that never counts as `innerText`.
    const visibleText = await detail.innerText();
    expect(visibleText).not.toContain(data.city);
    expect(visibleText).not.toContain(data.state);

    if (isHeaded) await page.waitForTimeout(2_000);
  });
});
