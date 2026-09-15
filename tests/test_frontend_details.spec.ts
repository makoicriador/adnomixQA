import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { LoginPage } from '../pages/LoginPage';

/**
 * Cross-page frontend consistency audit for ADX Manager.
 *
 * This is a data-mining crawl, not a pass/fail suite: it visits every page
 * in PAGES under both the light and dark theme, extracts computed styles
 * for the shared shell (header/sidebar/footer/breadcrumb), typography,
 * buttons, forms, tables, and badges, then works out — per property — what
 * the *majority* of pages do (the de-facto "standard") and which pages
 * deviate from it. Output is a CSV report plus per-page/per-mode
 * screenshots as evidence.
 *
 * Dark mode here is NOT tied to the OS `prefers-color-scheme` (verified:
 * emulating it has no effect) — it's a manual Metronic theme switch backed
 * by `localStorage['kt-theme']`. We set it via `context.addInitScript()`
 * rather than clicking the UI toggle, so every page loads pre-themed.
 *
 * Scope explicitly NOT covered by this automated crawl (documented, not
 * fabricated): modals, alerts/toasts, and loading/error states. Those need
 * per-page interaction scripting or forced failure conditions and are
 * called out in the summary as follow-up manual review items.
 */

const BASE_URL = process.env.ADX_BASE_URL || 'https://adxmanager.dev';
const USERNAME = process.env.ADX_USERNAME;
const PASSWORD = process.env.ADX_PASSWORD;

const AUDIT_DIR = path.resolve(__dirname, '..', 'frontend-audit');
const SCREENSHOTS_DIR = path.join(AUDIT_DIR, 'screenshots');
const CSV_PATH = path.join(AUDIT_DIR, 'frontend-consistency-audit-v2.csv');
const RAW_JSON_PATH = path.join(AUDIT_DIR, 'raw-snapshots.json');

const PAGES = [
  { slug: 'home', name: 'Home (Dashboard)', path: '/v2/home' },
  { slug: 'inventory-all', name: 'Inventory - All', path: '/v2/inventory/all' },
  { slug: 'orders', name: 'Orders', path: '/v2/orders' },
  { slug: 'shipments', name: 'Shipments', path: '/v2/shipments' },
  { slug: 'ready-to-ship', name: 'Ready To Ship', path: '/v2/ready-to-ship' },
  { slug: 'inventory-warehouses', name: 'Inventory Warehouses', path: '/v2/inventory-warehouses' },
  { slug: 'products', name: 'Products', path: '/v2/products' },
  { slug: 'brands', name: 'Brands', path: '/v2/brands' },
  { slug: 'categories', name: 'Categories', path: '/v2/categories' },
  { slug: 'suppliers', name: 'Service Providers - Suppliers', path: '/v2/service-providers/suppliers' },
  { slug: 'freight-forwarders', name: 'Service Providers - Freight Forwarders', path: '/v2/service-providers/freight-forwarders' },
  { slug: 'customs-brokers', name: 'Service Providers - Customs Brokers', path: '/v2/service-providers/customs-brokers' },
  { slug: 'sp-warehouses', name: 'Service Providers - Warehouses', path: '/v2/service-providers/warehouses' },
] as const;

type Mode = 'light' | 'dark';

interface FrontendSnapshot {
  header: { bgColor: string; height: string; boxShadow: string; position: string } | null;
  sidebar: { bgColor: string; width: string; borderColor: string } | null;
  sidebarItem: { fontSize: string; fontWeight: string; color: string } | null;
  footer: { present: boolean; bgColor: string; color: string; fontSize: string };
  breadcrumb: { present: boolean; fontSize: string; color: string; fontWeight: string };
  pageTitle: { present: boolean; text: string; fontSize: string; fontWeight: string; color: string; fontFamily: string };
  sectionHeading: { present: boolean; fontSize: string; fontWeight: string };
  bodyText: { fontFamily: string; fontSize: string; lineHeight: string; color: string };
  primaryButton: { present: boolean; bgColor: string; color: string; borderRadius: string; fontSize: string; fontWeight: string; paddingTop: string; paddingLeft: string };
  searchInput: { present: boolean; borderColor: string; borderRadius: string; fontSize: string };
  table: {
    present: boolean;
    headerCellBgColor: string;
    headerRowBgColor: string;
    headerBorderWidth: string;
    headerFontSize: string;
    headerFontWeight: string;
    headerTextAlign: string;
    headerColor: string;
    cellPaddingTop: string;
    cellPaddingLeft: string;
    rowCount: number;
  };
  badge: { present: boolean; borderRadius: string; fontSize: string; bgColor: string; statusLabels: string };
  emptyState: { present: boolean };
  mainContent: { maxWidth: string; paddingLeft: string };
}

