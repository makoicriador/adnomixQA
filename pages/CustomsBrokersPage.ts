import { Page, Locator, Download } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { BasePage } from './BasePage';
import { BankAccountsSection, BankAccountFormData } from './BankAccountsSection';

const BASE_URL = process.env.ADX_BASE_URL || 'https://adxmanager.dev';

export type CustomsBrokerStatus = 'Active' | 'Inactive';

export interface CustomsBrokerRow {
  company: string;
  location: string;
  contact: string;
  email: string;
}

/**
 * Fields for the Add Customs Broker / Edit Customs Broker forms. All
 * optional so a caller can submit a deliberately incomplete form (e.g. to
 * exercise validation) via `Partial<CustomsBrokerFormData>`.
 */
export interface CustomsBrokerFormData {
  companyName: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  contactName: string;
  email: string;
  telNumber: string;
  cellNumber: string;
  extensionNumber?: string;
  customsNotes?: string;
}

/**
 * FakeFiller-style random data (backed by @faker-js/faker) so tests never
 * hardcode a fixed company name that could collide across runs. Country is
 * deliberately NOT randomized — see SuppliersPage.buildFakeSupplierData for
 * why "United States" specifically is used. Unlike Freight Forwarders,
 * Cell Number is marked "*" (required) on this form — verified live.
 */
export function buildFakeCustomsBrokerData(overrides: Partial<CustomsBrokerFormData> = {}): CustomsBrokerFormData {
  const stamp = Date.now();
  return {
    companyName: `QA Automation ${faker.company.name()} ${stamp}`,
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    country: 'United States',
    zipCode: faker.location.zipCode('#####'),
    contactName: faker.person.fullName(),
    email: `qa.cb.${stamp}.${faker.string.alphanumeric(6).toLowerCase()}@example.com`,
    telNumber: `+1 ${faker.string.numeric(10)}`,
    cellNumber: `+1 ${faker.string.numeric(10)}`,
    extensionNumber: String(faker.number.int({ min: 100, max: 9999 })),
    customsNotes: faker.lorem.sentence(),
    ...overrides,
  };
}

/**
 * https://adxmanager.dev/v2/service-providers/customs-brokers
 *
 * Same drawer/KTUI-select mechanics as SuppliersPage/FreightForwardersPage,
 * confirmed live independently rather than assumed — with one genuinely
 * different navigation path:
 *  - Unlike Suppliers/Freight Forwarders, a row's kebab (⋮) menu on the
 *    index has **no "Edit" action at all** — only "Deactivate". Editing is
 *    only reachable from the detail page's own "Edit" button
 *    (`#edit-button`, `data-kt-drawer-toggle="#edit-customs-broker-drawer"`,
 *    a client-side drawer toggle — no navigation, unlike Suppliers/Freight
 *    Forwarders' real `<a href=".../edit">` link). `openEditFor` therefore
 *    clicks into the row's own detail page first.
 *  - Cell Number is marked "*" (required) here, unlike Freight Forwarders
 *    where it's optional.
 *  - The Location column renders "{city}, {state}, {country}" — a third,
 *    different format from both Suppliers ("{state}, {country}") and
 *    Freight Forwarders ("{city}, {country}").
 *  - All "*"-marked fields fail gracefully server-side (no unhandled 500
 *    like Suppliers' City) — confirmed live before relying on it.
 *  - The Status filter is a "Filter" button that toggles a drawer
 *    (`#form-customs-brokers-index-drawer`) with a single "Update" submit
 *    button — same mechanism as Freight Forwarders/Warehouses, confirmed
 *    live to be genuinely different from Suppliers' "Add Filter" dropdown +
 *    two identically-labelled "Apply" buttons.
 */
