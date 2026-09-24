import { Page, Locator, Download } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { BasePage } from './BasePage';
import { BankAccountsSection, BankAccountFormData } from './BankAccountsSection';

const BASE_URL = process.env.ADX_BASE_URL || 'https://adxmanager.dev';

export type FreightForwarderStatus = 'Active' | 'Inactive';

export interface FreightForwarderRow {
  company: string;
  location: string;
  contact: string;
  email: string;
}

/**
 * Fields for the Add Freight Forwarder / Edit Freight Forwarder forms. All
 * optional so a caller can submit a deliberately incomplete form (e.g. to
 * exercise validation) via `Partial<FreightForwarderFormData>`.
 */
export interface FreightForwarderFormData {
  companyName: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  contactName: string;
  telNumber: string;
  email: string;
  extensionNumber?: string;
  cellNumber?: string;
  fax?: string;
}

/**
 * FakeFiller-style random data (backed by @faker-js/faker) so tests never
 * hardcode a fixed company name that could collide across runs. Country is
 * deliberately NOT randomized — see SuppliersPage.buildFakeSupplierData for
 * why "United States" specifically is used.
 */
export function buildFakeFreightForwarderData(
  overrides: Partial<FreightForwarderFormData> = {}
): FreightForwarderFormData {
  const stamp = Date.now();
  return {
    companyName: `QA Automation ${faker.company.name()} ${stamp}`,
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    country: 'United States',
    zipCode: faker.location.zipCode('#####'),
    contactName: faker.person.fullName(),
    telNumber: `+1 ${faker.string.numeric(10)}`,
    email: `qa.ff.${stamp}.${faker.string.alphanumeric(6).toLowerCase()}@example.com`,
    extensionNumber: String(faker.number.int({ min: 100, max: 9999 })),
    cellNumber: `+1 ${faker.string.numeric(10)}`,
    fax: `+1 ${faker.string.numeric(10)}`,
    ...overrides,
  };
}

/**
 * https://adxmanager.dev/v2/service-providers/freight-forwarders
 *
 * Same overall drawer/KTUI-select mechanics as SuppliersPage (see that
 * file's doc comments for the full explanation of the icon-glyph
 * accessible-name quirk and the "data-kt-select" combobox), confirmed live
 * for this feature independently rather than assumed:
 *  - The "Create" submit button appears only once here (no desktop/mobile
 *    duplicate, unlike Suppliers) — "Save Changes" on the Edit drawer DOES
 *    still appear twice, so `.first()` is kept throughout regardless.
 *  - All fields marked "*" in the UI (Company Name, Street Address, City,
 *    State, Country, ZIP Code, Contact Name, Telephone Number, Email) are
 *    genuinely required server-side, and fail gracefully — no hidden
 *    required field and no unhandled-500 field, unlike Suppliers' Balance
 *    Timing/City. Confirmed live before relying on it.
 *  - The Location column here renders "{city}, {country}" — a different
 *    format from Suppliers' "{state}, {country}".
 *  - The Status filter is a "Filter" button that toggles a drawer
 *    (`#form-freight-forwarders-index-drawer`) with a single "Update" submit
 *    button — confirmed live to be a genuinely different mechanism from
 *    Suppliers' "Add Filter" dropdown + two identically-labelled "Apply"
 *    buttons (see SuppliersPage doc comment); do not assume they match.
 */