interface ResponsiveSnapshot {
  sidebarVisible: boolean;
  hamburgerVisible: boolean;
}

/** Everything here runs inside the browser via page.evaluate(). Keep every
 * binding a VALUE (const x = ...), never a named function — tsx/esbuild
 * injects a `__name()` helper for named functions that doesn't exist in
 * the isolated page context, and the call throws ReferenceError. Anonymous
 * arrows passed straight to .map()/.filter() are fine. */
async function extractSnapshot(page: Page): Promise<FrontendSnapshot> {
  return page.evaluate(() => {
    const header = document.querySelector('#header');
    const headerStyle = header ? getComputedStyle(header) : null;

    const sidebar = document.querySelector('#sidebar');
    const sidebarStyle = sidebar ? getComputedStyle(sidebar) : null;

    // Sample a top-level item that is never the current section on any of
    // the 13 audited pages ("Reports"), not just "the first nav item" —
    // that would sometimes be the *active* item (different color/weight by
    // design) and sometimes not, comparing active-vs-inactive state rather
    // than a real cross-page inconsistency.
    const sidebarItemCandidates = Array.from(document.querySelectorAll('#sidebar .kt-menu-title'));
    const sidebarItem = sidebarItemCandidates.find((el) => (el.textContent || '').trim() === 'Reports') || sidebarItemCandidates[0] || null;
    const sidebarItemStyle = sidebarItem ? getComputedStyle(sidebarItem) : null;

    const footer = document.querySelector('footer');
    const footerStyle = footer ? getComputedStyle(footer) : null;

    const breadcrumbSpan = document.querySelector('#desktopBreadcrumbs span');
    const breadcrumbStyle = breadcrumbSpan ? getComputedStyle(breadcrumbSpan) : null;

    const h1 = document.querySelector('h1');
    const h1Style = h1 ? getComputedStyle(h1) : null;

    const heading2 = document.querySelector('.kt-card-title');
    const heading2Style = heading2 ? getComputedStyle(heading2) : null;

    const bodyStyle = getComputedStyle(document.body);

    const primaryBtn = document.querySelector('.kt-btn-primary');
    const primaryBtnStyle = primaryBtn ? getComputedStyle(primaryBtn) : null;

    const searchInput = document.querySelector('input[type="text"], input[type="search"]');
    const searchInputStyle = searchInput ? getComputedStyle(searchInput) : null;

    const table = document.querySelector('table');
    const tableHeaderRow = table ? table.querySelector('thead tr') : null;
    const tableHeaderCell = table ? table.querySelector('thead th') : null;
    const tableHeaderRowStyle = tableHeaderRow ? getComputedStyle(tableHeaderRow) : null;
    const tableHeaderStyle = tableHeaderCell ? getComputedStyle(tableHeaderCell) : null;
    const tableDataCell = table ? table.querySelector('tbody td') : null;
    const tableDataCellStyle = tableDataCell ? getComputedStyle(tableDataCell) : null;
    const tableRowCount = table ? table.querySelectorAll('tbody tr').length : 0;

    // The visible header background is a composite of the <th>'s own
    // (semi-transparent) background painted over whatever the <tr> behind it
    // provides — comparing only the <th> hides row-level bg classes that
    // change what a user actually sees, so both are captured separately.
    const badgeCandidate = document.querySelector(
      'table td [class*="rounded-full"], table td [class*="rounded-md"][class*="bg-"], table td [class*="badge" i]'
    );
    const badgeStyle = badgeCandidate ? getComputedStyle(badgeCandidate) : null;
    const statusHeaderCell = table
      ? Array.from(table.querySelectorAll('thead th')).find((el) => (el.textContent || '').trim().toLowerCase() === 'status')
      : null;
    const statusColumnIndex = statusHeaderCell
      ? Array.from(statusHeaderCell.parentElement!.children).indexOf(statusHeaderCell)
      : -1;
    const statusLabelsFound =
      statusColumnIndex >= 0
        ? Array.from(new Set(
            Array.from(table!.querySelectorAll('tbody tr')).map((row) => (row.children[statusColumnIndex]?.textContent || '').trim())
          )).filter((t) => t.length > 0 && t.length < 20)
        : [];

    const mainEl = document.querySelector('main');
    const mainStyle = mainEl ? getComputedStyle(mainEl) : null;
    const mainInnerContainer = mainEl ? mainEl.querySelector(':scope > div') : null;
    const mainInnerStyle = mainInnerContainer ? getComputedStyle(mainInnerContainer) : null;

    const bodyTextLower = (document.body.textContent || '').toLowerCase();
    const emptyIndicatorPresent =
      tableRowCount === 0 &&
      (bodyTextLower.includes('no results') ||
        bodyTextLower.includes('no data') ||
        bodyTextLower.includes('nothing found') ||
        bodyTextLower.includes('0 of 0'));

    return {
      header: header
        ? { bgColor: headerStyle!.backgroundColor, height: headerStyle!.height, boxShadow: headerStyle!.boxShadow, position: headerStyle!.position }
        : null,
      sidebar: sidebar ? { bgColor: sidebarStyle!.backgroundColor, width: sidebarStyle!.width, borderColor: sidebarStyle!.borderRightColor } : null,
      sidebarItem: sidebarItem
        ? { fontSize: sidebarItemStyle!.fontSize, fontWeight: sidebarItemStyle!.fontWeight, color: sidebarItemStyle!.color }
        : null,
      footer: {
        present: !!footer,
        bgColor: footer ? footerStyle!.backgroundColor : '',
        color: footer ? footerStyle!.color : '',
        fontSize: footer ? footerStyle!.fontSize : '',
      },
      breadcrumb: {
        present: !!breadcrumbSpan,
        fontSize: breadcrumbSpan ? breadcrumbStyle!.fontSize : '',
        color: breadcrumbSpan ? breadcrumbStyle!.color : '',
        fontWeight: breadcrumbSpan ? breadcrumbStyle!.fontWeight : '',
      },
      pageTitle: {
        present: !!h1,
        text: h1 ? (h1.textContent || '').trim() : '',
        fontSize: h1 ? h1Style!.fontSize : '',
        fontWeight: h1 ? h1Style!.fontWeight : '',
        color: h1 ? h1Style!.color : '',
        fontFamily: h1 ? h1Style!.fontFamily : '',
      },
      sectionHeading: {
        present: !!heading2,
        fontSize: heading2 ? heading2Style!.fontSize : '',
        fontWeight: heading2 ? heading2Style!.fontWeight : '',
      },
      bodyText: { fontFamily: bodyStyle.fontFamily, fontSize: bodyStyle.fontSize, lineHeight: bodyStyle.lineHeight, color: bodyStyle.color },
      primaryButton: {
        present: !!primaryBtn,
        bgColor: primaryBtn ? primaryBtnStyle!.backgroundColor : '',
        color: primaryBtn ? primaryBtnStyle!.color : '',
        borderRadius: primaryBtn ? primaryBtnStyle!.borderRadius : '',
        fontSize: primaryBtn ? primaryBtnStyle!.fontSize : '',
        fontWeight: primaryBtn ? primaryBtnStyle!.fontWeight : '',
        paddingTop: primaryBtn ? primaryBtnStyle!.paddingTop : '',
        paddingLeft: primaryBtn ? primaryBtnStyle!.paddingLeft : '',
      },
      searchInput: {
        present: !!searchInput,
        borderColor: searchInput ? searchInputStyle!.borderColor : '',
        borderRadius: searchInput ? searchInputStyle!.borderRadius : '',
        fontSize: searchInput ? searchInputStyle!.fontSize : '',
      },
      table: {
        present: !!table,
        headerCellBgColor: tableHeaderCell ? tableHeaderStyle!.backgroundColor : '',
        headerRowBgColor: tableHeaderRow ? tableHeaderRowStyle!.backgroundColor : '',
        headerBorderWidth: tableHeaderCell ? tableHeaderStyle!.borderWidth : '',
        headerFontSize: tableHeaderCell ? tableHeaderStyle!.fontSize : '',
        headerFontWeight: tableHeaderCell ? tableHeaderStyle!.fontWeight : '',
        headerTextAlign: tableHeaderCell ? tableHeaderStyle!.textAlign : '',
        headerColor: tableHeaderCell ? tableHeaderStyle!.color : '',
        cellPaddingTop: tableDataCell ? tableDataCellStyle!.paddingTop : '',
        cellPaddingLeft: tableDataCell ? tableDataCellStyle!.paddingLeft : '',
        rowCount: tableRowCount,
      },
      badge: {
        present: !!badgeCandidate,
        borderRadius: badgeCandidate ? badgeStyle!.borderRadius : '',
        fontSize: badgeCandidate ? badgeStyle!.fontSize : '',
        bgColor: badgeCandidate ? badgeStyle!.backgroundColor : '',
        statusLabels: statusLabelsFound.join('/'),
      },
      emptyState: { present: emptyIndicatorPresent },
      mainContent: {
        maxWidth: mainInnerStyle ? mainInnerStyle.maxWidth : mainStyle ? mainStyle.maxWidth : '',
        paddingLeft: mainInnerStyle ? mainInnerStyle.paddingLeft : mainStyle ? mainStyle.paddingLeft : '',
      },
    };
  });
}

