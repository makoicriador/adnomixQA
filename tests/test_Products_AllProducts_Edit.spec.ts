import { test, expect, Page, BrowserContext } from '@playwright/test';
import { faker } from '@faker-js/faker';
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
 * End-to-end coverage for Products > All Products > Edit Product on
 * adxmanager.dev. The suite creates its own throwaway product as a fixture
 * (rather than editing one of the real, pre-existing products used by the
 * Index suite) and edits that one across scenarios: its pricing/description,
 * then its supplier, then a required-field negative path. Unlike Suppliers/
 * Warehouses, "Edit" here lives directly on the product's own detail page
 * (opened via ProductsPage.openEditFor) rather than a separate "/edit"
 * route — a successful Save Changes re-renders the same URL, confirmed
 * live. One authenticated session is shared across the suite (serial mode,
 * and the tests intentionally build on each other's state) since login is a
 * real network round trip against a live app.
 */
test.describe('Products > All Products Edit', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let products: ProductsPage;
  let issues: PageIssue[];
  let currentProductName: string;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    // describe.configure({ timeout }) only applies to test bodies, not hooks —
    // beforeAll needs its own timeout extended explicitly for the real login
    // + navigation round trip against the live app, plus the fixture create.
    test.setTimeout(90_000);

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
    await home.navigateToAllProducts();

    products = new ProductsPage(page);

    // Fixture: a throwaway product this suite edits, so it never mutates
    // one of the real products the Index suite reads. Deliberately does not
    // contain the word "Edit" — a company/product name containing that word
    // would risk future collisions with any icon-glyph-prefixed "Edit"
    // control matched by substring elsewhere in this app.
    const fixture = buildFakeProductData({ productName: `QA Automation Fixture ${Date.now()}` });
    await products.createProduct(fixture);
    await expect(products.successAlert.first()).toContainText('Product created successfully.');
    currentProductName = fixture.productName;
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

  test("updates a product's pricing and description", async () => {
    const updated = {
      retailPrice: '49.99',
      manufacturingPrice: '5.50',
      description: faker.commerce.productDescription(),
    };

    await products.openEditFor(currentProductName);
    await products.saveEdit(updated);

    // Verified against the live app: unlike Suppliers/Warehouses (where a
    // successful save navigates ".../<id>/edit" -> ".../<id>"), this Edit
    // drawer lives directly on the detail page — the URL never changes, the
    // drawer just closes and the page re-renders with the new values.
    await expect(products.successAlert.first()).toContainText('Product updated successfully.');
    const detail = page.locator('main#content');
    await expect(detail).toContainText('$49.99');
    await expect(detail).toContainText(updated.description);
  });

  test("updates a product's name and supplier", async () => {
    const newProductName = `${currentProductName} (Edited)`;

    await products.openEditFor(currentProductName);
    await products.saveEdit({ productName: newProductName, supplier: 'Shanghai Bluetech Co., Ltd.' });

    await expect(products.successAlert.first()).toContainText('Product updated successfully.');
    await expect(page.getByRole('heading', { name: newProductName, exact: true })).toBeVisible();
    await expect(page.getByText('Supplier: Shanghai Bluetech Co., Ltd.')).toBeVisible();
    currentProductName = newProductName;

    // Confirm the index list (not just the detail page) reflects the rename.
    await products.resetToCleanState();
    await products.search(newProductName);
    await expect(products.rowsContaining(newProductName).first()).toBeVisible();
  });

  test('shows a validation error when Product Name is cleared', async () => {
    // Verified against the live app: clearing the required Product Name
    // field and saving fails gracefully — "The product name field is
    // required." — and, importantly, does not blank out the product's
    // existing name.
    await products.openEditFor(currentProductName);
    await products.saveEdit({ productName: '' });
    await expect(products.errorAlert.first()).toContainText('The product name field is required.');

    await products.resetToCleanState();
    await products.search(currentProductName);
    await expect(products.rowsContaining(currentProductName).first()).toBeVisible();
  });
});
