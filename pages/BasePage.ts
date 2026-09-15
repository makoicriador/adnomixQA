import { Page, Locator } from '@playwright/test';

/**
 * Shared base class for all Page Object Models.
 * The Generator agent extends this for every new page it scaffolds, so
 * common navigation/wait helpers only need to live in one place.
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  async goto(path: string): Promise<void> {
    await this.page.goto(path);
  }

  protected byRole(...args: Parameters<Page['getByRole']>): Locator {
    return this.page.getByRole(...args);
  }

  protected byTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  protected byLabel(text: string | RegExp): Locator {
    return this.page.getByLabel(text);
  }

  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }
}