async function extractResponsive(page: Page): Promise<ResponsiveSnapshot> {
  return page.evaluate(() => {
    const sidebar = document.querySelector('#sidebar');
    const hamburger = document.querySelector('[data-kt-drawer-toggle="#sidebar"]');
    return {
      sidebarVisible: sidebar ? (sidebar as HTMLElement).offsetParent !== null : false,
      hamburgerVisible: hamburger ? (hamburger as HTMLElement).offsetParent !== null : false,
    };
  });
}

interface PageRecord {
  slug: string;
  name: string;
  url: string;
  light: FrontendSnapshot;
  dark: FrontendSnapshot;
  responsive: ResponsiveSnapshot;
}

/**
 * getComputedStyle() returns colors in whatever color space the CSS was
 * authored in — this app uses Tailwind v4's oklch()/oklab(), which reads
 * as noise to a non-technical reader. Chromium doesn't expose a
 * color-space conversion API directly, but <canvas> will always resolve
 * any valid CSS color to plain sRGB when you read its pixels back — that's
 * the trick used here to turn every color into a normal #RRGGBB hex code
 * for the report.
 */
async function colorsToHex(page: Page, colors: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(colors.filter(Boolean)));
  const result = await page.evaluate((inputColors: string[]) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const out: Record<string, string> = {};
    inputColors.forEach((color) => {
      try {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        if (data[3] === 0) {
          out[color] = 'transparent';
        } else {
          const r = data[0].toString(16).padStart(2, '0');
          const g = data[1].toString(16).padStart(2, '0');
          const b = data[2].toString(16).padStart(2, '0');
          out[color] = ('#' + r + g + b).toUpperCase();
        }
      } catch {
        out[color] = color;
      }
    });
    return out;
  }, unique);
  return new Map(Object.entries(result));
}

