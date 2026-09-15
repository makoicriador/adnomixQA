import { Page, Locator, Download } from '@playwright/test';
import { BasePage } from './BasePage';

const BASE_URL = process.env.ADX_BASE_URL || 'https://adxmanager.dev';

export type SupplierStatus = 'Active' | 'Inactive';

export interface SupplierRow {
  supplier: string;
  location: string;
  contact: string;
  email: string;
}

/**
 * https://adxmanager.dev/v2/service-providers/suppliers
 *
 * The search bar, status filter, and CSV export all submit one Alpine.js
 * GET form (id="form-suppliers-index"). There are two distinct "Apply"
 * buttons with identical accessible names:
 *   - an inner one inside the Status filter popover that only stages the
 *     selection (adds a "Status: ..." chip to the toolbar), and
 *   - an outer one (button[type=submit][form=form-suppliers-index]) that
 *     actually submits the form and reloads the page with the filter query
 *     params applied.
 * Both must be clicked, in that order, for a status filter to take effect —
 * verified against the live app, not assumed.
 */
export class SuppliersPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  private get searchInput(): Locator {
    return this.page.getByPlaceholder('Search by supplier name, contact, location, or email...');
  }

  private get addFilterButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Filter' });
  }

  private get statusFilterMenuItem(): Locator {
    return this.page.getByRole('link', { name: 'Status', exact: true });
  }

  private get filterControlGroup(): Locator {
    return this.page.locator('#filterControlGroup');
  }

  private get applyOuterButton(): Locator {
    return this.page.locator('button[type="submit"][form="form-suppliers-index"]');
  }

  private get clearAllLink(): Locator {
    return this.page.getByRole('link', { name: 'Clear All' });
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

  /**
   * The Status chip's label ("Status:") and its selected values render as two
   * separate sibling <span>s inside an unlabelled chip <div> — expose the
   * parent so a caller gets both in one web-first assertion
   * (`expect(suppliers.statusChip).toContainText('Active')`), auto-retrying
   * instead of a manual read-then-compare.
   */
  get statusChip(): Locator {
    return this.page.getByText('Status:', { exact: true }).locator('xpath=..');
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

  /** Opens Add Filter > Status, toggles the given statuses, then applies via both the panel's and the form's Apply buttons. */
  async filterByStatus(statuses: SupplierStatus[]): Promise<void> {
    await this.addFilterButton.click();
    await this.statusFilterMenuItem.click();
    for (const status of statuses) {
      await this.filterControlGroup.getByText(status, { exact: true }).click();
    }
    await this.filterControlGroup.getByRole('button', { name: 'Apply' }).click();
    await Promise.all([this.page.waitForLoadState('domcontentloaded'), this.applyOuterButton.click()]);
  }

  async clearAllFilters(): Promise<void> {
    if (await this.clearAllLink.count()) {
      await Promise.all([this.page.waitForLoadState('domcontentloaded'), this.clearAllLink.click()]);
    }
  }

  async downloadCsv(): Promise<Download> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 20_000 }),
      this.downloadCsvLink.click(),
    ]);
    return download;
  }
}
