import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { ProductsPage, buildFakeProductData } from '../pages/ProductsPage';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * Evidence capture for a confirmed live bug (see .agent-memory/project_conventions.md,
 * 2026-09-19 Products field-round-trip entry): "SKU Aliases" and "Barcode"
 * save correctly (both pre-fill correctly when the Edit drawer is reopened)
 * but are never rendered anywhere on the product's own detail page.
 * Standalone evidence-capture spec, not part of the routine suite.
 */
test.describe('Products > Detail page never shows SKU Aliases / Barcode (bug repro)', () => {
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

  test("a new product's SKU Aliases and Barcode never appear on its own detail page", async () => {
    const stamp = Date.now();
    const data = buildFakeProductData({
      skuAliases: `QA-ALIAS-${stamp}`,
      barcode: '012345678905',
    });
    await products.createProduct(data);
    await expect(products.successAlert.first()).toContainText('Product created successfully.');
    await expect(page.getByRole('heading', { name: data.productName, exact: true })).toBeVisible();

    const detail = page.locator('main#content');

    // The bug: both fields were filled on create, but neither renders as
    // VISIBLE text on the detail page (confirmed correctly saved server-side
    // by re-opening the Edit drawer, done separately during investigation).
    // `innerText` (not `textContent`) so a value merely sitting in a hidden
    // Edit-drawer input/textarea can't produce a false pass here.
    const visibleText = await detail.innerText();
    expect(visibleText).not.toContain(data.skuAliases!);
    expect(visibleText).not.toContain(data.barcode!);

    if (isHeaded) await page.waitForTimeout(2_000);
  });
});
