# Adnomix — Agentic Playwright Test Automation Framework

A Playwright + TypeScript test framework wrapped in three cooperating AI
agents — **Planner**, **Generator**, and **Healer** — that plan, write, and
self-repair the test suite, backed by a persistent on-disk memory store.

## Stack

- **Playwright + TypeScript** for execution (`@playwright/test`).
- **Page Object Model** under `/pages`, specs under `/tests`.
- **Model Context Protocol (MCP)** (`@modelcontextprotocol/sdk`) exposing a
  sandboxed filesystem/test-runner toolset the agents (or any MCP client,
  including Claude Code itself) can call.
- **Optional Claude backend** (`ANTHROPIC_API_KEY`) for the reasoning-heavy
  steps in each agent; every agent also has a deterministic, dependency-free
  fallback so the framework runs with zero configuration.
- **@faker-js/faker** for FakeFiller-style random form data in the Suppliers
  Create/Edit suites, so tests never hardcode a fixed company name that
  could collide across runs.

## How the three agents interact

```
requirements/*.md
      │
      ▼
 ┌───────────┐   TestPlan JSON    ┌─────────────┐   spec + page object   ┌────────────┐
 │  PLANNER  │ ─────────────────▶ │  GENERATOR  │ ──────────────────────▶│  Playwright │
 └───────────┘                    └─────────────┘                       │  test run   │
      ▲                                  ▲                              └─────┬──────┘
      │        high-risk areas           │ known selectors,                  │
      │        (failure trends)          │ conventions, healing history      │ results.json
      │                                  │                                   ▼
      │                           ┌──────┴───────┐                    ┌────────────┐
      └────────────────────────── │   .agent-    │ ◀───────────────── │   HEALER   │
        risk flags for next plan  │   memory/    │   heals, logs      └────────────┘
                                   └──────────────┘   pattern
```

1. **Planner** (`agents/planner/plannerAgent.ts`) reads every Markdown user
   story in `/requirements`, turns each acceptance criterion into one or more
   structured `TestCase`s, and saves a `TestPlan` to
   `.agent-memory/test-plans/`. It cross-references
   `.agent-memory/failure_trends.json` first, so any feature that touches a
   historically flaky file gets bumped to `high` priority with a `riskNotes`
   entry — this is the **Planner feedback loop**.

2. **Generator** (`agents/generator/generatorAgent.ts`) takes the latest (or
   a specified) `TestPlan` and, *before* writing anything, reads:
   - existing Page Object Models in `/pages` (via a selector scan), and
   - `.agent-memory/locator_map.json`, `project_conventions.md`, and
     `healing_history.json`.

   It reuses known-good selectors instead of re-inventing them, avoids
   selector patterns the Healer has previously had to fix, and only then
   emits a Page Object (`/pages/<Feature>Page.ts`) and a spec
   (`/tests/<feature-slug>.spec.ts`). This is **Generator context awareness**.

3. Tests run normally via `npx playwright test`, producing
   `test-results/results.json` (+ JUnit XML + HTML report).

4. **Healer** (`agents/healer/healerAgent.ts`) parses that JSON report,
   classifies each failure (`stale-locator`, `timeout`, `assertion`,
   `unknown`), and proposes a fix. With `--apply` it patches the offending
   selector directly in the spec/page file. Every attempt — successful or
   not — is appended to `.agent-memory/healing_history.json`, and every
   failure (healed or not) updates `.agent-memory/failure_trends.json`,
   which is what the Planner reads on its next run. This is the **Healer
   memory loop**.

`agents/orchestrator.ts` runs the full Plan → Generate → Execute → Heal cycle
in one command.

## Running it

```bash
npm install
npx playwright install   # already done for chromium during setup

# Individual agents
npm run agent:plan        # requirements/*.md -> .agent-memory/test-plans/*.json
npm run agent:generate    # latest plan -> pages/*.ts + tests/*.spec.ts
npm test                  # run Playwright, produce test-results/results.json
npm run agent:heal        # dry-run diagnosis of the last failed run
npm run agent:heal -- --apply   # actually patch failing selectors

# Full cycle
npm run agent:run-cycle             # dry-run healing
npm run agent:run-cycle -- --apply  # apply healer fixes automatically
```

By default every agent uses built-in heuristics (regex-based requirement
parsing, role/label-based selector guessing, pattern-based failure
classification). Set `ANTHROPIC_API_KEY` (see `.env.example`) to have them
delegate to Claude instead — no code changes required.

## MCP integration

`mcp/server/testOpsServer.ts` is a small MCP server exposing five tools,
each sandboxed to the project root:

| Tool          | Purpose                                                        |
|---------------|-----------------------------------------------------------------|
| `read_file`   | Read a text file relative to the repo root                     |
| `write_file`  | Write/overwrite a text file, creating parent dirs as needed     |
| `list_dir`    | List a directory's contents                                    |
| `run_tests`   | Run `npx playwright test` (optionally `--grep`/`--project`/specific `files`) |
| `read_report` | Read the last `results.json` / `results.xml`                   |

