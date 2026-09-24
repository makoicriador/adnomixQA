import { Page, Locator, Download } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { BasePage } from './BasePage';

const BASE_URL = process.env.ADX_BASE_URL || 'https://adxmanager.dev';

/** The checkbox's `value` attribute — NOT the visible label. See ProductsPage doc comment. */
export type ProductStatus = 'Active' | 'Inactive';

export interface ProductRow {
  name: string;
  sku: string;
  retailPrice: string;
}

/** Fields for the Add Product / Edit Product drawers. All optional so a caller can submit a deliberately incomplete form. */
export interface ProductFormData {
  productName: string;
  brand?: string;
  supplier: string;
  sku: string;
  skuAliases?: string;
  barcode?: string;
  listPrice?: string;
  retailPrice?: string;
  manufacturingPrice?: string;
  category?: string;
  description?: string;
}

/**
 * FakeFiller-style random data (backed by @faker-js/faker). `supplier`
 * defaults to "Xiamen Rainshower Co., Ltd" — confirmed live to exist in the
 * real (non-QA-fixture) Suppliers list backing this dropdown, so it never
 * collides with throwaway "QA Automation Fixture ..." suppliers created by
 * the Service Providers > Suppliers suites, which also populate this same
 * list and could otherwise be renamed/deleted out from under this suite.
 */
export function buildFakeProductData(overrides: Partial<ProductFormData> = {}): ProductFormData {
  const stamp = Date.now();
  return {
    productName: `QA Automation Product ${stamp}`,
    supplier: 'Xiamen Rainshower Co., Ltd',
    sku: `QA-${stamp}`,
    listPrice: '19.99',
    retailPrice: '29.99',
    ...overrides,
  };
}

/**
 * https://adxmanager.dev/v2/products ("Products" > "All Products")
 *
 * Confirmed live, independently of every other section (see
 * project_conventions.md — each Service Providers/Products section has its
 * own genuine quirks, never assumed from a sibling):
 *  - The sidebar accordion is labelled "Products" (not "All Products") and
 *    needs the same non-anchored substring regex used elsewhere in this app
 *    — see HomePage.navigateToAllProducts's doc comment for why an anchored
 *    exact match silently no-ops here.
 *  - "Add Product"/"Edit Product" is a MUCH larger drawer than any Service
 *    Providers section: Product Details, Target stock levels (days),
 *    Specifications, Fulfillment/3PL (with per-marketplace Amazon/Walmart/
 *    Flexport sub-tabs), Import Duties & Parts, Regulatory Requirements.
 *    Only 3 fields are actually required server-side: Product Name, SKU,
 *    and Select Supplier — confirmed by submitting a fully blank form and
 *    reading back the exact validation messages (see submitCreateDrawer).
 *  - "List Price"/"Retail Price" (`list_price`/`sales_price`) each render
 *    THREE times in the same drawer (Product Details, plus the Amazon and
 *    Walmart Fulfillment/3PL sub-tabs all share one Alpine `x-model`) —
 *    `.first()` rather than assuming a single match, the same duplicate-
 *    markup discipline already needed elsewhere in this app.
 *  - "Select Supplier" is a KTUI multi-select (`select[name="supplier_id[]"]`)
 *    backed by ~37 real suppliers with NO search box (unlike Country
 *    elsewhere) — its dropdown option list is taller than the drawer's own
 *    viewport, so `option.scrollIntoViewIfNeeded()` is required before
 *    `.click()` or Playwright's actionability check times out waiting for
 *    the (already-`display:block`) option to be "stable" on screen.
 *  - Submitting a SKU that already belongs to another product crashes with
 *    an unhandled 500 (`POST /v2/products`) instead of a graceful "SKU has
 *    already been taken" validation message — the same class of bug as the
 *    Suppliers blank-City crash documented in project_conventions.md. Not
 *    exercised by this suite's happy/negative paths for the same reason
 *    that bug's own repro is kept in a standalone, unmonitored spec: baking
 *    a known crash into the routine suite would make it "expected".
 *  - "Delete" is a SOFT delete, not a hard delete or a Deactivate-style
 *    status toggle: the record's detail page keeps rendering at the same
 *    URL afterward (HTTP 200, all data intact, "Deleted" badge shown,
 *    Edit/Delete/Copy still present) — it never 404s. It disappears only
 *    from the index's default listing and search; the Filter drawer's
 *    Status options are only Active/Discontinued ("Discontinued" is
 *    `filters[product_status][]=Inactive` — the value attribute, not the
 *    label), with no way to filter/list "Deleted" items at all from the UI.
 *  - The detail page's own "Delete" button is a plain, disabled-when-the-
 *    product-has-history button gated behind a native `window.confirm()`.
 *    An index row's kebab-menu "Delete", despite looking identical, is a
 *    completely different implementation: it has no disabled/history guard
 *    at all, and instead of a native dialog it does `$dispatch('confirm-
 *    product-delete', { name, action })`, caught by a `@confirm-product-
 *    delete.window` listener that opens a custom, plain-utility-class modal
 *    (`div.fixed.inset-0.z-50`, no `role="dialog"`/`.kt-modal`/`id*="modal"`
 *    — easy to miss with a generic "any modal-looking element" selector).
 *    Confirmed live end-to-end (create fixture -> kebab Delete -> modal's
 *    own "Delete" button -> "Product deleted successfully." -> gone from
 *    search) that this path works correctly; an earlier pass through this
 *    flow that concluded it was broken was testing for a native `dialog`
 *    event and the wrong modal selectors, not an actual product bug.
 */
