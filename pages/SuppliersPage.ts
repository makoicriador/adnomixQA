import { Page, Locator, Download } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { BasePage } from './BasePage';
import { BankAccountsSection, BankAccountFormData } from './BankAccountsSection';

const BASE_URL = process.env.ADX_BASE_URL || 'https://adxmanager.dev';

export type SupplierStatus = 'Active' | 'Inactive';

export interface SupplierRow {
  supplier: string;
  location: string;
  contact: string;
  email: string;
}

/**
 * Fields for the Add Supplier / Edit Supplier forms. All optional so a
 * caller can submit a deliberately incomplete form (e.g. to exercise
 * validation) via `Partial<SupplierFormData>`.
 */
export interface SupplierFormData {
  companyName: string;
  address: string;
  city: string;
  state: string;
  country: string;
  contactName: string;
  phone: string;
  email: string;
  leadTimeDays: string;
  balanceTiming: string;
  licenseNumber?: string;
}

/**
 * Exact visible option text for the "Balance Timing" select, read live from
 * the app (not guessed) — the underlying values are internal slugs
 * (`per_shipment_depart`, etc.) that the UI never shows.
 */
export const BALANCE_TIMING_OPTIONS = [
  'Per shipment (FOB / ETD)',
  'Per shipment (ETA)',
  'Payment upon order completion (Cargo Ready Date)',
  'After all goods shipped',
] as const;

/**
 * FakeFiller-style random data for the Create/Edit forms (backed by
 * @faker-js/faker) so tests never hardcode a fixed company name that could
 * collide across runs. Country is deliberately NOT randomized: it must
 * match one of the exact option strings in the live "Country" combobox
 * (see SuppliersPage.selectKtOption), and faker's country names aren't
 * guaranteed to line up with that list (e.g. naming variants) — "United
 * States" is confirmed to exist there.
 */
export function buildFakeSupplierData(overrides: Partial<SupplierFormData> = {}): SupplierFormData {
  const stamp = Date.now();
  return {
    companyName: `QA Automation ${faker.company.name()} ${stamp}`,
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    country: 'United States',
    contactName: faker.person.fullName(),
    phone: `+1 ${faker.string.numeric(10)}`,
    email: `qa.automation.${stamp}.${faker.string.alphanumeric(6).toLowerCase()}@example.com`,
    leadTimeDays: String(faker.number.int({ min: 5, max: 60 })),
    balanceTiming: BALANCE_TIMING_OPTIONS[0],
    licenseNumber: faker.string.alphanumeric(10).toUpperCase(),
    ...overrides,
  };
}

/**
 * https://adxmanager.dev/v2/service-providers/suppliers
 *
 * The search bar, status filter, and CSV export all submit one Alpine.js
 * GET form (id="form-suppliers-index"). The status filter is a "Filter"
 * button (icon-glyph-prefixed, substring match needed) that toggles a
 * drawer (`#form-suppliers-index-drawer`) with Active/Inactive toggle
 * buttons and a single "Update" submit button — same mechanism as Freight
 * Forwarders/Customs Brokers/Warehouses.
 *
 * This supersedes an earlier finding recorded when this page object was
 * first written: at that time the live app used a different "Add Filter"
 * dropdown with a "Status" menu item and two identically-labelled "Apply"
 * buttons (an inner one staging the selection into a "Status: ..." chip,
 * an outer one actually submitting). Re-verified live on 2026-09-17: that
 * UI no longer exists anywhere on this page — the app has since been
 * migrated to the same unified Filter-drawer pattern as the other three
 * Service Providers sections. Also confirmed live: "Active" is pre-checked
 * by default even with no filter applied, so `filterByStatus` reconciles
 * each toggle's actual checked state rather than blindly clicking every
 * requested status (see CustomsBrokersPage.filterByStatus for the bug that
 * blind-clicking causes).
 */
