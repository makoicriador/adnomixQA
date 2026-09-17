import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

const BASE_URL = process.env.ADX_BASE_URL || 'https://adxmanager.dev';

/**
 * https://adxmanager.dev/v2/home
 * Post-login the app lands on the legacy /home URL; the v2 shell (and its
 * left sidebar) lives at /v2/home. "Service Providers" is a collapsed
 * sidebar accordion header (not an <a>), so it's targeted by text rather
 * than role=link; its children ("Suppliers", etc.) are real <a> links.
 */
export class HomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async gotoV2Home(): Promise<void> {
    await this.page.goto(`${BASE_URL}/v2/home`);
  }

  async navigateToSuppliers(): Promise<void> {
    // Verified against the live app: exact-text/role matching here resolves
    // to the wrong (or a hidden) element; a case-insensitive substring match
    // against the first hit is what the sidebar accordion actually needs.
    await this.page.getByText(/Service Providers/i).first().click();
    await Promise.all([
      this.page.waitForURL(/\/v2\/service-providers\/suppliers/, { timeout: 15_000 }),
      this.page.getByText(/Suppliers/i).first().click(),
    ]);
  }

  /** Same sidebar accordion quirk as navigateToSuppliers — confirmed live for this child link too. */
  async navigateToFreightForwarders(): Promise<void> {
    await this.page.getByText(/Service Providers/i).first().click();
    await Promise.all([
      this.page.waitForURL(/\/v2\/service-providers\/freight-forwarders/, { timeout: 15_000 }),
      this.page.getByText(/Freight Forwarders/i).first().click(),
    ]);
  }

  /** Same sidebar accordion quirk as navigateToSuppliers — confirmed live for this child link too. */
  async navigateToCustomsBrokers(): Promise<void> {
    await this.page.getByText(/Service Providers/i).first().click();
    await Promise.all([
      this.page.waitForURL(/\/v2\/service-providers\/customs-brokers/, { timeout: 15_000 }),
      this.page.getByText(/Customs Brokers/i).first().click(),
    ]);
  }

  /**
   * Same sidebar accordion quirk as navigateToSuppliers, but with one twist
   * confirmed live: a substring match on "Warehouses" hits the unrelated
   * "Warehouses Inventory" link first (it renders earlier in the sidebar) —
   * an exact-text match is required here specifically to land on Service
   * Providers > Warehouses instead.
   */
  async navigateToWarehouses(): Promise<void> {
    await this.page.getByText(/Service Providers/i).first().click();
    await Promise.all([
      this.page.waitForURL(/\/v2\/service-providers\/warehouses/, { timeout: 15_000 }),
      this.page.getByText('Warehouses', { exact: true }).first().click(),
    ]);
  }
}
