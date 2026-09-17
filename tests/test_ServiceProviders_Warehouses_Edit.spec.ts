import { test, expect, Page, BrowserContext } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { WarehousesPage, buildFakeWarehouseData } from '../pages/WarehousesPage';
import { attachPageHealthMonitor, describeIssues, PageIssue } from './utils/errorScraper';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Service Providers > Warehouses > Edit Warehouse on
 * adxmanager.dev. The suite creates its own throwaway fixture (rather than
 * editing one of the real, pre-existing warehouses) and edits that one
 * across scenarios. No Bank Accounts step here — confirmed live that
 * Warehouses has no Bank Accounts section at all (see
 * BankAccountsSection.ts / WarehousesPage.ts doc comments); that flow is
 * covered instead by the Suppliers/Freight Forwarders/Customs Brokers Edit
 * suites. One authenticated session is shared across the suite (serial
 * mode, and the tests intentionally build on each other's state) since
 * login is a real network round trip against a live app. A page-health
 * monitor (tests/utils/errorScraper.ts) watches the whole suite for
 * uncaught JS exceptions or same-origin 5xx responses.
 */
test.describe('Service Providers > Warehouses Edit', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let warehouses: WarehousesPage;
  let issues: PageIssue[];
  let currentCompanyName: string;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    test.setTimeout(90_000);

    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToWarehouses();
    const storageState = await authContext.storageState();
    await authContext.close();

    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();
    issues = attachPageHealthMonitor(page);

    warehouses = new WarehousesPage(page);
    await warehouses.goto();

    // Fixture: a throwaway warehouse this suite edits, so it never mutates
    // one of the real warehouses the Index suite reads. Deliberately does
    // not contain the word "Edit" — the row's own "Edit" action link is
    // matched by a substring CSS filter, and a company name containing that
    // word would collide with it (see WarehousesPage.openEditFor).
    const fixture = buildFakeWarehouseData({ companyName: `QA Automation Fixture ${Date.now()}` });
    await warehouses.createWarehouse(fixture);
    await expect(warehouses.successAlert.first()).toContainText('Warehouse created successfully.');
    currentCompanyName = fixture.companyName;
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
    if (issues.length) console.warn(`[Page health] ${issues.length} issue(s) detected:\n${describeIssues(issues)}`);
    expect(issues, 'No uncaught JS exceptions or 5xx server errors should occur during this suite').toEqual([]);
  });

  test.beforeEach(async () => {
    await warehouses.resetToCleanState();
  });

  test("updates a warehouse's contact details", async () => {
    const updated = {
      contactName: faker.person.fullName(),
      telNumber: `+1 ${faker.string.numeric(10)}`,
      email: `qa.wh.edited.${Date.now()}@example.com`,
      extensionNumber: String(faker.number.int({ min: 100, max: 9999 })),
    };

    await warehouses.openEditFor(currentCompanyName);
    await warehouses.saveEdit(updated);

    // Verified against the live app: a successful Save Changes redirects
    // from ".../<id>/edit" to the plain ".../<id>" detail page, same as
    // Suppliers/Freight Forwarders.
    await expect(warehouses.successAlert.first()).toContainText('Warehouse updated successfully.');
    const detail = page.locator('main#content');
    await expect(detail).toContainText(updated.contactName);
    await expect(detail).toContainText(updated.telNumber);
    await expect(detail).toContainText(updated.email);
  });

  test("updates a warehouse's company name and location", async () => {
    const newCompanyName = `${currentCompanyName} (Edited)`;
    const newCity = faker.location.city();
    const newState = faker.location.state();

    await warehouses.openEditFor(currentCompanyName);
    await warehouses.saveEdit({ companyName: newCompanyName, city: newCity, state: newState, country: 'United States' });

    await expect(warehouses.successAlert.first()).toContainText('Warehouse updated successfully.');
    await expect(page.getByRole('heading', { name: newCompanyName, exact: true })).toBeVisible();
    currentCompanyName = newCompanyName;

    // Confirm the index list (not just the detail page) reflects both the
    // rename and the new city/state — rendered as separate columns here,
    // unlike Suppliers/Freight Forwarders/Customs Brokers' single combined
    // "Location" column (see WarehousesPage doc comment).
    await warehouses.resetToCleanState();
    await warehouses.search(newCompanyName);
    const row = warehouses.rowsContaining(newCompanyName).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(newCity);
    await expect(row).toContainText(newState);
  });

  test('shows a validation error when Company Name is cleared', async () => {
    // Verified against the live app: clearing a "*"-marked required field
    // and saving fails gracefully — "The company name field is required."
    // — and, importantly, does not blank out the warehouse's existing name.
    await warehouses.openEditFor(currentCompanyName);
    await warehouses.saveEdit({ companyName: '' });
    await expect(warehouses.errorAlert.first()).toContainText('The company name field is required.');

    await warehouses.resetToCleanState();
    await warehouses.search(currentCompanyName);
    await expect(warehouses.rowsContaining(currentCompanyName).first()).toBeVisible();
  });
});