export class SuppliersPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  private get searchInput(): Locator {
    return this.page.getByPlaceholder('Search by supplier name, contact, location, or email...');
  }

  private get filterButton(): Locator {
    // Verified live: preceded by a KTUI icon-font glyph (same accessible-name
    // quirk documented elsewhere in this app) — substring match, no `exact`.
    return this.page.getByRole('button', { name: 'Filter' });
  }

  private get filterDrawer(): Locator {
    return this.page.locator('#form-suppliers-index-drawer');
  }

  private get downloadCsvLink(): Locator {
    return this.page.getByRole('link', { name: 'Download CSV' });
  }

  private get resultsSummary(): Locator {
    return this.page.getByText(/Showing \d+ of \d+ results/);
  }

  private get tableRows(): Locator {
    return this.page.locator('table tbody tr');
  }

  private get addSupplierButton(): Locator {
    // Verified against the live app: this button is preceded by a KTUI/
    // Keenthemes icon-font glyph, which contributes invisible characters to
    // the computed accessible name — an `exact: true` name match times out
    // (0 matches), so this is a substring match instead.
    return this.page.getByRole('button', { name: 'Add Supplier' });
  }

  private get createDrawer(): Locator {
    return this.page.locator('#create-supplier-drawer');
  }

  private get editDrawer(): Locator {
    return this.page.locator('#edit-supplier-drawer');
  }

  /** The green "Supplier created successfully." / "Supplier details updated successfully." banner. */
  get successAlert(): Locator {
    return this.page.locator('.kt-alert-success');
  }

  /** The red "Form submission failed..." banner shown on a server-side validation error. */
  get errorAlert(): Locator {
    return this.page.locator('.kt-alert-destructive');
  }

  /** Drives the "Bank accounts" section shared verbatim with Freight Forwarders/Customs Brokers (see BankAccountsSection.ts) — present in both the Create and Edit drawers here. */
  get bankAccounts(): BankAccountsSection {
    return new BankAccountsSection(this.page);
  }

  /**
   * Rows whose text matches `term` (case-insensitive), for direct web-first
   * assertions (`expect(suppliers.rowsContaining(term).first()).toBeVisible()`)
   * instead of pulling every row back and filtering in JS.
   */
  rowsContaining(term: string): Locator {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.tableRows.filter({ hasText: new RegExp(escaped, 'i') });
  }

  async goto(): Promise<void> {
    await this.page.goto(`${BASE_URL}/v2/service-providers/suppliers`);
  }

  /** Re-navigates to the bare index URL to reset search/filters between scenarios. */
  async resetToCleanState(): Promise<void> {
    await this.page.goto(`${BASE_URL}/v2/service-providers/suppliers`, { waitUntil: 'domcontentloaded' });
  }

  async getResultsSummaryText(): Promise<string> {
    return (await this.resultsSummary.textContent())?.trim() ?? '';
  }

  async getResultsCount(): Promise<number> {
    const match = (await this.getResultsSummaryText()).match(/of (\d+) results/);
    if (!match) throw new Error('Could not parse results count from summary text.');
    return Number(match[1]);
  }

  /**
   * Reads up to `limit` visible rows in a single page.evaluate round trip
   * (rather than one awaited `innerText()` per cell, per row — ~4x`limit`
   * separate round trips for the same data).
   */
  async getRows(limit = 25): Promise<SupplierRow[]> {
    return this.tableRows.evaluateAll(
      (rows: any[], max: number) =>
        rows.slice(0, max).map((row: any) => {
          const cells = row.querySelectorAll('td');
          const text = (i: number) => (cells[i]?.textContent ?? '').trim();
          return { supplier: text(0), location: text(1), contact: text(2), email: text(5) };
        }),
      limit
    );
  }

  /** Finds the first row with a real (non "—") value for the given field, so a search never runs on a placeholder dash. */
  async findRowWithValue(field: keyof SupplierRow): Promise<SupplierRow> {
    const rows = await this.getRows();
    const row = rows.find((r) => r[field] && r[field] !== '—');
    if (!row) throw new Error(`No row in the current view has a usable "${field}" value to search with.`);
    return row;
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    // A real full-page GET submit (server-rendered), not a client-side
    // re-render — domcontentloaded alone guarantees the new rows are in the
    // DOM, so no extra settle-wait is needed after it.
    await Promise.all([this.page.waitForLoadState('domcontentloaded'), this.searchInput.press('Enter')]);
  }

  /**
   * Opens the "Filter" drawer, reconciles each status toggle to the desired
   * checked/unchecked state, then submits via its single "Update" button.
   * Reconciling against each checkbox's actual current state (rather than
   * blindly clicking every requested status) avoids the bug confirmed live
   * on Customs Brokers, whose "Active" toggle is pre-checked by default —
   * see CustomsBrokersPage.filterByStatus.
   */
  async filterByStatus(statuses: SupplierStatus[]): Promise<void> {
    await this.filterButton.click();
    await this.filterDrawer.waitFor({ state: 'visible' });
    const allStatuses: SupplierStatus[] = ['Active', 'Inactive'];
    for (const status of allStatuses) {
      const checkbox = this.filterDrawer.locator(`input[type="checkbox"][value="${status}"]`);
      const isChecked = await checkbox.isChecked();
      const shouldBeChecked = statuses.includes(status);
      if (isChecked !== shouldBeChecked) {
        await this.filterDrawer.getByText(status, { exact: true }).click();
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
   * Drives a KTUI "data-kt-select" combobox (used for Country, Balance
   * Timing, Brand, etc.): the real `<select id="{nativeSelectId}">` stays
   * `class="hidden"` and a generated wrapper — its next DOM sibling —
   * renders the visible trigger plus an `<li role="option">` listbox.
   * Picking an option there updates the hidden `<select>`'s value directly
   * (confirmed live), which is what the Alpine.js form actually submits —
   * `selectOption()` can't be used since the native element is never
   * visible. Only some instances of this component enable a search box
   * (Country does; Balance Timing does not, confirmed live) — the search
   * fill is skipped when that input isn't present, rather than assumed.
   */
  private async selectKtOption(nativeSelectId: string, optionText: string): Promise<void> {
    const wrapper = this.page.locator(`#${nativeSelectId}`).locator('xpath=following-sibling::div[@data-kt-select-wrapper]');
    await wrapper.locator('[data-kt-select-display]').click();
    const dropdown = wrapper.locator('[data-kt-select-dropdown]');
    const search = dropdown.locator('input[placeholder="Search..."]');
    if (await search.count()) {
      await search.fill(optionText);
    }
    await dropdown.getByRole('option', { name: optionText, exact: true }).click();
  }

  /**
   * Fills the Create/Edit supplier form. Both drawers share identical field
   * `name`s with only the id suffix differing (`_create` vs `_edit`), so
   * one method drives either. Only keys present in `data` are touched, so a
   * caller can submit a deliberately incomplete form to exercise validation.
   *
   * Two non-obvious, live-verified findings baked into this method's
   * contract:
   *  - "Balance Timing" has no "*" in the UI but IS required server-side
   *    (omitting it fails gracefully with "The balance payment timing field
   *    is required.").
   *  - "City" also has no "*" in the UI but is a NOT NULL database column
   *    with no validation rule behind it — omitting it does not fail
   *    gracefully, it 500s with a raw Laravel debug page. Callers must
   *    always supply `city`; it is intentionally not optional to omit in
   *    the negative-path tests here.
   */
  private async fillSupplierForm(formSuffix: 'create' | 'edit', data: Partial<SupplierFormData>): Promise<void> {
    const field = (name: string) => this.page.locator(`#${name}_${formSuffix}`);
    if (data.companyName !== undefined) await field('company_name').fill(data.companyName);
    if (data.licenseNumber !== undefined) await field('license_number').fill(data.licenseNumber);
    if (data.address !== undefined) await field('address').fill(data.address);
    if (data.city !== undefined) await field('city').fill(data.city);
    if (data.state !== undefined) await field('state').fill(data.state);
    if (data.country !== undefined) await this.selectKtOption(`country_${formSuffix}`, data.country);
    if (data.contactName !== undefined) await field('contact_name').fill(data.contactName);
    if (data.phone !== undefined) await field('cell_number').fill(data.phone);
    if (data.email !== undefined) await field('email').fill(data.email);
    if (data.leadTimeDays !== undefined) await field('shipping_speed').fill(String(data.leadTimeDays));
    if (data.balanceTiming !== undefined) await this.selectKtOption(`balance_payment_timing_${formSuffix}`, data.balanceTiming);
  }

  /** Opens the "Add Supplier" drawer and waits for its form to be ready to fill. */
  async openAddSupplierDrawer(): Promise<void> {
    await this.addSupplierButton.click();
    await this.createDrawer.locator('#company_name_create').waitFor({ state: 'visible' });
  }

  /**
   * Fills and submits the Add Supplier drawer. Leaves whichever banner the
   * app renders (`successAlert` or `errorAlert`) for the caller to assert —
   * this method itself makes no assumption about which one appears, so it
   * doubles as the driver for both the happy path and negative-path tests.
   */
  async submitCreateDrawer(data: Partial<SupplierFormData>, options: { bankAccount?: BankAccountFormData } = {}): Promise<void> {
    await this.openAddSupplierDrawer();
    await this.fillSupplierForm('create', data);
    // Added before submitting since the Bank Accounts section lives inside
    // this same enclosing form and persists together with everything else
    // in one request (see BankAccountsSection.ts) rather than needing a
    // separate save.
    if (options.bankAccount) await this.bankAccounts.add(options.bankAccount);
    // Verified live: there are two identically-labelled "Create" submit
    // buttons wired to the same form (a responsive desktop/mobile pair) —
    // same duplicate-button pattern as the Status filter's two "Apply"
    // buttons; `.first()` plus a single click is sufficient to submit once.
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.createDrawer.getByRole('button', { name: 'Create', exact: true }).first().click(),
    ]);
  }

  /** Fills and submits the Add Supplier drawer, asserting-free convenience for the happy path. */
  async createSupplier(data: SupplierFormData, options: { bankAccount?: BankAccountFormData } = {}): Promise<void> {
    await this.submitCreateDrawer(data, options);
  }

  /**
   * Opens the Edit drawer for the first row whose text contains
   * `companyName`, via that row's kebab (⋮) menu — mirrors real user
   * navigation rather than hitting the `/edit` URL directly.
   */
  async openEditFor(companyName: string): Promise<void> {
    const row = this.rowsContaining(companyName).first();
    await row.locator('button.kt-menu-toggle').click();
    // Scoped to the menu-link class (not just role+text): a plain
    // getByRole('link', { name: 'Edit' }) substring-matches the row's own
    // supplier-name link too whenever companyName itself contains "Edit"
    // (verified live — this bit us with a fixture literally named "...Edit
    // Fixture...").
    await Promise.all([
      this.page.waitForURL(/\/edit$/),
      row.locator('a.kt-menu-link', { hasText: 'Edit' }).click(),
    ]);
    await this.editDrawer.locator('#company_name_edit').waitFor({ state: 'visible' });
  }

  /**
   * Fills and submits the Edit drawer for whichever supplier `openEditFor`
   * last opened. On success the app redirects from `.../<id>/edit` to the
   * plain `.../<id>` detail page (confirmed live) and renders `successAlert`
   * there — the caller ends up on the detail page, not the index.
   */
  async saveEdit(data: Partial<SupplierFormData>, options: { bankAccount?: BankAccountFormData } = {}): Promise<void> {
    await this.fillSupplierForm('edit', data);
    if (options.bankAccount) await this.bankAccounts.add(options.bankAccount);
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.editDrawer.getByRole('button', { name: 'Save Changes', exact: true }).first().click(),
    ]);
  }

  /**
   * Deactivates the first row whose text contains `companyName`, via its
   * kebab menu's "Deactivate" link (a plain `<a href=".../toggle-status">`,
   * not a client-side action — no confirm() dialog, unlike Freight
   * Forwarders'/Warehouses' hard "Delete"). Confirmed live: on success this
   * redirects from the index straight to the record's own detail page
   * (`.../suppliers/{id}`, no `/edit` suffix) with `successAlert` reading
   * "Successfully deactivated the supplier." there, and the record then
   * disappears from the index's default (Active-only) search/listing —
   * only the Filter drawer's "Inactive" toggle surfaces it again.
   */
  async deactivateFor(companyName: string): Promise<void> {
    const row = this.rowsContaining(companyName).first();
    await row.locator('button.kt-menu-toggle').click();
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      row.locator('a.kt-menu-link', { hasText: 'Deactivate' }).click(),
    ]);
  }

  /**
   * Reactivates the first row whose text contains `companyName`, via the
   * same kebab menu whose "Deactivate" link now reads "Activate" (confirmed
   * live: the link's label flips with the record's current status, same
   * `.../toggle-status` href either way).
   */
  async activateFor(companyName: string): Promise<void> {
    const row = this.rowsContaining(companyName).first();
    await row.locator('button.kt-menu-toggle').click();
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      row.locator('a.kt-menu-link', { hasText: 'Activate' }).click(),
    ]);
  }
}
