import { test, expect, Page, BrowserContext } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { SuppliersPage, buildFakeSupplierData } from '../pages/SuppliersPage';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Service Providers > Suppliers > Edit Supplier on
 * adxmanager.dev. The suite creates its own throwaway supplier as a fixture
 * (rather than editing one of the real, pre-existing suppliers used by the
 * Index suite) and edits that one across two scenarios: its contact details,
 * then its company name and location. One authenticated session is shared
 * across the suite (serial mode, and the two tests intentionally build on
 * each other's state) since login is a real network round trip against a
 * live app.
 */
test.describe('Service Providers > Suppliers Edit', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let suppliers: SuppliersPage;
  let currentCompanyName: string;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    // describe.configure({ timeout }) only applies to test bodies, not hooks —
    // beforeAll needs its own timeout extended explicitly for the real login
    // + navigation round trip against the live app, plus the fixture create.
    test.setTimeout(90_000);

    // Step 1-2: log in and navigate to Suppliers (login -> /home -> /v2/home
    // -> sidebar) inside a throwaway, unrecorded context — the request is
    // to start the recording once we reach the Suppliers index itself, not
    // during login/navigation.
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToSuppliers();
    const storageState = await authContext.storageState();
    await authContext.close();

    // Step 3-4: a fresh, already-authenticated context/page — recording (if
    // headed) starts here, and the very first navigation it performs is a
    // direct hit of /v2/service-providers/suppliers (not another pass
    // through /v2/home + sidebar), so the recording begins exactly at the
    // URL under test rather than one step earlier.
    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();

    suppliers = new SuppliersPage(page);
    await suppliers.goto();

    // Fixture: a throwaway supplier this suite edits, so it never mutates
    // one of the real suppliers the Index suite reads. Deliberately does not
    // contain the word "Edit" — the row's own "Edit" action link matches
    // getByRole('link', { name: 'Edit' }) by substring (see openEditFor),
    // and a company name containing that word would collide with it.
    const fixture = buildFakeSupplierData({ companyName: `QA Automation Fixture ${Date.now()}` });
    await suppliers.createSupplier(fixture);
    await expect(suppliers.successAlert).toContainText('Supplier created successfully.');
    currentCompanyName = fixture.companyName;
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
  });

  test.beforeEach(async () => {
    await suppliers.resetToCleanState();
  });

  test("updates a supplier's contact details", async () => {
    const updated = {
      contactName: faker.person.fullName(),
      phone: `+1 ${faker.string.numeric(10)}`,
      email: `qa.automation.edited.${Date.now()}@example.com`,
      licenseNumber: faker.string.alphanumeric(10).toUpperCase(),
    };

    await suppliers.openEditFor(currentCompanyName);
    await suppliers.saveEdit(updated);

    // Verified against the live app: a successful Save Changes redirects
    // from ".../<id>/edit" to the plain ".../<id>" detail page, where the
    // success banner and the updated fields both render. Same duplicate-
    // markup pattern as the two "Create"/"Save Changes" submit buttons: the
    // banner itself is rendered twice (a desktop/mobile pair) — `.first()`
    // rather than assuming a single match.
    await expect(suppliers.successAlert.first()).toContainText('Supplier details updated successfully.');
    const detail = page.locator('main#content');
    await expect(detail).toContainText(updated.contactName);
    await expect(detail).toContainText(updated.phone);
    await expect(detail).toContainText(updated.email);
    await expect(detail).toContainText(updated.licenseNumber);
  });

  test("updates a supplier's company name and location", async () => {
    const newCompanyName = `${currentCompanyName} (Edited)`;
    const newState = faker.location.state();
    const newCity = faker.location.city();

    await suppliers.openEditFor(currentCompanyName);
    await suppliers.saveEdit({ companyName: newCompanyName, city: newCity, state: newState, country: 'United States' });

    await expect(suppliers.successAlert.first()).toContainText('Supplier details updated successfully.');
    await expect(page.getByRole('heading', { name: newCompanyName, exact: true })).toBeVisible();
    currentCompanyName = newCompanyName;

    // Confirm the index list (not just the detail page) reflects both the
    // rename and the new "{state}, {country}" location.
    await suppliers.resetToCleanState();
    await suppliers.search(newCompanyName);
    const row = suppliers.rowsContaining(newCompanyName).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(`${newState}, United States`);
  });

  test('shows a validation error when Company is cleared', async () => {
    // Verified against the live app: clearing a "*"-marked required field
    // and saving fails gracefully — "The company name field is required."
    // — and, importantly, does not blank out the supplier's existing name.
    await suppliers.openEditFor(currentCompanyName);
    await suppliers.saveEdit({ companyName: '' });
    await expect(suppliers.errorAlert.first()).toContainText('The company name field is required.');

    await suppliers.resetToCleanState();
    await suppliers.search(currentCompanyName);
    await expect(suppliers.rowsContaining(currentCompanyName).first()).toBeVisible();
  });
});