`mcp/mcp.config.json` registers it the way Claude Code / Claude Desktop
register any local MCP server (`command` + `args`). `mcp/client/demoUsage.ts`
is boilerplate showing an agent-side client spawning the server over stdio
and calling each tool — run it with `npm run mcp:demo`.

## Test suites

- `tests/user-login.spec.ts` — generated demo suite for the fictional login
  feature in `requirements/sample-login.md`; deliberately fails against the
  default `example.com` baseURL so there's something for the Healer to
  diagnose out of the box.
- `tests/test_ServiceProviders_SuppliersIndex.spec.ts` — a real, hand-verified
  end-to-end suite against `https://adxmanager.dev`: log in, navigate to
  Service Providers > Suppliers, then exercise the search bar (by supplier
  name/contact/location/email), the Status filter (Active, Inactive,
  Active + Inactive, plus combining a filter with a search), and CSV export.
  Every selector in `pages/LoginPage.ts`, `pages/HomePage.ts`, and
  `pages/SuppliersPage.ts` was confirmed against the live app (not guessed) —
  non-obvious findings from that process (e.g. location search not matching
  the literal "City, Country" string, and the filter panel's two identically
  labelled "Apply" buttons) are recorded in `.agent-memory/project_conventions.md`.
  Requires `ADX_USERNAME`/`ADX_PASSWORD` in a local `.env` (see
  `.env.example`); the suite is skipped automatically if they're unset.
- `tests/test_ServiceProviders_Suppliers_Create.spec.ts` and
  `tests/test_ServiceProviders_Suppliers_Edit.spec.ts` — same live app, same
  login/session discipline as the Index suite (log in unrecorded, then a
  fresh authenticated context/page whose first navigation is straight to
  `/v2/service-providers/suppliers`, so a headed run's recording begins
  exactly there). Create exercises the "Add Supplier" drawer (a happy path
  with `@faker-js/faker`-generated data, plus two negative-path validation
  cases — a hidden-required field and a UI-marked-required one); Edit
  creates its own throwaway fixture supplier and edits its contact details,
  then its company name and location, then a negative-path validation case,
  so neither suite mutates the real, pre-existing suppliers the Index suite
  reads. Several more non-obvious, live-verified findings from these two
  suites (the KTUI "data-kt-select" combobox mechanics behind
  Country/Balance Timing, an icon-glyph accessible-name quirk, duplicate
  desktop/mobile markup, and an unhandled-500 bug on a missing City) are
  also recorded in `.agent-memory/project_conventions.md`.
- `tests/test_ServiceProviders_FreightForwarders_Create.spec.ts`,
  `tests/test_ServiceProviders_FreightForwarders_Edit.spec.ts`,
  `tests/test_ServiceProviders_CustomsBrokers_Create.spec.ts`, and
  `tests/test_ServiceProviders_CustomsBrokers_Edit.spec.ts` — same
  discipline again (own page objects `pages/FreightForwardersPage.ts` /
  `pages/CustomsBrokersPage.ts`, `@faker-js/faker` data, happy path + two
  negative-path validations on Create, contact/company/location edits + one
  negative-path validation on Edit, own throwaway fixtures on Edit, headed
  recording starting exactly at the section's index URL). These two
  sections look like Suppliers in the UI but were verified independently
  rather than assumed to match it — and turned out **not** to: Freight
  Forwarders redirects to the new record's detail page on create (Suppliers
  and Customs Brokers stay on the index), each section renders a different
  Location-column format, Customs Brokers' Edit is only reachable from the
  detail page (no row-level "Edit" action at all), and Freight Forwarders'
  row menu offers hard "Delete" instead of "Deactivate". The full
  cross-section comparison table is in `.agent-memory/project_conventions.md`.

## Persistent agent memory (`.agent-memory/`)

| File                     | Written by | Read by            | Contents                                    |
|--------------------------|-----------|---------------------|----------------------------------------------|
| `test-plans/*.json`      | Planner   | Generator           | Structured `TestPlan`s                       |
| `locator_map.json`       | Generator, Healer | Generator   | Known-good selector per page element         |
| `healing_history.json`   | Healer    | Generator, Healer   | Every heal attempt: old/new selector, reasoning, confidence |
| `failure_trends.json`    | Healer    | Planner             | Failure counts/types per test, a flakiness score |
| `project_conventions.md` | Healer, humans | Generator      | Freeform learned conventions and fix log     |

This directory is committed to version control — it's the framework's
long-term memory, not build output.

## Directory layout

```
agents/
  planner/plannerAgent.ts     # requirements -> test plans
  generator/generatorAgent.ts # test plans -> page objects + specs
  healer/healerAgent.ts       # test results -> diagnoses + fixes
  orchestrator.ts             # runs all three in sequence
  shared/                     # memoryStore, types, optional LLM client
mcp/
  server/testOpsServer.ts     # sandboxed fs/test-runner MCP server
  client/demoUsage.ts         # example MCP client usage
  mcp.config.json             # MCP server registration
pages/                        # Page Object Models (BasePage + generated)
tests/                        # Generated Playwright specs
requirements/                 # Input user stories / feature specs (.md)
.agent-memory/                # Persistent cross-run agent knowledge
playwright.config.ts
```
