import { test, expect, Page, BrowserContext } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { FreightForwardersPage, buildFakeFreightForwarderData } from '../pages/FreightForwardersPage';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

// Mirrors playwright.config.ts's detection (see its comment): this file
// runs inside a worker process, where `--headed` isn't in process.argv, so
// ADNOMIX_HEADED (set by the config in the main process, inherited by the
// worker) is the reliable signal here.
const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * End-to-end coverage for Service Providers > Freight Forwarders > Edit
 * Freight Forwarder on adxmanager.dev. The suite creates its own throwaway
 * fixture (rather than editing one of the real, pre-existing freight
 * forwarders) and edits that one across scenarios. One authenticated
 * session is shared across the suite (serial mode, and the tests
 * intentionally build on each other's state) since login is a real network
 * round trip against a live app.
 */
test.describe('Service Providers > Freight Forwarders Edit', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let freightForwarders: FreightForwardersPage;
  let currentCompanyName: string;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    // describe.configure({ timeout }) only applies to test bodies, not hooks —
    // beforeAll needs its own timeout extended explicitly for the real login
    // + navigation round trip against the live app, plus the fixture create.
    test.setTimeout(90_000);

    // Step 1-2: log in and navigate to Freight Forwarders (login -> /home ->
    // /v2/home -> sidebar) inside a throwaway, unrecorded context — the
    // request is to start the recording once we reach the Freight
    // Forwarders index itself, not during login/navigation.
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToFreightForwarders();
    const storageState = await authContext.storageState();
    await authContext.close();

    // Step 3-4: a fresh, already-authenticated context/page — recording (if
    // headed) starts here, and the very first navigation it performs is a
    // direct hit of /v2/service-providers/freight-forwarders (not another
    // pass through /v2/home + sidebar), so the recording begins exactly at
    // the URL under test rather than one step earlier.
    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();

    freightForwarders = new FreightForwardersPage(page);
    await freightForwarders.goto();

    // Fixture: a throwaway freight forwarder this suite edits, so it never
    // mutates one of the real freight forwarders the app otherwise has.
    // Deliberately does not contain the word "Edit" — the row's own "Edit"
    // action link is matched by a substring CSS filter, and a company name
    // containing that word would collide with it (see openEditFor).
    const fixture = buildFakeFreightForwarderData({ companyName: `QA Automation Fixture ${Date.now()}` });
    await freightForwarders.createFreightForwarder(fixture);
    await expect(freightForwarders.successAlert.first()).toContainText('Freight forwarder created successfully.');
    currentCompanyName = fixture.companyName;
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
  });

  test.beforeEach(async () => {
    await freightForwarders.resetToCleanState();
  });

  test("updates a freight forwarder's contact details", async () => {
    const updated = {
      contactName: faker.person.fullName(),
      telNumber: `+1 ${faker.string.numeric(10)}`,
      email: `qa.ff.edited.${Date.now()}@example.com`,
      fax: `+1 ${faker.string.numeric(10)}`,
    };

    await freightForwarders.openEditFor(currentCompanyName);
    await freightForwarders.saveEdit(updated);

    // Verified against the live app: a successful Save Changes redirects
    // from ".../<id>/edit" to the plain ".../<id>" detail page, where the
    // success banner and the updated fields both render.
    await expect(freightForwarders.successAlert.first()).toContainText('Freight forwarder updated successfully.');
    const detail = page.locator('main#content');
    await expect(detail).toContainText(updated.contactName);
    await expect(detail).toContainText(updated.telNumber);
    await expect(detail).toContainText(updated.email);
  });

  test("updates a freight forwarder's company name and location", async () => {
    const newCompanyName = `${currentCompanyName} (Updated)`;
    const newCity = faker.location.city();
    const newState = faker.location.state();

    await freightForwarders.openEditFor(currentCompanyName);
    await freightForwarders.saveEdit({ companyName: newCompanyName, city: newCity, state: newState, country: 'United States' });

    await expect(freightForwarders.successAlert.first()).toContainText('Freight forwarder updated successfully.');
    await expect(page.getByRole('heading', { name: newCompanyName, exact: true })).toBeVisible();
    currentCompanyName = newCompanyName;

    // Confirm the index list (not just the detail page) reflects both the
    // rename and the new "{city}, {country}" location.
    await freightForwarders.resetToCleanState();
    await freightForwarders.search(newCompanyName);
    const row = freightForwarders.rowsContaining(newCompanyName).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(`${newCity}, United States`);
  });

  test('shows a validation error when Company Name is cleared', async () => {
    await freightForwarders.openEditFor(currentCompanyName);
    await freightForwarders.saveEdit({ companyName: '' });
    await expect(freightForwarders.errorAlert.first()).toContainText('The company name field is required.');

    await freightForwarders.resetToCleanState();
    await freightForwarders.search(currentCompanyName);
    await expect(freightForwarders.rowsContaining(currentCompanyName).first()).toBeVisible();
  });
});
