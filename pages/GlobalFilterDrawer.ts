import { Page, Locator } from '@playwright/test';

export type FilterControlType = 'checkbox' | 'select';

/**
 * One page's Filter mechanism, confirmed live by crawling every page reachable
 * from https://adxmanager.dev/v2/home for a `[data-kt-drawer-toggle$="-index-drawer"]`
 * button (2026-09-18). All 24 discovered pages share the same KTUI drawer +
 * Alpine.js mechanics (a "Filter" button toggling `#form-<page>-index-drawer`,
 * a single "Update" submit button, a "Reset" button with its own
 * `onclick="window.location.href=...".` target) — but each page's actual
 * filter fields (name, values, checkbox vs. KTUI multi-select combobox) are
 * page-specific and were read directly from each page's live markup rather
 * than assumed to match a sibling page. `paramName`/`optionValue` are the
 * exact `name`/`value` a real live control uses; `optionLabel` is the exact
 * visible text a user would click.
 */
export interface FilterPageConfig {
  name: string;
  path: string;
  drawerId: string;
  controlType: FilterControlType;
  paramName: string;
  optionLabel: string;
  optionValue: string;
}

/**
 * Drives the shared "Filter" drawer component present on ~24 pages across
 * the app. Confirmed live: the toggle button's accessible text is not
 * consistent site-wide (plain "Filter" almost everywhere, but "Filter
 * Applied" on Order Payments when a filter is already active by default) —
 * so this locates the button by its `data-kt-drawer-toggle` attribute
 * instead of by role/name text, which is stable everywhere.
 */
export class GlobalFilterDrawer {
  constructor(private readonly page: Page, private readonly drawerId: string) {}

  get toggleButton(): Locator {
    return this.page.locator(`[data-kt-drawer-toggle="${this.drawerId}"]`).first();
  }

  get drawer(): Locator {
    return this.page.locator(this.drawerId);
  }

  get closeButton(): Locator {
    return this.drawer.locator('[data-kt-drawer-dismiss]').first();
  }

  get updateButton(): Locator {
    return this.drawer.getByRole('button', { name: 'Update', exact: true });
  }

  get resetButton(): Locator {
    return this.drawer.getByRole('button', { name: 'Reset', exact: true });
  }

  async open(): Promise<void> {
    await this.toggleButton.click();
    await this.drawer.waitFor({ state: 'visible' });
  }

  async close(): Promise<void> {
    await this.closeButton.click();
    await this.drawer.waitFor({ state: 'hidden' });
  }

  /**
   * Checks a checkbox/radio-style filter option identified by its exact
   * `name`+`value` (not its visible label text) — confirmed live that at
   * least one page (Order Payments/Export Sales' "Balance" filter) renders
   * a preset *button* with the identical visible text right next to the
   * real `<label>` wrapping the actual input (a `setPreset()` convenience,
   * distinct from the filter control itself), which makes text-based
   * matching ambiguous. Locating by the underlying input's own attributes
   * sidesteps that regardless of how any given page's markup happens to
   * duplicate the label text elsewhere.
   *
   * Only clicks if not already checked — confirmed live (see
   * CustomsBrokersPage.filterByStatus and project_conventions.md) that some
   * of these groups pre-check a default option, and blindly clicking would
   * silently uncheck it instead.
   */
  async ensureCheckboxOption(paramName: string, optionValue: string): Promise<void> {
    const input = this.drawer.locator(`input[name="${paramName}"][value="${optionValue}"]`).first();
    const alreadyChecked = await input.isChecked().catch(() => false);
    if (!alreadyChecked) {
      // The input itself is visually hidden (class="hidden"); its enclosing
      // <label> is the actual clickable surface.
      await input.locator('xpath=ancestor::label[1]').click();
    }
  }

  /**
   * Drives a KTUI "data-kt-select" multi-select combobox filter (e.g. Brand,
   * Corporation, Account) by its `name` attribute — several of these share
   * the same visible "Select..." placeholder, so `name` (not id) is the
   * reliable way to scope to the right one.
   */
  async selectComboboxOption(paramName: string, optionLabel: string): Promise<void> {
    const select = this.drawer.locator(`select[name="${paramName}"]`);
    const wrapper = select.locator('xpath=following-sibling::div[@data-kt-select-wrapper]');
    await wrapper.locator('[data-kt-select-display]').click();
    const dropdown = wrapper.locator('[data-kt-select-dropdown]');
    const search = dropdown.locator('input[placeholder="Search..."]');
    if (await search.count()) await search.fill(optionLabel);
    await dropdown.getByRole('option', { name: optionLabel, exact: true }).click();
  }

  /** Picks the option per `config.controlType`, without submitting. */
  async pickConfiguredOption(config: FilterPageConfig): Promise<void> {
    if (config.controlType === 'checkbox') {
      await this.ensureCheckboxOption(config.paramName, config.optionValue);
    } else {
      await this.selectComboboxOption(config.paramName, config.optionLabel);
    }
  }

  async submit(): Promise<void> {
    await Promise.all([this.page.waitForLoadState('domcontentloaded'), this.updateButton.click()]);
  }

  async clickReset(): Promise<void> {
    await Promise.all([this.page.waitForLoadState('domcontentloaded'), this.resetButton.click()]);
  }
}
