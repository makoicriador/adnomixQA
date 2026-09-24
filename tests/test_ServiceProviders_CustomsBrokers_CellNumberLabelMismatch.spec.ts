import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { CustomsBrokersPage, buildFakeCustomsBrokerData } from '../pages/CustomsBrokersPage';

const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

const isHeaded = process.env.ADNOMIX_HEADED === '1' || process.argv.includes('--headed');

/**
 * Evidence capture for a confirmed live typo, not a functional issue (see
 * .agent-memory/project_conventions.md, 2026-09-19 field-round-trip entry):
 * the Add/Edit Customs Broker form labels this field "Cell Number", but the
 * broker's own detail page labels the identical value "Cellphone Number".
 * Same field, same value, just inconsistent wording — a one-line text fix,
 * not a data or behavior bug. Standalone evidence-capture spec, not part of
 * the routine suite.
 */
test.describe('Service Providers > Customs Brokers > "Cell Number" / "Cellphone Number" label typo', () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let customsBrokers: CustomsBrokersPage;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    test.setTimeout(60_000);

    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToCustomsBrokers();
    const storageState = await authContext.storageState();
    await authContext.close();

    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();

    const home = new HomePage(page);
    await home.gotoV2Home();
    await home.navigateToCustomsBrokers();
    customsBrokers = new CustomsBrokersPage(page);
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
  });

  test('the form\'s "Cell Number" field is relabeled "Cellphone Number" on the detail page', async () => {
    const data = buildFakeCustomsBrokerData();

    // First pass: just open the drawer to show the form's own "Cell Number"
    // label, then cancel — a separate pass creates the real fixture below,
    // since `createCustomsBroker` opens the drawer itself and a second,
    // already-open drawer would intercept its own "Add" button click.
    await customsBrokers.openAddDrawer();
    const cellNumberLabel = page.getByText('Cell Number', { exact: false }).first();
    await cellNumberLabel.scrollIntoViewIfNeeded();
    await expect(cellNumberLabel).toBeVisible();
    if (isHeaded) await page.waitForTimeout(1_000);
    await page.locator('#create-customs-broker-drawer').getByRole('button', { name: 'Cancel', exact: true }).first().click();

    await customsBrokers.createCustomsBroker(data);
    await expect(customsBrokers.successAlert.first()).toContainText('Customs broker created successfully.');

    await customsBrokers.search(data.companyName);
    const row = customsBrokers.rowsContaining(data.companyName).first();
    await Promise.all([
      page.waitForURL(/\/service-providers\/customs-brokers\/[^/]+$/, { timeout: 15_000 }),
      row.locator('td').first().locator('a').first().click(),
    ]);

    // The mismatch: same value, different label on the detail page.
    const cellphoneLabel = page.getByText('Cellphone Number', { exact: false }).first();
    await cellphoneLabel.scrollIntoViewIfNeeded();
    await expect(cellphoneLabel).toBeVisible();
    await expect(page.locator('main#content')).toContainText(data.cellNumber);

    if (isHeaded) await page.waitForTimeout(2_000);
  });
});