export class CustomsBrokersPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  private get searchInput(): Locator {
    return this.page.getByPlaceholder('Search by company name, contact, location, or email...');
  }

  private get addButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Customs Broker' });
  }

  private get createDrawer(): Locator {
    return this.page.locator('#create-customs-broker-drawer');
  }

  private get editDrawer(): Locator {
    return this.page.locator('#edit-customs-broker-drawer');
  }

  private get editButton(): Locator {
    return this.page.locator('#edit-button');
  }

  private get filterButton(): Locator {
    // Verified live: preceded by a KTUI icon-font glyph (same accessible-name
    // quirk documented elsewhere in this app) — substring match, no `exact`.
    return this.page.getByRole('button', { name: 'Filter' });
  }

  private get filterDrawer(): Locator {
    return this.page.locator('#form-customs-brokers-index-drawer');
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

  get successAlert(): Locator {
    return this.page.locator('.kt-alert-success');
  }

  get errorAlert(): Locator {
    return this.page.locator('.kt-alert-destructive');
  }

  /** Drives the "Bank accounts" section shared verbatim with Suppliers/Freight Forwarders (see BankAccountsSection.ts) — present in both the Create and Edit drawers here. */
  get bankAccounts(): BankAccountsSection {
    return new BankAccountsSection(this.page);
  }

  rowsContaining(term: string): Locator {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.tableRows.filter({ hasText: new RegExp(escaped, 'i') });
  }

  async goto(): Promise<void> {
    await this.page.goto(`${BASE_URL}/v2/service-providers/customs-brokers`);
  }

  /** Re-navigates to the bare index URL to reset search/filters between scenarios. */
  async resetToCleanState(): Promise<void> {
    await this.page.goto(`${BASE_URL}/v2/service-providers/customs-brokers`, { waitUntil: 'domcontentloaded' });
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await Promise.all([this.page.waitForLoadState('domcontentloaded'), this.searchInput.press('Enter')]);
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
  async getRows(limit = 25): Promise<CustomsBrokerRow[]> {
    return this.tableRows.evaluateAll(
      (rows: any[], max: number) =>
        rows.slice(0, max).map((row: any) => {
          const cells = row.querySelectorAll('td');
          const text = (i: number) => (cells[i]?.textContent ?? '').trim();
          return { company: text(0), location: text(1), contact: text(2), email: text(6) };
        }),
      limit
    );
  }

  /** Finds the first row with a real (non "—") value for the given field, so a search never runs on a placeholder dash. */
  async findRowWithValue(field: keyof CustomsBrokerRow): Promise<CustomsBrokerRow> {
    const rows = await this.getRows();
    const row = rows.find((r) => r[field] && r[field] !== '—');
    if (!row) throw new Error(`No row in the current view has a usable "${field}" value to search with.`);
    return row;
  }

  /**
   * Opens the "Filter" drawer, reconciles each status toggle to the desired
   * checked/unchecked state, then submits via its single "Update" button.
   * Verified live: unlike Freight Forwarders/Warehouses, this drawer's
   * "Active" toggle is pre-checked by default even with no filter applied —
   * blindly clicking every requested status (rather than checking its
   * current state first) silently UNCHECKS "Active" instead of checking it,
   * corrupting the resulting filter. Reconciling against the checkbox's
   * actual state avoids assuming either default.
   */
  async filterByStatus(statuses: CustomsBrokerStatus[]): Promise<void> {
    await this.filterButton.click();
    await this.filterDrawer.waitFor({ state: 'visible' });
    const allStatuses: CustomsBrokerStatus[] = ['Active', 'Inactive'];
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

  private async fillForm(formSuffix: 'create' | 'edit', data: Partial<CustomsBrokerFormData>): Promise<void> {
    const field = (name: string) => this.page.locator(`#${name}_${formSuffix}`);
    if (data.companyName !== undefined) await field('company_name').fill(data.companyName);
    if (data.address !== undefined) await field('address').fill(data.address);
    if (data.city !== undefined) await field('city').fill(data.city);
    if (data.state !== undefined) await field('state').fill(data.state);
    if (data.country !== undefined) await this.selectKtOption(`country_${formSuffix}`, data.country);
    if (data.zipCode !== undefined) await field('zip_code').fill(data.zipCode);
    if (data.contactName !== undefined) await field('contact_name').fill(data.contactName);
    if (data.email !== undefined) await field('email').fill(data.email);
    if (data.telNumber !== undefined) await field('tel_number').fill(data.telNumber);
    if (data.extensionNumber !== undefined) await field('extension_number').fill(data.extensionNumber);
    if (data.cellNumber !== undefined) await field('cell_number').fill(data.cellNumber);
    if (data.customsNotes !== undefined) await field('customs_notes').fill(data.customsNotes);
  }

  async openAddDrawer(): Promise<void> {
    await this.addButton.click();
    await this.createDrawer.locator('#company_name_create').waitFor({ state: 'visible' });
  }

  /**
   * Fills and submits the Add drawer, leaving the resulting banner (success
   * or error) for the caller to assert. An optional `bankAccount` is added
   * to the same Bank Accounts section before submitting (see
   * BankAccountsSection.ts).
   */
  async submitCreateDrawer(data: Partial<CustomsBrokerFormData>, options: { bankAccount?: BankAccountFormData } = {}): Promise<void> {
    await this.openAddDrawer();
    await this.fillForm('create', data);
    if (options.bankAccount) await this.bankAccounts.add(options.bankAccount);
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.createDrawer.getByRole('button', { name: 'Create', exact: true }).first().click(),
    ]);
  }

  async createCustomsBroker(data: CustomsBrokerFormData, options: { bankAccount?: BankAccountFormData } = {}): Promise<void> {
    await this.submitCreateDrawer(data, options);
  }

  /**
   * Opens the Edit drawer for the first row whose text contains
   * `companyName` — via its detail page, since (unlike Suppliers/Freight
   * Forwarders) the index row's kebab menu has no "Edit" action here.
   */
  async openEditFor(companyName: string): Promise<void> {
    const row = this.rowsContaining(companyName).first();
    await row.locator('td').first().locator('a').click();
    await this.editButton.waitFor({ state: 'visible' });
    await this.editButton.click();
    await this.editDrawer.locator('#company_name_edit').waitFor({ state: 'visible' });
  }

  /**
   * On success this stays on the same detail URL (the edit drawer is a
   * client-side overlay, not a page navigation) — confirmed live.
   */
  async saveEdit(data: Partial<CustomsBrokerFormData>, options: { bankAccount?: BankAccountFormData } = {}): Promise<void> {
    await this.fillForm('edit', data);
    if (options.bankAccount) await this.bankAccounts.add(options.bankAccount);
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.editDrawer.getByRole('button', { name: 'Save Changes', exact: true }).first().click(),
    ]);
  }

  /**
   * Deactivates the first row whose text contains `companyName`, via its
   * kebab menu's "Deactivate" link — the only kebab action here besides
   * navigating into the detail page (see this class's own doc comment).
   * Confirmed live: unlike Suppliers, this stays on the plain index URL
   * (no redirect to the detail page) with `successAlert` reading
   * "Successfully deactivated the customs broker." there, and the record
   * then disappears from the index's default (Active-only) search/listing —
   * only the Filter drawer's "Inactive" toggle surfaces it again. No
   * confirm() dialog, unlike Freight Forwarders'/Warehouses' hard "Delete".
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
   * same kebab menu whose "Deactivate" link now reads "Activate" (same
   * label-flip mechanic as Suppliers.activateFor).
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
