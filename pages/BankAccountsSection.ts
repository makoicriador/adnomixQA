import { Page, Locator } from '@playwright/test';
import { faker } from '@faker-js/faker';

export interface BankAccountFormData {
  beneficiaryName: string;
  bankName: string;
  bankAddress: string;
  country: string;
  swiftCode: string;
  accountNumber: string;
  routingNumber: string;
}

/**
 * FakeFiller-style random data (backed by @faker-js/faker) so tests never
 * hardcode a fixed account number that could collide across runs.
 */
export function buildFakeBankAccountData(overrides: Partial<BankAccountFormData> = {}): BankAccountFormData {
  return {
    beneficiaryName: faker.person.fullName(),
    bankName: `${faker.company.name()} Bank`,
    bankAddress: faker.location.streetAddress(),
    country: 'United States',
    swiftCode: faker.string.alphanumeric(8).toUpperCase(),
    accountNumber: faker.string.numeric(10),
    routingNumber: faker.string.numeric(9),
    ...overrides,
  };
}

/**
 * "Bank accounts" is an Alpine.js component (`BankAccountsForm`) rendered
 * verbatim inside the Create/Edit drawers of Suppliers, Freight Forwarders,
 * and Customs Brokers — confirmed live to be identical markup/behavior
 * across all three sections, so one helper drives all of them instead of
 * copy-pasting the same bindings three times. Warehouses has NO Bank
 * Accounts section at all (confirmed live: absent from both its Create and
 * Edit drawers) — do not attach this helper to WarehousesPage.
 *
 * The section is not part of the desktop/mobile duplicate-markup pattern
 * documented elsewhere in this app (confirmed live: exactly one
 * `x-data="BankAccountsForm(...)"` instance per page), so no `.first()` is
 * needed here the way it is for the surrounding Create/Save Changes buttons.
 *
 * Adding an account only stages it into the same enclosing `<form>` as the
 * rest of the drawer — there is no separate "save" action for this section;
 * the caller's own Create/Save Changes submit persists everything together.
 */
export class BankAccountsSection {
  constructor(private readonly page: Page) {}

  private get section(): Locator {
    return this.page.locator('section').filter({ has: this.page.locator('h4', { hasText: 'Bank accounts' }) });
  }

  private get addAccountButton(): Locator {
    // Verified live: preceded by a KTUI icon-font glyph (same accessible-name
    // quirk documented for "Add Supplier" et al.) — substring match, no `exact`.
    return this.section.getByRole('button', { name: 'Add account' });
  }

  /**
   * Drives the KTUI "data-kt-select" country combobox scoped to this section.
   * Unlike the page-level Country selects elsewhere in these forms, the bank
   * account's Country <select> has no static `id` (confirmed live) — it's
   * identified by its own `data-bank-country-select` attribute instead.
   */
  private async selectCountry(optionText: string): Promise<void> {
    const select = this.page.locator('[data-bank-country-select]');
    const wrapper = select.locator('xpath=following-sibling::div[@data-kt-select-wrapper]');
    await wrapper.locator('[data-kt-select-display]').click();
    const dropdown = wrapper.locator('[data-kt-select-dropdown]');
    const search = dropdown.locator('input[placeholder="Search..."]');
    if (await search.count()) await search.fill(optionText);
    await dropdown.getByRole('option', { name: optionText, exact: true }).click();
  }

  /**
   * Opens a fresh "Add account" edit panel and fills it. Does not submit —
   * the caller's Create/Save Changes button on the enclosing drawer persists
   * it as part of that same form submission.
   */
  async add(data: BankAccountFormData): Promise<void> {
    await this.addAccountButton.click();
    await this.page.getByLabel('Beneficiary name').fill(data.beneficiaryName);
    await this.page.getByLabel('Bank name').fill(data.bankName);
    await this.page.getByLabel('Bank address').fill(data.bankAddress);
    await this.selectCountry(data.country);
    await this.page.getByLabel('SWIFT / BIC').fill(data.swiftCode);
    await this.page.getByLabel('Account number / IBAN').fill(data.accountNumber);
    await this.page.getByLabel('Routing number').fill(data.routingNumber);
  }

  /** The account list row summarizing `${bank_name} · ${beneficiary_name} · ${masked_account_number}`, for post-save verification. */
  rowContaining(bankName: string): Locator {
    return this.section.locator('div').filter({ hasText: bankName }).last();
  }
}
