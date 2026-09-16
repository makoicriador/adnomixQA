import { Page, Locator } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { BasePage } from './BasePage';

const BASE_URL = process.env.ADX_BASE_URL || 'https://adxmanager.dev';

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

  /** Fills and submits the Add drawer, leaving the resulting banner (success or error) for the caller to assert. */
  async submitCreateDrawer(data: Partial<FreightForwarderFormData>): Promise<void> {
    await this.openAddDrawer();
    await this.fillForm('create', data);
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.createDrawer.getByRole('button', { name: 'Create', exact: true }).first().click(),
    ]);
  }

  async createFreightForwarder(data: FreightForwarderFormData): Promise<void> {
    await this.submitCreateDrawer(data);
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

  async saveEdit(data: Partial<FreightForwarderFormData>): Promise<void> {
    await this.fillForm('edit', data);
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.editDrawer.getByRole('button', { name: 'Save Changes', exact: true }).first().click(),
    ]);
  }
}
