import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { ProductsPage, buildFakeProductData } from '../pages/ProductsPage';
import { attachPageHealthMonitor, describeIssues, PageIssue } from './utils/errorScraper';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Products > All Products > Add Product on
 * adxmanager.dev: a happy-path creation with FakeFiller-style random data
 * (@faker-js/faker, see ProductsPage.buildFakeProductData), and a negative
 * path for each of the only three fields confirmed live to actually be
 * required server-side (Product Name, SKU, Select Supplier) — discovered by
 * submitting the drawer fully blank and reading back the exact validation
 * messages, rather than assumed from the UI's own (sparser) "*" markers.
 * The drawer itself is far larger than any Service Providers section's
 * (Target stock levels, Specifications, Fulfillment/3PL, Import Duties &
 * Parts, Regulatory Requirements) — see ProductsPage's doc comment for the
 * full list of quirks confirmed live. One authenticated session is shared
 * across the suite (serial mode) since login is a real network round trip
 * against a live app.
 */
test.describe('Products > All Products Create', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let products: ProductsPage;
  let issues: PageIssue[];

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    // describe.configure({ timeout }) only applies to test bodies, not hooks —
    // beforeAll needs its own timeout extended explicitly for the real login
    // + navigation round trip against the live app.
    test.setTimeout(60_000);

    // Step 1-2: log in and navigate to All Products (login -> /home ->
    // /v2/home -> sidebar) inside a throwaway, unrecorded context — the
    // request is to start the recording once we reach /v2/home, not during
    // login.
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToAllProducts();
    const storageState = await authContext.storageState();
    await authContext.close();

    // Step 3-4: a fresh, already-authenticated context/page — recording (if
    // headed) starts here, from the very first navigation to /v2/home, then
    // the same sidebar path into All Products as the throwaway context
    // above so the recorded run shows the whole real navigation, not just
    // the destination page.
    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();
    issues = attachPageHealthMonitor(page);

    const home = new HomePage(page);
    await home.gotoV2Home();
    await home.navigateToAllProducts();

    products = new ProductsPage(page);
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
    if (issues.length) console.warn(`[Page health] ${issues.length} issue(s) detected:\n${describeIssues(issues)}`);
    expect(issues, 'No uncaught JS exceptions or 5xx server errors should occur during this suite').toEqual([]);
  });

  test.beforeEach(async () => {
    await products.resetToCleanState();
  });

  test('creates a new product with all required fields filled', async () => {
    const data = buildFakeProductData();

    await products.createProduct(data);
    // Verified live: on success the app redirects to the new product's own
    // detail page, and the success banner renders there (same duplicate
    // desktop/mobile markup pattern documented elsewhere in this app) —
    // `.first()` rather than assuming a single match.
    await expect(products.successAlert.first()).toContainText('Product created successfully.');
    await expect(page.getByRole('heading', { name: data.productName, exact: true })).toBeVisible();

    await products.resetToCleanState();
    await products.search(data.productName);
    const row = products.rowsContaining(data.productName).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(data.sku);
  });

  test('shows a validation error when Product Name is left blank', async () => {
    const { productName, ...withoutProductName } = buildFakeProductData();
    void productName;

    await products.submitCreateDrawer(withoutProductName);
    await expect(products.errorAlert.first()).toContainText('The product name field is required.');
  });

  test('shows a validation error when SKU is left blank', async () => {
    const { sku, ...withoutSku } = buildFakeProductData();
    void sku;

    await products.submitCreateDrawer(withoutSku);
    await expect(products.errorAlert.first()).toContainText('The sku field is required.');
  });

  test('shows a validation error when Select Supplier is left blank', async () => {
    const { supplier, ...withoutSupplier } = buildFakeProductData();
    void supplier;

    await products.submitCreateDrawer(withoutSupplier);
    await expect(products.errorAlert.first()).toContainText('The supplier id field is required.');
  });
});
