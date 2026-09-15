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
