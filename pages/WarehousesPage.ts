import { Page, Locator, Download } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { BasePage } from './BasePage';

const BASE_URL = process.env.ADX_BASE_URL || 'https://adxmanager.dev';

export type WarehouseStatus = 'Active' | 'Inactive';

export interface WarehouseRow {
  company: string;
  streetAddress: string;
  city: string;
  contactName: string;
  email: string;
}

/**
 * Fields for the Add Warehouse / Edit Warehouse forms. All optional so a
 * caller can submit a deliberately incomplete form (e.g. to exercise
 * validation) via `Partial<WarehouseFormData>`.
 */
export interface WarehouseFormData {
  companyName: string;
  corporation?: string;
  status: WarehouseStatus;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  contactName: string;
  telNumber: string;
  extensionNumber?: string;
  email: string;
  shippingSpeed: string;
  minStockLevel: string;
  maxStockLevel: string;
}

/**
 * FakeFiller-style random data (backed by @faker-js/faker) so tests never
 * hardcode a fixed company name that could collide across runs. Country is
 * deliberately NOT randomized — see SuppliersPage.buildFakeSupplierData for
 * why "United States" specifically is used.
 *
 * `minStockLevel`/`maxStockLevel` are always populated by default even
 * though neither is marked "*" in the UI: confirmed live that omitting
 * EITHER one fails the create with a generic "Failed to create warehouse.
 * Please try again." banner (not a specific per-field message like every
 * other required field on this form) — a hidden-required-fields bug in the
 * same spirit as Suppliers' Balance Timing/City (see project_conventions.md).
 * Callers exercising that negative path should omit them explicitly rather
 * than relying on this builder to do it.
 */
export function buildFakeWarehouseData(overrides: Partial<WarehouseFormData> = {}): WarehouseFormData {
  const stamp = Date.now();
  return {
    companyName: `QA Automation ${faker.company.name()} ${stamp}`,
    status: 'Active',
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    country: 'United States',
    zipCode: faker.location.zipCode('#####'),
    contactName: faker.person.fullName(),
    telNumber: `+1 ${faker.string.numeric(10)}`,
    extensionNumber: String(faker.number.int({ min: 100, max: 9999 })),
    email: `qa.wh.${stamp}.${faker.string.alphanumeric(6).toLowerCase()}@example.com`,
    shippingSpeed: String(faker.number.int({ min: 1, max: 14 })),
    minStockLevel: String(faker.number.int({ min: 5, max: 20 })),
    maxStockLevel: String(faker.number.int({ min: 500, max: 2000 })),
    ...overrides,
  };
}

export interface WarehouseLocationFormData {
  companyName: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  contactName: string;
  contactNo: string;
}

/** FakeFiller-style random data for the "Add Location" modal — every field there is HTML5 `required` (see WarehousesPage doc comment). */
export function buildFakeWarehouseLocationData(overrides: Partial<WarehouseLocationFormData> = {}): WarehouseLocationFormData {
  const stamp = Date.now();
  return {
    companyName: `QA Automation Location ${stamp}`,
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    country: 'United States',
    zipCode: faker.location.zipCode('#####'),
    contactName: faker.person.fullName(),
    contactNo: `+1 ${faker.string.numeric(10)}`,
    ...overrides,
  };
}

/**
 * https://adxmanager.dev/v2/service-providers/warehouses
 *
 * Same overall drawer/KTUI-select mechanics as SuppliersPage/
 * FreightForwardersPage (icon-glyph accessible-name quirk, desktop/mobile
 * duplicate Create/Save Changes buttons), confirmed live for this section
 * independently rather than assumed — with several genuine differences from
 * every other Service Providers section:
 *  - No "Location" column at all: the index table renders Street Address,
 *    City, State, and Zip Code as four separate columns instead of one
 *    combined string.
 *  - Has a "Status" select (Active/Inactive) as part of the Create/Edit form
 *    itself (a plain native `<select>`, not a KTUI combobox) — every other
 *    section derives status only from Deactivate/Activate on the index.
 *  - `min_stock_level`/`max_stock_level` are a genuinely-confirmed
 *    hidden-required-fields bug (see buildFakeWarehouseData doc comment).
 *  - On successful create, redirects straight to the new record's own detail
 *    page (like Freight Forwarders; unlike Suppliers/Customs Brokers which
 *    stay on the index).
 *  - The index row's kebab (⋮) menu has BOTH "Deactivate"/"Activate" AND a
 *    hard "Delete" together (every other section offers only one of the
 *    two) — "Edit" there is a real `<a href=".../edit">` link, same as
 *    Suppliers/Freight Forwarders.
 *  - Has NO Bank Accounts section at all (see BankAccountsSection.ts) but
 *    has a unique "Add Location" feature instead: a client-side modal
 *    (`#warehouse-location-modal`) reachable only from a warehouse's own
 *    detail page, whose fields are all native HTML5 `required` (client-side
 *    constraint validation — the browser blocks submission itself, no
 *    server round trip and no `.kt-alert-destructive` banner), unlike every
 *    other validation elsewhere in this app.
 */