function majority(entries: { page: string; value: string }[]): { standard: string; deviations: { page: string; value: string }[] } {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.value, (counts.get(e.value) ?? 0) + 1);
  let standard = '';
  let best = -1;
  for (const [value, count] of counts) {
    if (count > best) {
      best = count;
      standard = value;
    }
  }
  return { standard, deviations: entries.filter((e) => e.value !== standard) };
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

/** Describes a true/false finding in plain words specific to what was
 * checked, so a reader never has to look at another column to know what
 * "Yes" or "No" was even answering. */
function describeBool(value: boolean, trueText: string, falseText: string): string {
  return value ? trueText : falseText;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

interface ConsistencyRow {
  category: string;
  element: string;
  property: string;
  mode: string;
  standard: string;
  consistent: boolean;
  inconsistentPages: string;
  expectedBehavior: string;
}

function buildRow(
  category: string,
  element: string,
  property: string,
  mode: string,
  records: PageRecord[],
  get: (s: FrontendSnapshot) => string,
  expectedBehavior: string,
  onlyWhere?: (s: FrontendSnapshot) => boolean,
  hexLookup?: Map<string, string>
): ConsistencyRow {
  const snapshotOf = (r: PageRecord) => (mode === 'Dark' ? r.dark : r.light);
  const applicable = onlyWhere ? records.filter((r) => onlyWhere(snapshotOf(r))) : records;
  const toDisplay = (raw: string) => (hexLookup ? hexLookup.get(raw) ?? raw : raw);
  const entries = applicable.map((r) => ({ page: r.name, value: toDisplay(get(snapshotOf(r))) }));
  const { standard, deviations } = majority(entries);
  const standardDisplay = standard || '(nothing found on any page)';
  // Every row's recommendation restates the concrete target value, so this
  // column makes sense on its own without having to look back at the
  // "Standard Style" column to see what "the standard" actually is.
  const fullExpectedBehavior = deviations.length
    ? `${expectedBehavior} On most pages it looks like this: ${standardDisplay}.`
    : `${expectedBehavior} Every page already matches: ${standardDisplay}.`;
  return {
    category,
    element,
    property,
    mode,
    standard: standardDisplay,
    consistent: deviations.length === 0,
    inconsistentPages: deviations.map((d) => `${d.page} looks like this instead: ${d.value || '(nothing found here)'}`).join('; '),
    expectedBehavior: fullExpectedBehavior,
  };
}

test('audit frontend consistency across all pages (light + dark)', async ({ browser }) => {
  test.skip(!USERNAME || !PASSWORD, 'ADX_USERNAME / ADX_PASSWORD are not set — see .env.example.');
  test.setTimeout(10 * 60_000);

  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const authContext = await browser.newContext();
  const authPage = await authContext.newPage();
  await new LoginPage(authPage).goto();
  await new LoginPage(authPage).login(USERNAME!, PASSWORD!);
  const storageState = await authContext.storageState();
  await authContext.close();

  const lightContext = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
  await lightContext.addInitScript(() => localStorage.setItem('kt-theme', 'light'));

  const darkContext = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
  await darkContext.addInitScript(() => localStorage.setItem('kt-theme', 'dark'));

  const records: PageRecord[] = [];

  for (const pageDef of PAGES) {
    const url = `${BASE_URL}${pageDef.path}`;

    const lightPage = await lightContext.newPage();
    await lightPage.goto(url, { waitUntil: 'domcontentloaded' });
    await lightPage.waitForTimeout(800);
    const light = await extractSnapshot(lightPage);
    await lightPage.screenshot({ path: path.join(SCREENSHOTS_DIR, `${pageDef.slug}-light.png`) });

    await lightPage.setViewportSize({ width: 375, height: 800 });
    await lightPage.waitForTimeout(400);
    const responsive = await extractResponsive(lightPage);
    await lightPage.screenshot({ path: path.join(SCREENSHOTS_DIR, `${pageDef.slug}-mobile.png`) });
    await lightPage.close();

    const darkPage = await darkContext.newPage();
    await darkPage.goto(url, { waitUntil: 'domcontentloaded' });
    await darkPage.waitForTimeout(800);
    const dark = await extractSnapshot(darkPage);
    await darkPage.screenshot({ path: path.join(SCREENSHOTS_DIR, `${pageDef.slug}-dark.png`) });
    await darkPage.close();

    records.push({ slug: pageDef.slug, name: pageDef.name, url, light, dark, responsive });
    console.log(`Captured: ${pageDef.name}`);
  }

  await lightContext.close();
  await darkContext.close();

  fs.writeFileSync(RAW_JSON_PATH, JSON.stringify(records, null, 2));

  // Sanity check the crawl actually found the shared shell — a total
  // failure here (e.g. login broke, selectors stopped matching) should
  // fail the test rather than silently emit an empty report.
  expect(records.length).toBe(PAGES.length);
  expect(records.filter((r) => r.light.header !== null).length).toBeGreaterThan(PAGES.length / 2);

  // Convert every raw color value (oklch/oklab/rgb — whatever the source CSS
  // used) to a plain #RRGGBB hex code for the report, via a throwaway page.
  const colorValues: string[] = [];
  for (const r of records) {
    for (const s of [r.light, r.dark]) {
      if (s.header) colorValues.push(s.header.bgColor);
      if (s.sidebar) colorValues.push(s.sidebar.bgColor);
      if (s.sidebarItem) colorValues.push(s.sidebarItem.color);
      colorValues.push(s.footer.bgColor, s.breadcrumb.color, s.pageTitle.color, s.bodyText.color);
      colorValues.push(s.primaryButton.bgColor, s.primaryButton.color, s.searchInput.borderColor);
      colorValues.push(s.table.headerRowBgColor, s.table.headerCellBgColor);
    }
  }
  const utilContext = await browser.newContext();
  const utilPage = await utilContext.newPage();
  await utilPage.goto('about:blank');
  const hexLookup = await colorsToHex(utilPage, colorValues);
  await utilContext.close();

  const rows: ConsistencyRow[] = [];

  for (const mode of ['Light', 'Dark'] as const) {
    rows.push(
      buildRow('Header', 'Header bar', 'Background color', mode, records, (s) => s.header?.bgColor ?? '', 'Header background must match the design-system token on every page.', undefined, hexLookup),
      buildRow('Header', 'Header bar', 'Height', mode, records, (s) => s.header?.height ?? '', 'Header height must be identical across pages.'),
      buildRow('Header', 'Header bar', 'Box shadow / border', mode, records, (s) => s.header?.boxShadow ?? '', 'Header elevation/border treatment must be consistent.'),
      buildRow('Sidebar', 'Sidebar container', 'Background color', mode, records, (s) => s.sidebar?.bgColor ?? '', 'Sidebar background must match the design-system token on every page.', undefined, hexLookup),
      buildRow('Sidebar', 'Sidebar container', 'Width', mode, records, (s) => s.sidebar?.width ?? '', 'Sidebar width must be identical across pages.'),
      buildRow('Sidebar', 'Nav item', 'Font size', mode, records, (s) => s.sidebarItem?.fontSize ?? '', 'Sidebar nav item font size must be identical across pages.'),
      buildRow('Sidebar', 'Nav item', 'Font weight', mode, records, (s) => s.sidebarItem?.fontWeight ?? '', 'Sidebar nav item font weight must be identical across pages.'),
      buildRow('Sidebar', 'Nav item', 'Text color', mode, records, (s) => s.sidebarItem?.color ?? '', 'Sidebar nav item text color must be identical across pages.', undefined, hexLookup),
      buildRow('Footer', 'Footer', 'Present', mode, records, (s) => describeBool(s.footer.present, 'This page has a footer', 'This page has no footer'), 'A shared footer should be present (or absent) consistently on every page.'),
      buildRow('Footer', 'Footer', 'Background color', mode, records, (s) => s.footer.bgColor, 'Footer background must match the design-system token on every page.', (s) => s.footer.present, hexLookup),
      buildRow('Footer', 'Footer', 'Font size', mode, records, (s) => s.footer.fontSize, 'Footer text size must be consistent on every page.', (s) => s.footer.present),
      buildRow('Navigation', 'Breadcrumb', 'Present', mode, records, (s) => describeBool(s.breadcrumb.present, 'Shows a breadcrumb trail (e.g. "Section > Page") near the top', 'Shows no breadcrumb trail'), 'Every list/detail page should show a breadcrumb.'),
      buildRow('Navigation', 'Breadcrumb', 'Font size', mode, records, (s) => s.breadcrumb.fontSize, 'Breadcrumb font size must be consistent on every page.', (s) => s.breadcrumb.present),
      buildRow('Navigation', 'Breadcrumb', 'Text color', mode, records, (s) => s.breadcrumb.color, 'Breadcrumb text color must be consistent on every page.', (s) => s.breadcrumb.present, hexLookup),
      buildRow('Typography', 'Page title (h1)', 'Font size', mode, records, (s) => s.pageTitle.fontSize, 'Page title size must follow one consistent scale.'),
      buildRow('Typography', 'Page title (h1)', 'Font weight', mode, records, (s) => s.pageTitle.fontWeight, 'Page title weight must follow one consistent scale.'),
      buildRow('Typography', 'Page title (h1)', 'Color', mode, records, (s) => s.pageTitle.color, 'Page title color must be consistent.', undefined, hexLookup),
      buildRow('Typography', 'Page title (h1)', 'Font family', mode, records, (s) => s.pageTitle.fontFamily, 'Page title font family must match the body font.'),
      buildRow('Typography', 'Section heading (card title)', 'Present', mode, records, (s) => describeBool(s.sectionHeading.present, 'Has a labeled section heading above part of the page', 'Has no section heading — just the page title'), 'Card/section headings should be used consistently where a page has sub-sections.'),
      buildRow('Typography', 'Section heading (card title)', 'Font size', mode, records, (s) => s.sectionHeading.fontSize, 'Section heading size must be consistent where present.', (s) => s.sectionHeading.present),
      buildRow('Typography', 'Body text', 'Font family', mode, records, (s) => s.bodyText.fontFamily, 'One font family for all body text.'),
      buildRow('Typography', 'Body text', 'Font size', mode, records, (s) => s.bodyText.fontSize, 'Base body font size must be consistent.'),
      buildRow('Typography', 'Body text', 'Line height', mode, records, (s) => s.bodyText.lineHeight, 'Base line height must be consistent.'),
      buildRow('Typography', 'Body text', 'Color', mode, records, (s) => s.bodyText.color, 'Base text color must be consistent.', undefined, hexLookup),
      buildRow('Buttons', 'Primary button', 'Present', mode, records, (s) => describeBool(s.primaryButton.present, 'Has a main call-to-action button (e.g. "+ Add")', 'Has no main call-to-action button'), 'Every page with a primary action should expose it as a .kt-btn-primary button.'),
      buildRow('Buttons', 'Primary button', 'Background color', mode, records, (s) => s.primaryButton.bgColor, 'Primary button color must be identical everywhere.', (s) => s.primaryButton.present, hexLookup),
      buildRow('Buttons', 'Primary button', 'Text color', mode, records, (s) => s.primaryButton.color, 'Primary button text color must be identical everywhere.', (s) => s.primaryButton.present, hexLookup),
      buildRow('Buttons', 'Primary button', 'Border radius', mode, records, (s) => s.primaryButton.borderRadius, 'Primary button border radius must be identical everywhere.', (s) => s.primaryButton.present),
      buildRow('Buttons', 'Primary button', 'Font size', mode, records, (s) => s.primaryButton.fontSize, 'Primary button font size must be identical everywhere.', (s) => s.primaryButton.present),
      buildRow('Buttons', 'Primary button', 'Font weight', mode, records, (s) => s.primaryButton.fontWeight, 'Primary button font weight must be identical everywhere.', (s) => s.primaryButton.present),
      buildRow('Forms', 'Search input', 'Present', mode, records, (s) => describeBool(s.searchInput.present, 'Has a search box', 'Has no search box'), 'List pages should expose a consistent search input.'),
      buildRow('Forms', 'Search input', 'Border color', mode, records, (s) => s.searchInput.borderColor, 'Input border color must be identical everywhere.', (s) => s.searchInput.present, hexLookup),
      buildRow('Forms', 'Search input', 'Border radius', mode, records, (s) => s.searchInput.borderRadius, 'Input border radius must be identical everywhere.', (s) => s.searchInput.present),
      buildRow('Forms', 'Search input', 'Font size', mode, records, (s) => s.searchInput.fontSize, 'Input font size must be identical everywhere.', (s) => s.searchInput.present),
      buildRow('Tables', 'Data table', 'Present', mode, records, (s) => describeBool(s.table.present, 'Shows its data as a table', 'Does not show a table'), 'Every list page should render its data as a table.'),
      buildRow('Tables', 'Table header row', 'Background color (the <tr> behind the header cells)', mode, records, (s) => s.table.headerRowBgColor, 'Table header row background must be identical across pages.', (s) => s.table.present, hexLookup),
      buildRow('Tables', 'Table header cell', "Background color (the <th> cell itself — a see-through layer, so a page's true header color is this composited with the row background above)", mode, records, (s) => s.table.headerCellBgColor, 'Table header cell background must be identical across pages.', (s) => s.table.present, hexLookup),
      buildRow('Tables', 'Table header cell', 'Border (full grid vs. divider-only)', mode, records, (s) => s.table.headerBorderWidth, 'All tables should use the same border style — either a full grid or column dividers only, not a mix.', (s) => s.table.present),
      buildRow('Tables', 'Table header cell', 'Font size', mode, records, (s) => s.table.headerFontSize, 'Table header font size must be identical across pages.', (s) => s.table.present),
      buildRow('Tables', 'Table header cell', 'Font weight', mode, records, (s) => s.table.headerFontWeight, 'Table header font weight must be identical across pages.', (s) => s.table.present),
      buildRow('Tables', 'Table header cell', 'Text align', mode, records, (s) => s.table.headerTextAlign, 'Table header text alignment must be identical across pages.', (s) => s.table.present),
      buildRow('Tables', 'Table data cell', 'Vertical padding (row density)', mode, records, (s) => s.table.cellPaddingTop, 'Row spacing/density must be identical across pages.', (s) => s.table.present),
      buildRow('Tables', 'Table data cell', 'Horizontal padding (left gutter)', mode, records, (s) => s.table.cellPaddingLeft, 'Cell left padding must be identical across pages.', (s) => s.table.present),
      buildRow('Badges', 'Status badge/pill', 'Present', mode, records, (s) => describeBool(s.badge.present, 'Shows status labels as colored badges', 'Shows no status badges'), 'Status values should render via one shared badge/pill component.'),
      buildRow('Badges', 'Status badge/pill', 'Border radius', mode, records, (s) => s.badge.borderRadius, 'Badge border radius must be identical across pages.', (s) => s.badge.present),
      buildRow('Badges', 'Status badge/pill', 'Font size', mode, records, (s) => s.badge.fontSize, 'Badge font size must be identical across pages.', (s) => s.badge.present),
      buildRow('Spacing', 'Main content area', 'Max width', mode, records, (s) => s.mainContent.maxWidth, 'Main content max-width must be identical across pages.'),
      buildRow('Spacing', 'Main content area', 'Left padding', mode, records, (s) => s.mainContent.paddingLeft, 'Main content padding must be identical across pages.')
    );
  }

  // Responsive (mode-independent — checked once at 375px width).
  const sidebarEntries = records.map((r) => ({ page: r.name, value: describeBool(r.responsive.sidebarVisible, 'Sidebar stays open and takes up screen space', 'Sidebar tucks itself away (as it should on a phone)') }));
  const sidebarMaj = majority(sidebarEntries);
  rows.push({
    category: 'Responsive',
    element: 'Sidebar at 375px width (phone-sized screen)',
    property: 'Does the sidebar tuck itself away to save space?',
    mode: 'N/A',
    standard: sidebarMaj.standard,
    consistent: sidebarMaj.deviations.length === 0,
    inconsistentPages: sidebarMaj.deviations.map((d) => `${d.page} looks like this instead: ${d.value}`).join('; '),
    expectedBehavior: `On a phone-width screen the sidebar should tuck itself away automatically on every page. On most pages: ${sidebarMaj.standard}.`,
  });
  const hamburgerEntries = records.map((r) => ({ page: r.name, value: describeBool(r.responsive.hamburgerVisible, 'Shows a menu (☰) button to open the sidebar', 'Shows no menu button to open the sidebar') }));
  const hamburgerMaj = majority(hamburgerEntries);
  rows.push({
    category: 'Responsive',
    element: 'Menu button at 375px width (phone-sized screen)',
    property: 'Does a menu button appear so the user can still open the sidebar?',
    mode: 'N/A',
    standard: hamburgerMaj.standard,
    consistent: hamburgerMaj.deviations.length === 0,
    inconsistentPages: hamburgerMaj.deviations.map((d) => `${d.page} looks like this instead: ${d.value}`).join('; '),
    expectedBehavior: `On a phone-width screen a menu button should appear on every page so the sidebar is still reachable. On most pages: ${hamburgerMaj.standard}.`,
  });

  // Dark-mode theming coverage: does each element's color actually change
  // between light and dark on a given page? Flags elements left unthemed.
  const themingChecks: { element: string; get: (s: FrontendSnapshot) => string }[] = [
    { element: 'Header background', get: (s) => s.header?.bgColor ?? '' },
    { element: 'Sidebar background', get: (s) => s.sidebar?.bgColor ?? '' },
    { element: 'Footer background', get: (s) => s.footer.bgColor },
    { element: 'Body text color', get: (s) => s.bodyText.color },
    { element: 'Primary button background', get: (s) => s.primaryButton.bgColor },
  ];
  for (const check of themingChecks) {
    const entries = records.map((r) => ({ page: r.name, value: describeBool(check.get(r.light) !== check.get(r.dark), 'Its colors do change when switching to dark mode', 'Its colors stay exactly the same in dark mode (looks unfinished)') }));
    const maj = majority(entries);
    rows.push({
      category: 'Dark Mode Coverage',
      element: check.element,
      property: 'Does it actually change when you switch to dark mode?',
      mode: 'Light→Dark',
      standard: maj.standard,
      consistent: maj.deviations.length === 0,
      inconsistentPages: maj.deviations.map((d) => `${d.page} looks like this instead: ${d.value}`).join('; '),
      expectedBehavior: `This part of the page should re-color itself when dark mode is turned on, same as it does everywhere else. On most pages: ${maj.standard}.`,
    });
  }

  // Empty-state observation (informational — presence depends on live data,
  // not a design choice, so it's reported but not scored as "inconsistent").
  const emptyPages = records.filter((r) => r.light.emptyState.present || r.dark.emptyState.present).map((r) => r.name);
  rows.push({
    category: 'Empty States',
    element: 'Table empty-state indicator',
    property: 'Observed on pages with 0 rows',
    mode: 'N/A',
    standard: emptyPages.length ? emptyPages.join(' | ') : '(none of the 13 pages had 0 rows at crawl time)',
    consistent: true,
    inconsistentPages: '',
    expectedBehavior: 'Informational only — re-run when a page is known to be empty to compare its empty-state styling.',
  });

  // Status-label vocabulary observed per page (informational — different
  // pages legitimately track different statuses, e.g. order fulfillment
  // stages vs. active/inactive, so this isn't scored as "inconsistent").
  const statusLabelsByPage = records
    .filter((r) => r.light.badge.statusLabels)
    .map((r) => `${r.name}: ${r.light.badge.statusLabels}`);
  rows.push({
    category: 'Badges',
    element: 'Status badge/pill',
    property: 'Status words seen on each page (for a human to sanity-check color/wording use)',
    mode: 'Light',
    standard: statusLabelsByPage.length ? statusLabelsByPage.join(' | ') : '(no Status column found)',
    consistent: true,
    inconsistentPages: '',
    expectedBehavior: 'Informational only — check that the same word (e.g. "Active") always uses the same badge color everywhere it appears.',
  });

  const header = [
    'Area of the App',
    'Page Element',
    'What Was Checked',
    'Theme (Light or Dark)',
    'Standard Style (Used on Most Pages)',
    'Same on Every Page?',
    'Pages That Look Different (and How)',
    'What It Should Look Like',
  ];
  const csvLines = [header.join(',')];
  for (const row of rows) {
    csvLines.push(
      [
        row.category,
        row.element,
        row.property,
        row.mode,
        row.standard,
        row.consistent ? 'Yes' : 'No',
        row.inconsistentPages,
        row.expectedBehavior,
      ]
        .map((v) => csvEscape(String(v)))
        .join(',')
    );
  }
  fs.writeFileSync(CSV_PATH, csvLines.join('\n'), 'utf-8');

  const inconsistentCount = rows.filter((r) => !r.consistent).length;
  console.log(`\nFrontend consistency audit complete: ${rows.length} checks, ${inconsistentCount} inconsistent.`);
  console.log(`CSV: ${CSV_PATH}`);
  console.log(`Raw snapshots: ${RAW_JSON_PATH}`);
  console.log(`Screenshots: ${SCREENSHOTS_DIR}`);
});
