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

  **Superseded 2026-09-17**: re-verified live and this "Add Filter" dropdown + dual-"Apply"-button UI (and the "Status: ..." chip it produced) no longer exists anywhere on the Suppliers index. The app has since been migrated to the same unified Filter-drawer pattern already used by Freight Forwarders/Customs Brokers/Warehouses: a "Filter" button (icon-glyph-prefixed) toggles a drawer (`#form-suppliers-index-drawer`) with Active/Inactive toggle buttons and a single "Update" submit button. `SuppliersPage.filterByStatus` and `test_ServiceProviders_SuppliersIndex.spec.ts` were updated to match; the `statusChip` getter and `clearAllFilters()` helper were removed since their target elements no longer render. This is a good example of why "verified live" findings need periodic re-verification rather than being treated as permanently true — the live app changes independently of this test suite.

- [2026-09-15T13:35:01.716Z] adxmanager.dev left sidebar: top-level accordion headers like "Service Providers" are not <a>/<button> elements (no accessible role), and exact text matching resolves to the wrong node. Use a case-insensitive substring text locator (getByText(/.../i).first()) for sidebar navigation on this app.

- [2026-09-16T00:00:00.000Z] adxmanager.dev Suppliers Create/Edit drawers: buttons and links preceded by a KTUI/Keenthemes icon-font glyph (`<i class="ki-filled ki-...">`) contribute invisible characters to the computed accessible name (Playwright's ARIA snapshot renders it as extra leading whitespace, e.g. "  Edit"). An exact `getByRole(..., { name, exact: true })` match on these times out with 0 matches; a substring match (omit `exact`) works. Plain text-only buttons/links (no icon) match fine with `exact: true`. Confirmed on: the "Add Supplier" button and a row's "Edit" action link.

- [2026-09-16T00:00:00.000Z] adxmanager.dev Suppliers Create/Edit drawers: several elements are rendered twice in the DOM as a desktop/mobile pair with identical accessible names/content — the "Create" and "Save Changes" submit buttons, and the success confirmation banner (`.kt-alert-success`) itself. Always disambiguate with `.first()` rather than assuming a single match; this mirrors the two "Apply" buttons already documented above for the Status filter.

- [2026-09-16T00:00:00.000Z] adxmanager.dev Suppliers Create/Edit forms: "Country" and "Balance Timing" (and Brand, Messaging Platform, calling-country-code) are KTUI "data-kt-select" comboboxes — the real `<select>` stays `class="hidden"` and a generated wrapper (its next DOM sibling, `[data-kt-select-wrapper]`) renders the visible trigger (`[data-kt-select-display]`) plus a `<li role="option">` listbox (`[data-kt-select-dropdown]`). Playwright's `selectOption()` cannot be used since the native element is never visible; click the display to open it, then click the matching `role=option`. Only some instances enable a search box (Country does; Balance Timing does not) — check for `input[placeholder="Search..."]` before filling it rather than assuming it's always present. See `SuppliersPage.selectKtOption`.

- [2026-09-16T00:00:00.000Z] adxmanager.dev Suppliers Create form: two fields have no "*" in the UI but are effectively required — "Balance Timing" fails gracefully server-side ("The balance payment timing field is required."), while "City" is a NOT NULL database column with no validation rule behind it and 500s with a raw, unhandled Laravel debug page (leaking the SQL query, stack trace, internal DB host/port, and request cookies) if left blank on create. This looks like an application bug and a security exposure (debug mode enabled) worth fixing upstream; the test suite always supplies `city` and treats only Balance Timing as the negative-path case, since asserting the crash page as "expected" would bake in the bug.

  **Extended 2026-09-17**: the bug is not specific to the Create path — clearing an existing supplier's City via Edit and saving crashes with the identical unhandled 500 (`SQLSTATE[23502]`, not-null violation on `"suppliers"."city"`), this time via the PUT `.../suppliers/{id}` update path (`app/V2/Http/Actions/Supplier/Update.php:71`) instead of the POST create path. Any write leaving City blank crashes, not just creation. Reproduced in `test_ServiceProviders_Suppliers_Edit_CityError.spec.ts`, a standalone sibling of the Create-path repro spec — exclude both from routine full-suite runs for the same reason (asserting the crash as "expected" would bake the bug in).

  Also checked and ruled out while investigating this: Warehouses' "City" field (also unmarked "*" in the UI) is genuinely nullable — leaving it blank creates successfully with City rendering as "—", no crash, no error. Same result for Warehouses' "State", "Zip Code", and "Extension Number" (all unmarked, all genuinely optional). Freight Forwarders' and Customs Brokers' "City" fields are both marked "*" and fail gracefully (confirmed by their own existing Create-suite negative-path tests passing). So the NOT-NULL-with-no-validation bug is specific to Suppliers' "city" column — it is not a shared framework-level issue across all four Service Providers sections.

- [2026-09-16T00:00:00.000Z] adxmanager.dev Suppliers index: the "Location" column renders "{state}, {country}" — city is not shown there at all. The Suppliers Index suite's own location-search test still passes only because several pre-existing Chinese suppliers happen to have a city name entered into their State field.

- [2026-09-16T00:00:00.000Z] adxmanager.dev Service Providers Create/Edit forms (Suppliers, Freight Forwarders, Customs Brokers): despite the near-identical UI kit (same drawer/KTUI-select mechanics, same `.kt-alert-success`/`.kt-alert-destructive` banner classes, same icon-glyph accessible-name quirk, same duplicate-button pattern), each section has its own distinct, independently-required-fields, redirect, and Location-format behavior — **verify each one live rather than assuming it matches a sibling section**. Confirmed differences:

  | Behavior | Suppliers | Freight Forwarders | Customs Brokers |
  |---|---|---|---|
  | Hidden-required field (no "*" but required) | Balance Timing (graceful) | none found | none found |
  | Field that 500s ugly if blank | City (NOT NULL, no validation rule) | none found | none found |
  | Cell/phone number required? | Phone required | Cell Number optional | Cell Number required |
  | On successful create, stays on... | index | **new record's own detail page** | index |
  | Index "Location" column format | "{state}, {country}" | "{city}, {country}" | "{city}, {state}, {country}" |
  | Row-level kebab menu has "Edit"? | yes (`<a href=".../edit">`, full navigation) | yes (`<a href=".../edit">`, full navigation) | **no** — only "Deactivate"; Edit is a button on the detail page (`#edit-button`, client-side drawer, no navigation) |
  | Row-level kebab menu has "Deactivate"/"Delete"? | Deactivate (soft toggle) | **Delete** (hard delete, native `confirm()` dialog) | Deactivate (soft toggle) |

  `CustomsBrokersPage.openEditFor` therefore clicks into the row's detail page first rather than reusing the kebab-menu pattern from `SuppliersPage`/`FreightForwardersPage`. A cleanup script that assumes every section's kebab menu has a "Deactivate" link will hang on Freight Forwarders — it only has "Edit" and "Delete".

- [2026-09-17T00:00:00.000Z] adxmanager.dev Freight Forwarders/Customs Brokers/Warehouses indexes: unlike Suppliers' "Add Filter" dropdown + two identically-labelled "Apply" buttons, these three sections instead use a "Filter" button (icon-glyph-prefixed, substring match needed) that toggles a drawer (`#form-<section>-index-drawer`) with Active/Inactive toggle buttons and a single "Update" submit button. Confirmed live that Customs Brokers' "Active" toggle is **pre-checked by default** even with no filter applied (Warehouses/Freight Forwarders default to both unchecked) — a `filterByStatus` helper that blindly clicks every requested status (assuming it starts unchecked) silently *unchecks* Active on Customs Brokers instead of checking it, corrupting the filter. Each page object's `filterByStatus` instead reads every checkbox's actual `isChecked()` state first and only clicks a toggle when it doesn't already match the desired state.

- [2026-09-17T00:00:00.000Z] adxmanager.dev Warehouses Create/Edit form: `min_stock_level` and `max_stock_level` carry no "*" in the UI but are BOTH required server-side — a hidden-required-fields bug in the same spirit as Suppliers' Balance Timing/City. Unlike every other required field on this form (which fails with a specific "The X field is required." message), omitting either stock-level field alone still fails the whole create, but only with a generic "Failed to create warehouse. Please try again." banner — the real validation error is swallowed. Confirmed as a 302 redirect with a flashed banner, not an unhandled 500 (unlike Suppliers' City bug), so it's safe to assert on directly as a regression guard rather than needing a separate bug-repro spec. Also confirmed live: Warehouses has no Bank Accounts section at all (present on Suppliers/Freight Forwarders/Customs Brokers), but uniquely has an "Add Location" feature — a client-side modal (`#warehouse-location-modal`, reachable only from a warehouse's own detail page) whose fields are all native HTML5 `required` rather than server-validated, so a blank-required-field submission never round-trips to the server at all (no `.kt-alert-destructive`, just the browser's own constraint validation blocking the click).
