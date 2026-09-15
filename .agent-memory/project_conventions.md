# Project Conventions & Learned Knowledge

This file is append-only knowledge the agents accumulate over time. The
Healer agent appends an entry every time it applies a fix; humans can also
add conventions by hand — both are read by the Generator before it writes
new code.

## Seed conventions

- Prefer `page.getByRole(...)` and `page.getByLabel(...)` over CSS/XPath selectors.
- Page Object classes live in `/pages` and extend `BasePage`.
- Spec files live in `/tests` and are named `<feature-slug>.spec.ts`.
- Tag smoke-critical tests with `@smoke`; tag negative-path tests with `@negative`.
- Timeouts should rely on Playwright's built-in auto-waiting; avoid manual `page.waitForTimeout`.

## Healer log (auto-appended below)

- [2026-09-15T13:35:01.716Z] adxmanager.dev Suppliers index: the search box matches location as separate city/country tokens, not the literal "City, Country" display string — searching "Xiamen, China" (comma included) returns 0 results, but "Xiamen" or "China" alone match. Search on one token at a time.

- [2026-09-15T13:35:01.716Z] adxmanager.dev Suppliers index Status filter: there are two distinct "Apply" buttons with the same accessible name "Apply" — an inner one inside the filter popover (#filterControlGroup) that only stages the selection into a chip, and an outer one (button[type=submit][form=form-suppliers-index]) that actually submits the GET form. Both must be clicked, in that order, or the filter silently has no effect.

- [2026-09-15T13:35:01.716Z] adxmanager.dev left sidebar: top-level accordion headers like "Service Providers" are not <a>/<button> elements (no accessible role), and exact text matching resolves to the wrong node. Use a case-insensitive substring text locator (getByText(/.../i).first()) for sidebar navigation on this app.
