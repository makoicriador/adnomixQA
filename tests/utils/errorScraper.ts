import { Page } from '@playwright/test';

export interface PageIssue {
  type: 'page-error' | 'server-error';
  detail: string;
}

/**
 * Lightweight "scrape the page for bugs" monitor: watches a page for
 * uncaught JS exceptions and same-origin 5xx responses for the rest of its
 * lifetime. Third-party/cross-origin noise (analytics, font CDNs, browser
 * extensions) is deliberately excluded so this only flags issues actually
 * caused by adxmanager.dev itself — e.g. it would have caught the Suppliers
 * "blank City" unhandled-500 bug (see project_conventions.md) had that
 * suite not deliberately triggered it in its own standalone, non-monitored
 * spec (test_ServiceProviders_Suppliers_Create_CityError.spec.ts).
 *
 * Expected negative-path validation failures elsewhere in this app (e.g. "The
 * company name field is required.", or Warehouses' hidden-required
 * min/max-stock-level bug) all round-trip as a 302 redirect back to the form
 * with a flashed banner — confirmed live, not a 5xx — so they never appear
 * here and don't need special-casing.
 */
export function attachPageHealthMonitor(page: Page): PageIssue[] {
  const issues: PageIssue[] = [];
  page.on('pageerror', (err) => {
    issues.push({ type: 'page-error', detail: err.message });
  });
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('adxmanager.dev') && response.status() >= 500) {
      issues.push({ type: 'server-error', detail: `${response.status()} ${response.request().method()} ${url}` });
    }
  });
  return issues;
}

/** Formats collected issues into one assertion-friendly message. */
export function describeIssues(issues: PageIssue[]): string {
  return issues.map((i) => `- [${i.type}] ${i.detail}`).join('\n');
}
