import * as fs from 'fs';
import * as path from 'path';
import { HealingRecord } from '../shared/types';
import { appendHealingRecord, upsertLocator, recordFailure, appendConvention } from '../shared/memoryStore';
import { askLlm, extractJson, isLlmAvailable } from '../shared/llmClient';

const REPORT_PATH = path.resolve(__dirname, '..', '..', 'test-results', 'results.json');
const PROMPT_PATH = path.join(__dirname, 'prompts', 'healer.prompt.md');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

interface FlatFailure {
  testFile: string;
  testTitle: string;
  errorMessage: string;
}

/** Playwright's JSON reporter nests suites/specs/tests/results recursively. */
function flattenFailures(report: any): FlatFailure[] {
  const failures: FlatFailure[] = [];

  const walkSuite = (suite: any, filePath: string) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (result.status === 'failed' || result.status === 'timedOut') {
            const errorMessage =
              result.error?.message ||
              result.errors?.map((e: any) => e.message).join('\n') ||
              'Unknown failure';
            failures.push({ testFile: filePath || suite.file, testTitle: spec.title, errorMessage });
          }
        }
      }
    }
    for (const child of suite.suites ?? []) {
      walkSuite(child, filePath || suite.file);
    }
  };

  for (const suite of report.suites ?? []) {
    walkSuite(suite, suite.file);
  }
  return failures;
}

function classifyFailure(errorMessage: string): HealingRecord['failureType'] {
  if (/strict mode violation|resolved to \d+ elements|element(s)? not found|waiting for locator/i.test(errorMessage)) {
    return 'stale-locator';
  }
  if (/timeout \d+ms exceeded|timed out/i.test(errorMessage)) {
    return 'timeout';
  }
  if (/expect\(.*\)\.(toBe|toEqual|toHaveText|toHaveURL|toContainText)/i.test(errorMessage)) {
    return 'assertion';
  }
  return 'unknown';
}

function extractSelectorFromError(errorMessage: string): string | undefined {
  const match = errorMessage.match(/locator\(['"`]([^'"`]+)['"`]\)/) || errorMessage.match(/getBy\w+\([^)]*\)/);
  return match ? match[0] : undefined;
}

/** Deterministic fallback fix: broaden a strict/failing role or text locator. */
function heuristicFix(errorMessage: string, failureType: HealingRecord['failureType']): { newSelector?: string; reasoning: string; confidence: number } {
  const oldSelector = extractSelectorFromError(errorMessage);
  if (failureType === 'timeout' && oldSelector) {
    return {
      newSelector: `${oldSelector}.first()`,
      reasoning: 'Timeout waiting for locator; scoping to .first() and relying on auto-wait to reduce ambiguity-induced stalls.',
      confidence: 0.4,
    };
  }
  if (failureType === 'stale-locator' && oldSelector) {
    const broadened = oldSelector.replace(/getByText\((.+)\)/, 'getByText($1, { exact: false })');
    return {
      newSelector: broadened !== oldSelector ? broadened : `${oldSelector}.first()`,
      reasoning: 'Selector likely changed text/DOM structure; relaxing exact match / disambiguating to first match.',
      confidence: 0.35,
    };
  }
  return { reasoning: 'No safe heuristic fix available; flagging for human review.', confidence: 0 };
}

async function llmDiagnose(testFile: string, testTitle: string, errorMessage: string): Promise<any | null> {
  const systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
  let source = '';
  try {
    source = fs.readFileSync(path.join(REPO_ROOT, testFile), 'utf-8');
  } catch {
    /* file may not resolve exactly; proceed without source */
  }
  const userPrompt = `Test file: ${testFile}\nTest title: ${testTitle}\n\nSource:\n${source}\n\nError:\n${errorMessage}`;
  const response = await askLlm(systemPrompt, userPrompt);
  if (!response) return null;
  return extractJson(response);
}

async function healFailure(failure: FlatFailure, applyFixes: boolean): Promise<HealingRecord> {
  const failureType = classifyFailure(failure.errorMessage);
  recordFailure(failure.testFile, failure.testTitle, failureType);

  let oldSelector = extractSelectorFromError(failure.errorMessage);
  let newSelector: string | undefined;
  let reasoning: string;
  let confidence: number;
  let patchedSource: string | undefined;

  if (isLlmAvailable()) {
    const diagnosis = await llmDiagnose(failure.testFile, failure.testTitle, failure.errorMessage);
    if (diagnosis) {
      oldSelector = diagnosis.oldSelector ?? oldSelector;
      newSelector = diagnosis.newSelector;
      reasoning = diagnosis.reasoning;
      confidence = diagnosis.confidence ?? 0;
      patchedSource = diagnosis.patchedSource;
    } else {
      ({ newSelector, reasoning, confidence } = heuristicFix(failure.errorMessage, failureType));
    }
  } else {
    ({ newSelector, reasoning, confidence } = heuristicFix(failure.errorMessage, failureType));
  }

  const record: HealingRecord = {
    id: `heal-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    testFile: failure.testFile,
    testTitle: failure.testTitle,
    failureType,
    oldSelector,
    newSelector,
    reasoning,
    applied: false,
    confidence,
  };

  const canApply = applyFixes && confidence >= 0.5 && newSelector && oldSelector;
  if (canApply) {
    const absPath = path.join(REPO_ROOT, failure.testFile);
    try {
      let content = patchedSource ?? fs.readFileSync(absPath, 'utf-8');
      if (!patchedSource && oldSelector && newSelector) {
        content = content.split(oldSelector).join(newSelector);
      }
      fs.writeFileSync(absPath, content, 'utf-8');
      record.applied = true;
      appendConvention(
        `Healer replaced \`${oldSelector}\` with \`${newSelector}\` in ${failure.testFile} (${failureType}, confidence ${confidence}).`
      );
      if (oldSelector && newSelector) {
        upsertLocator(`${failure.testFile}:${failure.testTitle}`, {
          page: failure.testFile,
          element: failure.testTitle,
          selector: newSelector,
          strategy: 'role',
          lastVerified: new Date().toISOString(),
          timesHealed: 1,
        });
      }
      console.log(`[Healer] APPLIED fix in ${failure.testFile}: ${oldSelector} -> ${newSelector}`);
    } catch (err) {
      console.warn(`[Healer] Failed to apply fix to ${absPath}:`, err);
    }
  } else {
    console.log(
      `[Healer] PROPOSED (not applied${applyFixes ? ', low confidence' : ', dry-run'}) fix for "${failure.testTitle}": ${oldSelector ?? '(n/a)'} -> ${newSelector ?? '(n/a)'} [confidence ${confidence}]`
    );
  }

  appendHealingRecord(record);
  return record;
}

async function main() {
  const applyFixes = process.argv.includes('--apply');

  if (!fs.existsSync(REPORT_PATH)) {
    console.error(`[Healer] No report found at ${REPORT_PATH}. Run \`npm test\` first (with the JSON reporter enabled).`);
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'));
  const failures = flattenFailures(report);

  if (!failures.length) {
    console.log('[Healer] No failures found in the latest report. Nothing to heal.');
    return;
  }

  console.log(`[Healer] LLM backend: ${isLlmAvailable() ? 'Claude (ANTHROPIC_API_KEY set)' : 'heuristic fallback'}`);
  console.log(`[Healer] Found ${failures.length} failure(s). Apply mode: ${applyFixes}`);

  for (const failure of failures) {
    await healFailure(failure, applyFixes);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Healer] Failed:', err);
    process.exit(1);
  });
}

export { healFailure, flattenFailures, classifyFailure };
