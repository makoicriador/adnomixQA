import { test, expect, Page, BrowserContext } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { CustomsBrokersPage, buildFakeCustomsBrokerData } from '../pages/CustomsBrokersPage';
import { buildFakeBankAccountData } from '../pages/BankAccountsSection';
import { attachPageHealthMonitor, describeIssues, PageIssue } from './utils/errorScraper';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Service Providers > Customs Brokers > Edit
 * Customs Broker on adxmanager.dev. The suite creates its own throwaway
 * fixture (rather than editing one of the real, pre-existing customs
 * brokers) and edits that one across scenarios. Unlike Suppliers/Freight
 * Forwarders, a row's kebab menu here has no "Edit" action — editing is
 * only reachable from the broker's own detail page (see
 * CustomsBrokersPage.openEditFor) — confirmed live, not assumed. One
 * authenticated session is shared across the suite (serial mode, and the
 * tests intentionally build on each other's state) since login is a real
 * network round trip against a live app.
 */
test.describe('Service Providers > Customs Brokers Edit', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let customsBrokers: CustomsBrokersPage;
  let issues: PageIssue[];
  let currentCompanyName: string;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    // describe.configure({ timeout }) only applies to test bodies, not hooks —
    // beforeAll needs its own timeout extended explicitly for the real login
    // + navigation round trip against the live app, plus the fixture create.
    test.setTimeout(90_000);

    // Step 1-2: log in and navigate to Customs Brokers (login -> /home ->
    // /v2/home -> sidebar) inside a throwaway, unrecorded context — the
    // request is to start the recording once we reach the Customs Brokers
    // index itself, not during login/navigation.
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToCustomsBrokers();
    const storageState = await authContext.storageState();
    await authContext.close();

    // Step 3-4: a fresh, already-authenticated context/page — recording (if
    // headed) starts here, and the very first navigation it performs is a
    // direct hit of /v2/service-providers/customs-brokers (not another pass
    // through /v2/home + sidebar), so the recording begins exactly at the
    // URL under test rather than one step earlier.
    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();
    issues = attachPageHealthMonitor(page);

    customsBrokers = new CustomsBrokersPage(page);
    await customsBrokers.goto();

    // Fixture: a throwaway customs broker this suite edits, so it never
    // mutates one of the real customs brokers the app otherwise has.
    const fixture = buildFakeCustomsBrokerData({ companyName: `QA Automation Fixture ${Date.now()}` });
    await customsBrokers.createCustomsBroker(fixture);
    await expect(customsBrokers.successAlert.first()).toContainText('Customs broker created successfully.');
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
    await customsBrokers.resetToCleanState();
  });

  test("updates a customs broker's contact details", async () => {
    const updated = {
      contactName: faker.person.fullName(),
      telNumber: `+1 ${faker.string.numeric(10)}`,
      email: `qa.cb.edited.${Date.now()}@example.com`,
      customsNotes: faker.lorem.sentence(),
    };

    await customsBrokers.openEditFor(currentCompanyName);
    await customsBrokers.saveEdit(updated);

    // Verified against the live app: unlike Suppliers/Freight Forwarders,
    // a successful Save Changes here stays on the same detail URL — the
    // edit drawer is a client-side overlay triggered from the detail page,
    // not a separate "/edit" page navigation.
    await expect(customsBrokers.successAlert.first()).toContainText('Customs broker updated successfully.');
    const detail = page.locator('main#content');
    await expect(detail).toContainText(updated.contactName);
    await expect(detail).toContainText(updated.telNumber);
    await expect(detail).toContainText(updated.email);
  });

  test("updates a customs broker's company name and location", async () => {
    const newCompanyName = `${currentCompanyName} (Updated)`;
    const newCity = faker.location.city();
    const newState = faker.location.state();

    await customsBrokers.openEditFor(currentCompanyName);
    await customsBrokers.saveEdit({ companyName: newCompanyName, city: newCity, state: newState, country: 'United States' });

    await expect(customsBrokers.successAlert.first()).toContainText('Customs broker updated successfully.');
    await expect(page.getByRole('heading', { name: newCompanyName, exact: true })).toBeVisible();
    currentCompanyName = newCompanyName;

    // Confirm the index list (not just the detail page) reflects both the
    // rename and the new "{city}, {state}, {country}" location.
    await customsBrokers.resetToCleanState();
    await customsBrokers.search(newCompanyName);
    const row = customsBrokers.rowsContaining(newCompanyName).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(`${newCity}, ${newState}, United States`);
  });

  test('adds a bank account to the customs broker', async () => {
    const bankAccount = buildFakeBankAccountData();

    await customsBrokers.openEditFor(currentCompanyName);
    await customsBrokers.saveEdit({}, { bankAccount });

    await expect(customsBrokers.successAlert.first()).toContainText('Customs broker updated successfully.');

    // Confirm it actually persisted — reopen the Edit drawer and check the
    // Bank Accounts section lists it.
    await customsBrokers.resetToCleanState();
    await customsBrokers.openEditFor(currentCompanyName);
    await expect(customsBrokers.bankAccounts.rowContaining(bankAccount.bankName)).toContainText(bankAccount.bankName);
  });

  test('shows a validation error when Company Name is cleared', async () => {
    await customsBrokers.openEditFor(currentCompanyName);
    await customsBrokers.saveEdit({ companyName: '' });
    await expect(customsBrokers.errorAlert.first()).toContainText('The company name field is required.');

    await customsBrokers.resetToCleanState();
    await customsBrokers.search(currentCompanyName);
    await expect(customsBrokers.rowsContaining(currentCompanyName).first()).toBeVisible();
  });
});