export class FreightForwardersPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  private get searchInput(): Locator {
    return this.page.getByPlaceholder('Search by company name, contact, location, or email...');
  }

  private get addButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Freight Forwarder' });
  }

  private get createDrawer(): Locator {
    return this.page.locator('#create-freight-forwarder-drawer');
  }

  private get editDrawer(): Locator {
    return this.page.locator('#edit-freight-forwarder-drawer');
  }

  private get filterButton(): Locator {
    // Verified live: preceded by a KTUI icon-font glyph (same accessible-name
    // quirk documented elsewhere in this app) — substring match, no `exact`.
    return this.page.getByRole('button', { name: 'Filter' });
  }

  private get filterDrawer(): Locator {
    return this.page.locator('#form-freight-forwarders-index-drawer');
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

  /** Drives the "Bank accounts" section shared verbatim with Suppliers/Customs Brokers (see BankAccountsSection.ts) — present in both the Create and Edit drawers here. */
  get bankAccounts(): BankAccountsSection {
    return new BankAccountsSection(this.page);
  }

  rowsContaining(term: string): Locator {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.tableRows.filter({ hasText: new RegExp(escaped, 'i') });
  }

  async goto(): Promise<void> {
    await this.page.goto(`${BASE_URL}/v2/service-providers/freight-forwarders`);
  }

  /** Re-navigates to the bare index URL to reset search/filters between scenarios. */
  async resetToCleanState(): Promise<void> {
    await this.page.goto(`${BASE_URL}/v2/service-providers/freight-forwarders`, { waitUntil: 'domcontentloaded' });
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
  async getRows(limit = 25): Promise<FreightForwarderRow[]> {
    return this.tableRows.evaluateAll(
      (rows: any[], max: number) =>
        rows.slice(0, max).map((row: any) => {
          const cells = row.querySelectorAll('td');
          const text = (i: number) => (cells[i]?.textContent ?? '').trim();
          return { company: text(0), location: text(1), contact: text(3), email: text(7) };
        }),
      limit
    );
  }

  /** Finds the first row with a real (non "—") value for the given field, so a search never runs on a placeholder dash. */
  async findRowWithValue(field: keyof FreightForwarderRow): Promise<FreightForwarderRow> {
    const rows = await this.getRows();
    const row = rows.find((r) => r[field] && r[field] !== '—');
    if (!row) throw new Error(`No row in the current view has a usable "${field}" value to search with.`);
    return row;
  }

  /**
   * Opens the "Filter" drawer, reconciles each status toggle to the desired
   * checked/unchecked state, then submits via its single "Update" button.
   * Reconciling against each checkbox's actual current state (rather than
   * blindly clicking every requested status) avoids the bug confirmed live
   * on Customs Brokers, whose "Active" toggle is pre-checked by default —
   * see CustomsBrokersPage.filterByStatus.
   */
  async filterByStatus(statuses: FreightForwarderStatus[]): Promise<void> {
    await this.filterButton.click();
    await this.filterDrawer.waitFor({ state: 'visible' });
    const allStatuses: FreightForwarderStatus[] = ['Active', 'Inactive'];
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

  private async fillForm(formSuffix: 'create' | 'edit', data: Partial<FreightForwarderFormData>): Promise<void> {
    const field = (name: string) => this.page.locator(`#${name}_${formSuffix}`);
    if (data.companyName !== undefined) await field('company_name').fill(data.companyName);
    if (data.address !== undefined) await field('address').fill(data.address);
    if (data.city !== undefined) await field('city').fill(data.city);
    if (data.state !== undefined) await field('state').fill(data.state);
    if (data.country !== undefined) await this.selectKtOption(`country_${formSuffix}`, data.country);
    if (data.zipCode !== undefined) await field('zip_code').fill(data.zipCode);
    if (data.contactName !== undefined) await field('contact_name').fill(data.contactName);
    if (data.telNumber !== undefined) await field('tel_number').fill(data.telNumber);
    if (data.extensionNumber !== undefined) await field('extension_number').fill(data.extensionNumber);
    if (data.cellNumber !== undefined) await field('cell_number').fill(data.cellNumber);
    if (data.email !== undefined) await field('email').fill(data.email);
    if (data.fax !== undefined) await field('fax').fill(data.fax);
  }

  async openAddDrawer(): Promise<void> {
    await this.addButton.click();
    await this.createDrawer.locator('#company_name_create').waitFor({ state: 'visible' });
  }

  /**
   * Fills and submits the Add drawer, leaving the resulting banner (success
   * or error) for the caller to assert. An optional `bankAccount` is added
   * to the same Bank Accounts section before submitting — it's part of the
   * same enclosing form, so it persists together with everything else in
   * one request rather than needing a separate save.
   */
  async submitCreateDrawer(data: Partial<FreightForwarderFormData>, options: { bankAccount?: BankAccountFormData } = {}): Promise<void> {
    await this.openAddDrawer();
    await this.fillForm('create', data);
    if (options.bankAccount) await this.bankAccounts.add(options.bankAccount);
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.createDrawer.getByRole('button', { name: 'Create', exact: true }).first().click(),
    ]);
  }

  async createFreightForwarder(data: FreightForwarderFormData, options: { bankAccount?: BankAccountFormData } = {}): Promise<void> {
    await this.submitCreateDrawer(data, options);
  }

  /**
   * Opens the Edit drawer for the first row whose text contains
   * `companyName`, via that row's kebab (⋮) menu. Scoped to the menu-link
   * class rather than role/text — see SuppliersPage.openEditFor for why a
   * substring role query on "Edit" is unsafe when the company name itself
   * might contain that word.
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

  async saveEdit(data: Partial<FreightForwarderFormData>, options: { bankAccount?: BankAccountFormData } = {}): Promise<void> {
    await this.fillForm('edit', data);
    if (options.bankAccount) await this.bankAccounts.add(options.bankAccount);
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.editDrawer.getByRole('button', { name: 'Save Changes', exact: true }).first().click(),
    ]);
  }

  /**
   * Deletes the first row whose text contains `companyName`, via its kebab
   * menu's "Delete" button — unlike Suppliers/Customs Brokers (which only
   * offer a "Deactivate" status toggle), this is the only Freight
   * Forwarders kebab action besides "Edit" and fires a native `confirm()`
   * dialog ("Are you sure you want to delete this freight forwarder?"),
   * confirmed live and auto-accepted here. On success this redirects to the
   * plain index with `successAlert` reading "Freight forwarder deleted
   * successfully." there, and the record disappears from the default
   * index search (confirmed via the "No freight forwarders found" empty
   * state, not a row count — a plain `rowsContaining` count after deletion
   * is unsafe here since that empty-state message itself renders inside a
   * `<tr>` echoing the searched term back, which would otherwise
   * false-positive as "found").
   *
   * Also confirmed live: unlike Products' soft delete (which redirects to a
   * detail page still rendering a "Deleted" badge), revisiting this
   * record's own detail URL afterward still returns HTTP 200 with the
   * *exact* pre-delete data intact — status still "Active", Edit/Delete
   * buttons still present, no "Deleted" indicator anywhere. It is a
   * genuinely different, undocumented-in-the-UI quirk worth its own
   * regression check rather than assuming it matches Products.
   */
  async deleteFor(companyName: string): Promise<void> {
    const row = this.rowsContaining(companyName).first();
    await row.locator('button.kt-menu-toggle').click();
    this.page.once('dialog', (dialog) => dialog.accept());
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      row.locator('button', { hasText: 'Delete' }).click(),
    ]);
  }

  /**
   * Opens the same kebab "Delete" button but dismisses the native
   * `confirm()` dialog instead of accepting it — confirmed live that this
   * leaves the record completely untouched (no navigation, no deletion),
   * same as Products' own cancel-delete behavior.
   */
  async cancelDeleteFor(companyName: string): Promise<void> {
    const row = this.rowsContaining(companyName).first();
    await row.locator('button.kt-menu-toggle').click();
    this.page.once('dialog', (dialog) => dialog.dismiss());
    await row.locator('button', { hasText: 'Delete' }).click();
  }
}
