import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

const BASE_URL = process.env.ADX_BASE_URL || 'https://adxmanager.dev';

/**
 * https://adxmanager.dev/system-login
 * Selectors verified against the live app: the form has no <label>
 * elements, so username/password are targeted by placeholder rather than
 * getByLabel.
 */
export class LoginPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto(): Promise<void> {
    await this.page.goto(`${BASE_URL}/system-login`);
  }

  async login(email: string, password: string): Promise<void> {
    await this.page.getByPlaceholder('Email').fill(email);
    await this.page.getByPlaceholder('Password').fill(password);
    await Promise.all([
      this.page.waitForURL(/\/home/, { timeout: 20_000 }),
      this.page.getByRole('button', { name: 'Login' }).click(),
    ]);
  }
}
