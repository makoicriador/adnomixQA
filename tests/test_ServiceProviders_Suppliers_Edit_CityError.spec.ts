import { test, expect, Page, BrowserContext } from '@playwright/test';
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
 * Reproduces the blank-"City" bug documented in
 * test_ServiceProviders_Suppliers_Create_CityError.spec.ts and
 * .agent-memory/project_conventions.md — but via the Edit path instead of
 * Create, which nothing in this suite had exercised before. Confirmed live
 * on 2026-09-17: clearing "City" on an existing supplier and saving crashes
 * with the exact same unhandled 500 (SQLSTATE[23502] not-null violation on
 * "suppliers"."city"), just triggered by the PUT
 * `.../suppliers/{id}` update path (`app/V2/Http/Actions/Supplier/Update.php:71`)
 * rather than the POST create path. So the bug isn't specific to record
 * creation — any write that leaves City blank crashes the same way.
 *
 * This is intentionally a standalone, one-off evidence-capture spec (not
 * folded into the main Edit suite), for the same reason as its Create-path
 * sibling: asserting a crash page as "expected behavior" would bake the bug
 * in rather than guard against it. This file exists to record the bug for a
 * bug report, not as a regression gate — exclude it from routine full-suite
 * runs the same way as test_ServiceProviders_Suppliers_Create_CityError.
 */
test.describe('Service Providers > Suppliers Edit > City cleared (bug repro)', () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  let context: BrowserContext;
  let page: Page;
  let suppliers: SuppliersPage;

  test.beforeAll(async ({ browser }) => {
    test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
    test.setTimeout(60_000);

    // Step 1-2: log in and navigate to Suppliers inside a throwaway,
    // unrecorded context — the recording should start once we reach the
    // Suppliers index itself, not during login/navigation.
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    await new LoginPage(authPage).goto();
    await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
    await new HomePage(authPage).gotoV2Home();
    await new HomePage(authPage).navigateToSuppliers();
    const storageState = await authContext.storageState();
    await authContext.close();

    // Step 3-4: a fresh, already-authenticated context/page — recording (if
    // headed) starts here, and the first navigation is a direct hit of
    // /v2/service-providers/suppliers.
    context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      ...(isHeaded ? { recordVideo: { dir: 'test-results/videos', size: { width: 1440, height: 900 } } } : {}),
    });
    page = await context.newPage();

    suppliers = new SuppliersPage(page);
    await suppliers.goto();
  });

  test.afterAll(async () => {
    const video = page?.video();
    await context?.close();
    if (video) console.log('Recording saved to:', await video.path());
  });

  test('clearing City on an existing supplier and saving crashes with a raw 500 debug page', async () => {
    // A throwaway fixture with a real City, so the crash is caused by
    // clearing it during Edit — not by never having had one.
    const fixture = buildFakeSupplierData({ companyName: `QA Automation Fixture ${Date.now()}` });
    await suppliers.createSupplier(fixture);
    await expect(suppliers.successAlert.first()).toContainText('Supplier created successfully.');

    await suppliers.openEditFor(fixture.companyName);
    await suppliers.saveEdit({ city: '' });

    // The app never returns to a rendered state here — it's a full-page
    // navigation to Laravel's raw debug page, not a client-side alert like
    // the graceful validation cases. Asserting on the page's own error
    // heading rather than any app chrome, since none of the app's UI
    // survives this crash.
    await expect(page.getByText(/error|exception/i).first()).toBeVisible();

    // Deliberate manual pause (project_conventions.md otherwise says to
    // avoid page.waitForTimeout): this isn't waiting on app state, it's
    // padding the video recording 2 seconds past the crash so the captured
    // evidence isn't cut off the instant the assertion passes.
    if (isHeaded) await page.waitForTimeout(2_000);
  });
});
