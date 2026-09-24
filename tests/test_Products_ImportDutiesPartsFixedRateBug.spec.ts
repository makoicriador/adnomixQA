import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { ProductsPage, buildFakeProductData } from '../pages/ProductsPage';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * Evidence capture for a confirmed live bug, scoped narrowly after further
 * verification (see .agent-memory/project_conventions.md's 2026-09-20
 * correction to the original 2026-09-19 "Products" computed-math entry):
 * in the Add/Edit Product drawer's "Import Duties & Parts" section, a
 * part's "Duty Rate" live preview is computed correctly while its Duty/
 * Tariff rate type is "Percentage", but stays at $0.00 in the drawer
 * whenever either is switched to "Fixed" and a value is entered. This is
 * a client-side, in-drawer LIVE PREVIEW glitch only — confirmed live that
 * actually saving and reloading the Product View page shows the correct
 * computed Duty Rate and Total, so the persisted data and its display are
 * both correct. This spec only asserts the pre-save preview state, which
 * is where the glitch actually lives — it is not a data-correctness bug.
 * Standalone, one-off evidence-capture spec (not part of the routine
 * suite), matching this repo's convention for known-bug repro specs (e.g.
 * the Suppliers City-blank crash).
 */
test.describe('Products > Import Duties & Parts > Fixed-rate Duty Rate live-preview glitch (bug repro)', () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let products: ProductsPage;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    test.setTimeout(60_000);

    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToAllProducts();
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
    await home.navigateToAllProducts();
    products = new ProductsPage(page);
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
  });

  test('a part\'s Fixed-rate Duty/Tariff live preview stays $0.00 while still editing (saved data is correct — see doc comment)', async () => {
    const data = buildFakeProductData();
    await products.openAddDrawer();

    const drawer = page.locator('#create-product-drawer');
    await drawer.locator('input[name="product_name"]').fill(data.productName);
    await drawer.locator('input[name="sku"]').fill(data.sku);
    // Supplier uses ProductsPage's own KTUI combobox mechanics.
    await drawer.locator('select[name="supplier_id[]"]').locator('xpath=following-sibling::div[@data-kt-select-wrapper]//*[@data-kt-select-display]').click();
    const supplierDropdown = page.locator('[data-kt-select-dropdown].open').first();
    await supplierDropdown.waitFor({ state: 'visible' });
    const supplierOption = supplierDropdown.getByRole('option', { name: data.supplier, exact: true });
    await supplierOption.scrollIntoViewIfNeeded();
    await supplierOption.click();

    await drawer.getByText('Packaging', { exact: true }).first().click();

    const importedExportedQ = drawer.getByText(/imported or exported/i).first();
    await importedExportedQ.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await drawer.locator('input[name="is_domestic"][value="y"]').click({ force: true });

    await drawer.locator('input[name="product_have_parts"][value="yes"]').click({ force: true });
    await drawer.getByRole('button', { name: 'Add Parts', exact: true }).click();

    await drawer.locator('input[name="part_name[0]"]').fill('QA Automation Part (Fixed Rate)');
    await drawer.locator('input[name="part_cost[0]"]').fill('30');
    await drawer.locator('select[name="duty_rate_type[0]"]').selectOption({ label: 'Fixed' });
    await drawer.locator('input[name="duty_fix_rate[0]"]').fill('4');
    await drawer.locator('select[name="part_tariff_type[0]"]').selectOption({ label: 'Fixed' });
    await drawer.locator('input[name="part_tariff_fix_rate[0]"]').fill('2');

    const dutyRateField = drawer.locator('input[name="part_duty_rate[0]"]');
    await dutyRateField.evaluate((el) => el.scrollIntoView({ block: 'center' }));

    // The glitch: the live preview should read 6.00 (the $4 + $2 fixed
    // amounts just entered) but silently shows 0.00 instead while still
    // editing — no error, no NaN. Confirmed separately (not asserted here)
    // that saving at this point and reloading the Product View page shows
    // the correct $6.00 Duty Rate and Total — the saved data is right, only
    // this in-drawer preview is wrong.
    await expect(dutyRateField).toHaveValue('0.00');

    if (isHeaded) await page.waitForTimeout(2_000);
  });
});