export class ProductsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  private get searchInput(): Locator {
    return this.page.getByPlaceholder('Search products by name, ID, or code');
  }

  private get addButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Product' });
  }

  private get filterButton(): Locator {
    return this.page.getByRole('button', { name: 'Filter' });
  }

  private get filterDrawer(): Locator {
    return this.page.locator('#form-products-index-drawer');
  }

  private get downloadCsvLink(): Locator {
    return this.page.getByRole('link', { name: 'Download CSV' });
  }

  private get resultsSummary(): Locator {
    return this.page.getByText(/Showing \d+ of \d+ results/);
  }

  private get createDrawer(): Locator {
    return this.page.locator('#create-product-drawer');
  }

  private get editDrawer(): Locator {
    return this.page.locator('#edit-product-drawer');
  }

  private get tableRows(): Locator {
    return this.page.locator('table tbody tr');
  }

  get successAlert(): Locator {
    return this.page.locator('.kt-alert-success');
  }

  get errorAlert(): Locator {
    return this.page.locator('.kt-alert-destructive');
  }

  rowsContaining(term: string): Locator {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.tableRows.filter({ hasText: new RegExp(escaped, 'i') });
  }

  async goto(): Promise<void> {
    await this.page.goto(`${BASE_URL}/v2/products`);
  }

  /** Re-navigates to the bare index URL to reset search/filters between scenarios. */
  async resetToCleanState(): Promise<void> {
    await this.page.goto(`${BASE_URL}/v2/products`, { waitUntil: 'domcontentloaded' });
  }

  async getResultsSummaryText(): Promise<string> {
    return (await this.resultsSummary.textContent())?.trim() ?? '';
  }

  async getResultsCount(): Promise<number> {
    const match = (await this.getResultsSummaryText()).match(/of (\d+) results/);
    if (!match) throw new Error('Could not parse results count from summary text.');
    return Number(match[1]);
  }

  /** Reads up to `limit` visible rows in a single page.evaluate round trip (see SuppliersPage.getRows for the rationale). */
  async getRows(limit = 25): Promise<ProductRow[]> {
    return this.tableRows.evaluateAll(
      (rows: any[], max: number) =>
        rows.slice(0, max).map((row: any) => {
          const firstCell = row.querySelectorAll('td')[0];
          const name = firstCell?.querySelector('a')?.textContent?.trim() ?? '';
          const skuMatch = (firstCell?.textContent ?? '').match(/SKU:\s*(\S+)/);
          const retailPrice = row.querySelectorAll('td')[2]?.textContent?.trim() ?? '';
          return { name, sku: skuMatch ? skuMatch[1] : '', retailPrice };
        }),
      limit
    );
  }

  /** Finds the first row with a real (non "—") value for the given field, so a search never runs on a placeholder dash. */
  async findRowWithValue(field: keyof ProductRow): Promise<ProductRow> {
    const rows = await this.getRows();
    const row = rows.find((r) => r[field] && r[field] !== '—');
    if (!row) throw new Error(`No row in the current view has a usable "${field}" value to search with.`);
    return row;
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await Promise.all([this.page.waitForLoadState('domcontentloaded'), this.searchInput.press('Enter')]);
  }

  /**
   * Opens the "Filter" drawer, reconciles the Active/Discontinued toggles to
   * the desired checked/unchecked state, then submits via "Update".
   * Confirmed live that "Active" is pre-checked by default (same
   * pre-checked-by-default trap as Customs Brokers — see
   * CustomsBrokersPage.filterByStatus) and that both checkboxes are visually
   * hidden behind KTUI's custom styling, so the *label* text must be
   * clicked, not the `<input>` itself. The visible label for `value=
   * "Inactive"` is "Discontinued", not "Inactive" — clicking by
   * `ProductStatus` value directly would silently miss the real control.
   */
  async filterByStatus(statuses: ProductStatus[]): Promise<void> {
    await this.filterButton.click();
    await this.filterDrawer.waitFor({ state: 'visible' });
    const labelFor: Record<ProductStatus, string> = { Active: 'Active', Inactive: 'Discontinued' };
    const allStatuses: ProductStatus[] = ['Active', 'Inactive'];
    for (const status of allStatuses) {
      const checkbox = this.filterDrawer.locator(`input[type="checkbox"][value="${status}"]`);
      const isChecked = await checkbox.isChecked();
      const shouldBeChecked = statuses.includes(status);
      if (isChecked !== shouldBeChecked) {
        await this.filterDrawer.getByText(labelFor[status], { exact: true }).click();
      }
    }
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.filterDrawer.getByRole('button', { name: 'Update', exact: true }).click(),
    ]);
  }

  async downloadCsv(): Promise<Download> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 20_000 }),
      this.downloadCsvLink.click(),
    ]);
    return download;
  }

  /**
   * KTUI "data-kt-select" combobox mechanics (same family as
   * SuppliersPage.selectKtOption), plus the scroll fix "Select Supplier"
   * specifically needs — see this class's doc comment.
   */
  private async selectKtOption(select: Locator, optionText: string): Promise<void> {
    const wrapper = select.locator('xpath=following-sibling::div[@data-kt-select-wrapper]');
    await wrapper.locator('[data-kt-select-display]').click();
    const dropdown = this.page.locator('[data-kt-select-dropdown].open').first();
    await dropdown.waitFor({ state: 'visible' });
    const search = dropdown.locator('input[placeholder="Search..."]');
    if (await search.count()) await search.fill(optionText);
    const option = dropdown.getByRole('option', { name: optionText, exact: true });
    await option.scrollIntoViewIfNeeded();
    await option.click();
  }

  private async fillForm(drawer: Locator, data: Partial<ProductFormData>): Promise<void> {
    if (data.productName !== undefined) await drawer.locator('input[name="product_name"]').fill(data.productName);
    if (data.brand !== undefined) await this.selectKtOption(drawer.locator('select[name="brand_id"]'), data.brand);
    if (data.supplier !== undefined) await this.selectKtOption(drawer.locator('select[name="supplier_id[]"]'), data.supplier);
    if (data.sku !== undefined) await drawer.locator('input[name="sku"]').fill(data.sku);
    if (data.skuAliases !== undefined) await drawer.locator('input[name="merchant_sku"]').fill(data.skuAliases);
    if (data.barcode !== undefined) await drawer.locator('input[name="barcode"]').fill(data.barcode);
    if (data.listPrice !== undefined) await drawer.locator('input[name="list_price"]').first().fill(data.listPrice);
    if (data.retailPrice !== undefined) await drawer.locator('input[name="sales_price"]').first().fill(data.retailPrice);
    if (data.manufacturingPrice !== undefined) await drawer.locator('input[name="manufacturing_price"]').fill(data.manufacturingPrice);
    if (data.category !== undefined) await this.selectKtOption(drawer.locator('select[name="category_id"]'), data.category);
    if (data.description !== undefined) await drawer.locator('input[name="description"]').fill(data.description);
  }

  async openAddDrawer(): Promise<void> {
    await this.addButton.click();
    await this.createDrawer.locator('input[name="product_name"]').waitFor({ state: 'visible' });
  }

  /** Fills and submits the Add drawer, leaving the resulting banner (success or error) for the caller to assert. */
  async submitCreateDrawer(data: Partial<ProductFormData>): Promise<void> {
    await this.openAddDrawer();
    await this.fillForm(this.createDrawer, data);
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.createDrawer.getByRole('button', { name: 'Save Changes', exact: true }).first().click(),
    ]);
  }

  /** Fills and submits the Add Product drawer. On success the app redirects to the new record's own detail page. */
  async createProduct(data: ProductFormData): Promise<void> {
    await this.submitCreateDrawer(data);
  }

  /**
   * Navigates from an index row to that product's own detail page via its
   * name link (a real `<a href=".../products/{id}">`). Both the detail
   * page's Delete button and the row's kebab-menu Delete genuinely work
   * (see this class's doc comment) — this suite standardizes on the detail
   * page simply because it's the simpler single mechanism (plain button +
   * native `confirm()`) to drive, not because the kebab-menu path is
   * broken. Searches by name first: with 100+ products across several
   * pages, a freshly created fixture is not guaranteed (and, confirmed
   * live, usually isn't) to land on the bare index's first page.
   */
  async openProductDetail(productName: string): Promise<void> {
    await this.search(productName);
    const row = this.rowsContaining(productName).first();
    await Promise.all([this.page.waitForURL(/\/v2\/products\/\d+/, { timeout: 15_000 }), row.locator('a').first().click()]);
  }

  /**
   * Opens the Edit drawer from a product's own detail page. "Edit" is
   * icon-glyph-prefixed (same accessible-name whitespace quirk documented
   * elsewhere in this app) — a substring match, no `exact`.
   */
  async openEditFor(productName: string): Promise<void> {
    await this.openProductDetail(productName);
    await this.page.getByRole('button', { name: 'Edit' }).click();
    await this.editDrawer.locator('input[name="product_name"]').waitFor({ state: 'visible' });
  }

  /** Unlike Suppliers/Warehouses, this drawer lives ON the detail page itself — a successful save re-renders the same URL, it never navigates to a separate "/edit" route. */
  async saveEdit(data: Partial<ProductFormData>): Promise<void> {
    await this.fillForm(this.editDrawer, data);
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.editDrawer.getByRole('button', { name: 'Save Changes', exact: true }).first().click(),
    ]);
  }

  /**
   * Accepts the native `confirm()` dialog and deletes the product currently
   * open on its own detail page (see openProductDetail). Confirmed live
   * this always redirects back to the plain index, never a filtered/
   * search-scoped URL.
   */
  async deleteCurrentProduct(): Promise<void> {
    this.page.once('dialog', (dialog) => dialog.accept());
    await Promise.all([
      this.page.waitForURL(`${BASE_URL}/v2/products`, { timeout: 15_000 }),
      this.page.getByRole('button', { name: 'Delete' }).first().click(),
    ]);
  }

  /** Dismisses the native `confirm()` dialog instead of accepting it — the negative/cancel path. */
  async cancelDeleteCurrentProduct(): Promise<void> {
    this.page.once('dialog', (dialog) => dialog.dismiss());
    await this.page.getByRole('button', { name: 'Delete' }).first().click();
    await this.page.waitForTimeout(500);
  }
}
