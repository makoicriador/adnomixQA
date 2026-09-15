import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class UserLoginPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async fillEmailField(value: string): Promise<void> {
    // target: email field
    await this.page.getByLabel(/email/i).fill(value);
  }

  async fillPasswordField(value: string): Promise<void> {
    // target: password field
    await this.page.getByLabel(/password/i).fill(value);
  }

  async clickSubmitButton(): Promise<void> {
    // target: submit button
    await this.page.getByRole('button', { name: /log in/i }).click();
  }
}