export class WarehousesPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  private get searchInput(): Locator {
    return this.page.getByPlaceholder('Search by company name, address, contact, or email...');
  }

  private get addButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Warehouse' });
  }

  private get filterButton(): Locator {
    // Verified live: preceded by a KTUI icon-font glyph (same accessible-name
    // quirk documented elsewhere in this app) — substring match, no `exact`.
    return this.page.getByRole('button', { name: 'Filter' });
  }

  private get filterDrawer(): Locator {
    return this.page.locator('#form-warehouses-index-drawer');
  }

  private get downloadCsvLink(): Locator {
    return this.page.getByRole('link', { name: 'Download CSV' });
  }

  private get resultsSummary(): Locator {
    return this.page.getByText(/Showing \d+ of \d+ results/);
  }

  private get createDrawer(): Locator {
    return this.page.locator('#create-warehouse-drawer');
  }

  private get editDrawer(): Locator {
    return this.page.locator('#edit-warehouse-drawer');
  }

  private get addLocationButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Location' });
  }

  private get locationModal(): Locator {
    return this.page.locator('#warehouse-location-modal');
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
    await this.page.goto(`${BASE_URL}/v2/service-providers/warehouses`);
  }

  /** Re-navigates to the bare index URL to reset search/filters between scenarios. */
  async resetToCleanState(): Promise<void> {
    await this.page.goto(`${BASE_URL}/v2/service-providers/warehouses`, { waitUntil: 'domcontentloaded' });
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
  async getRows(limit = 25): Promise<WarehouseRow[]> {
    return this.tableRows.evaluateAll(
      (rows: any[], max: number) =>
        rows.slice(0, max).map((row: any) => {
          const cells = row.querySelectorAll('td');
          const text = (i: number) => (cells[i]?.textContent ?? '').trim();
          return { company: text(0), streetAddress: text(2), city: text(3), contactName: text(6), email: text(9) };
        }),
      limit
    );
  }

  /** Finds the first row with a real (non "—") value for the given field, so a search never runs on a placeholder dash. */
  async findRowWithValue(field: keyof WarehouseRow): Promise<WarehouseRow> {
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
   * Opens the "Filter" drawer, reconciles each status toggle to the desired
   * checked/unchecked state, then submits via its single "Update" button
   * (no dual-Apply-button pattern here, unlike Suppliers). Reconciling
   * against each checkbox's actual current state (rather than blindly
   * clicking every requested status) avoids the bug confirmed live on
   * Customs Brokers, whose "Active" toggle is pre-checked by default — see
   * CustomsBrokersPage.filterByStatus.
   */
  async filterByStatus(statuses: WarehouseStatus[]): Promise<void> {
    await this.filterButton.click();
    await this.filterDrawer.waitFor({ state: 'visible' });
    const allStatuses: WarehouseStatus[] = ['Active', 'Inactive'];
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

  /** Same KTUI "data-kt-select" combobox mechanics as SuppliersPage.selectKtOption. */
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

  private async fillForm(formSuffix: 'create' | 'edit', data: Partial<WarehouseFormData>): Promise<void> {
    const field = (name: string) => this.page.locator(`#${name}_${formSuffix}`);
    if (data.companyName !== undefined) await field('company_name').fill(data.companyName);
    if (data.corporation !== undefined) await this.selectKtOption(`corporation_id_${formSuffix}`, data.corporation);
    if (data.status !== undefined) await field('status').selectOption(data.status);
    if (data.address !== undefined) await field('address').fill(data.address);
    if (data.city !== undefined) await field('city').fill(data.city);
    if (data.state !== undefined) await field('state').fill(data.state);
    if (data.country !== undefined) await this.selectKtOption(`country_${formSuffix}`, data.country);
    if (data.zipCode !== undefined) await field('zip_code').fill(data.zipCode);
    if (data.contactName !== undefined) await field('contact_name').fill(data.contactName);
    if (data.telNumber !== undefined) await field('tel_number').fill(data.telNumber);
    if (data.extensionNumber !== undefined) await field('extension_number').fill(data.extensionNumber);
    if (data.email !== undefined) await field('email').fill(data.email);
    if (data.shippingSpeed !== undefined) await field('shipping_speed').fill(data.shippingSpeed);
    if (data.minStockLevel !== undefined) await field('min_stock_level').fill(data.minStockLevel);
    if (data.maxStockLevel !== undefined) await field('max_stock_level').fill(data.maxStockLevel);
  }

  async openAddDrawer(): Promise<void> {
    await this.addButton.click();
    await this.createDrawer.locator('#company_name_create').waitFor({ state: 'visible' });
  }

  /** Fills and submits the Add drawer, leaving the resulting banner (success or error) for the caller to assert. */
  async submitCreateDrawer(data: Partial<WarehouseFormData>): Promise<void> {
    await this.openAddDrawer();
    await this.fillForm('create', data);
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.createDrawer.getByRole('button', { name: 'Create', exact: true }).first().click(),
    ]);
  }

  /** Fills and submits the Add Warehouse drawer. On success the app redirects to the new record's own detail page. */
  async createWarehouse(data: WarehouseFormData): Promise<void> {
    await this.submitCreateDrawer(data);
  }

  /**
   * Opens the Edit drawer for the first row whose text contains
   * `companyName`, via that row's kebab (⋮) menu — the index's "Edit" is a
   * real `<a href=".../edit">` link (confirmed live) that server-renders the
   * detail page with `#edit-warehouse-drawer` already open, same pattern as
   * Suppliers/Freight Forwarders.
   */
  async openEditFor(companyName: string): Promise<void> {
    const row = this.rowsContaining(companyName).first();
    await row.locator('button.kt-menu-toggle').click();
    await Promise.all([
      this.page.waitForURL(/\/edit$/),
      row.locator('a.kt-menu-link', { hasText: 'Edit' }).click(),
    ]);
    await this.editDrawer.locator('#company_name_edit').waitFor({ state: 'visible' });
  }

  /** On success this redirects from ".../<id>/edit" to the plain ".../<id>" detail page (confirmed live), same as Suppliers/Freight Forwarders. */
  async saveEdit(data: Partial<WarehouseFormData>): Promise<void> {
    await this.fillForm('edit', data);
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.editDrawer.getByRole('button', { name: 'Save Changes', exact: true }).first().click(),
    ]);
  }

  /**
   * Opens the "Add Location" modal from a warehouse's own detail page.
   * Must be called after `waitForLoadState('networkidle')` on that page —
   * confirmed live that clicking this immediately after the Create-redirect
   * chain (before Alpine finishes hydrating) can silently no-op.
   */
  async openAddLocationModal(): Promise<void> {
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.addLocationButton.first().click();
    await this.page.locator('#modal_company_name').waitFor({ state: 'visible' });
  }

  private async selectLocationCountry(optionText: string): Promise<void> {
    await this.selectKtOptionByLocator(this.page.locator('#modal_country'), optionText);
  }

  private async selectKtOptionByLocator(select: Locator, optionText: string): Promise<void> {
    const wrapper = select.locator('xpath=following-sibling::div[@data-kt-select-wrapper]');
    await wrapper.locator('[data-kt-select-display]').click();
    const dropdown = wrapper.locator('[data-kt-select-dropdown]');
    const search = dropdown.locator('input[placeholder="Search..."]');
    if (await search.count()) await search.fill(optionText);
    await dropdown.getByRole('option', { name: optionText, exact: true }).click();
  }

  private async fillLocationForm(data: Partial<WarehouseLocationFormData>): Promise<void> {
    if (data.companyName !== undefined) await this.page.locator('#modal_company_name').fill(data.companyName);
    if (data.address !== undefined) await this.page.locator('#modal_address').fill(data.address);
    if (data.city !== undefined) await this.page.locator('#modal_city').fill(data.city);
    if (data.state !== undefined) await this.page.locator('#modal_state').fill(data.state);
    if (data.country !== undefined) await this.selectLocationCountry(data.country);
    if (data.zipCode !== undefined) await this.page.locator('#modal_zip_code').fill(data.zipCode);
    if (data.contactName !== undefined) await this.page.locator('#modal_contact_name').fill(data.contactName);
    if (data.contactNo !== undefined) await this.page.locator('#modal_contact_no').fill(data.contactNo);
  }

  /** Fills and submits the "Add Location" modal, leaving the caller to assert the result (a page-level `successAlert`, not a modal-scoped one). */
  async submitLocationModal(data: Partial<WarehouseLocationFormData>): Promise<void> {
    await this.fillLocationForm(data);
    await Promise.all([
      this.page.waitForLoadState('networkidle').catch(() => {}),
      this.locationModal.getByRole('button', { name: 'Save Location', exact: true }).click(),
    ]);
  }

  /** Opens the modal, fills every field, and submits — the happy-path convenience for the Add Location flow. */
  async addLocation(data: WarehouseLocationFormData): Promise<void> {
    await this.openAddLocationModal();
    await this.submitLocationModal(data);
  }

  /** The "Warehouse Locations" list entry for a given location's company name, rendered on the warehouse's detail page. */
  locationRow(locationCompanyName: string): Locator {
    return this.page.locator('div').filter({ hasText: locationCompanyName }).last();
  }
}
