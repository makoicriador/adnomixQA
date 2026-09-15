import * as fs from 'fs';
import * as path from 'path';
import { TestCase, TestPlan } from '../shared/types';
import {
  latestTestPlan,
  loadTestPlan,
  loadLocatorMap,
  loadHealingHistory,
  readConventions,
  scanExistingSelectors,
  upsertLocator,
} from '../shared/memoryStore';
import { askLlm, extractJson, isLlmAvailable } from '../shared/llmClient';

const PAGES_DIR = path.resolve(__dirname, '..', '..', 'pages');
const TESTS_DIR = path.resolve(__dirname, '..', '..', 'tests');
const PROMPT_PATH = path.join(__dirname, 'prompts', 'generator.prompt.md');

function pascalCase(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Turns a plain-language target string into a resilient locator call, reusing memory when possible. */
function resolveLocator(target: string, locatorMap: Record<string, { selector: string }>, knownSelectors: string[]): string {
  const key = slugify(target);
  const memoryHit = Object.entries(locatorMap).find(([k]) => k.includes(key) || key.includes(k));
  if (memoryHit) return memoryHit[1].selector;

  const scanHit = knownSelectors.find((s) => s.toLowerCase().includes(target.toLowerCase().split(' ')[0]));
  if (scanHit) {
    const match = scanHit.match(/:\s*(.+)$/);
    if (match) return `page.${match[1]}`;
  }

  // Fallback: prefer accessible role/label guesses over CSS.
  if (/button|submit|click/i.test(target)) return `page.getByRole('button', { name: /${target.replace(/'/g, '')}/i })`;
  if (/email/i.test(target)) return `page.getByLabel(/email/i)`;
  if (/password/i.test(target)) return `page.getByLabel(/password/i)`;
  return `page.getByText(/${target.replace(/'/g, '')}/i)`;
}

interface TargetMethod {
  target: string;
  methodName: string;
  action: 'fill' | 'click' | 'other';
}

function buildPageObject(featureName: string, cases: TestCase[], locatorMap: Record<string, any>, knownSelectors: string[]): { className: string; code: string; filePath: string; methods: TargetMethod[] } {
  const className = `${pascalCase(featureName)}Page`;
  const filePath = path.join(PAGES_DIR, `${className}.ts`);

  const targetActions = new Map<string, 'fill' | 'click' | 'other'>();
  for (const c of cases) {
    for (const step of c.steps) {
      if (!step.target) continue;
      const action = step.action === 'fill' ? 'fill' : step.action === 'click' ? 'click' : 'other';
      if (!targetActions.has(step.target)) targetActions.set(step.target, action);
    }
  }

  const methods: TargetMethod[] = [];
  const methodCode = Array.from(targetActions.entries())
    .map(([target, action]) => {
      const suffix = pascalCase(target.slice(0, 40));
      const locator = resolveLocator(target, locatorMap, knownSelectors).replace(/^page\./, 'this.page.');
      if (action === 'fill') {
        const methodName = `fill${suffix}`;
        methods.push({ target, methodName, action });
        return `  async ${methodName}(value: string): Promise<void> {\n    // target: ${target.replace(/\*/g, '')}\n    await ${locator}.fill(value);\n  }`;
      }
      const methodName = `click${suffix}`;
      methods.push({ target, methodName, action: 'click' });
      return `  async ${methodName}(): Promise<void> {\n    // target: ${target.replace(/\*/g, '')}\n    await ${locator}.click();\n  }`;
    })
    .join('\n\n');

  const code = `import { Page } from '@playwright/test';\nimport { BasePage } from './BasePage';\n\nexport class ${className} extends BasePage {\n  constructor(page: Page) {\n    super(page);\n  }\n\n${methodCode}\n}\n`;

  return { className, code, filePath, methods };
}

function buildSpecFile(plan: TestPlan, className: string, methods: TargetMethod[]): { code: string; filePath: string } {
  const fileSlug = slugify(plan.feature);
  const filePath = path.join(TESTS_DIR, `${fileSlug}.spec.ts`);

  const methodByTarget = new Map(methods.map((m) => [m.target, m]));

  const testBlocks = plan.cases
    .map((c) => {
      const lines = c.steps
        .map((s) => {
          if (s.target) {
            const method = methodByTarget.get(s.target);
            if (!method) return `    // skipped: no page-object method resolved for "${s.target}"`;
            if (method.action === 'fill') {
              const value = (s.data ?? '').replace(/'/g, "\\'");
              return `    await pageObject.${method.methodName}('${value}');`;
            }
            return `    await pageObject.${method.methodName}();`;
          }
          if (s.expected) {
            return `    // expect: ${s.expected}`;
          }
          return `    // ${s.action}`;
        })
        .join('\n');
      return `  test('${c.title.replace(/'/g, "\\'")}', { tag: [${c.tags.map((t) => `'@${t}'`).join(', ')}] }, async ({ page }) => {\n    const pageObject = new ${className}(page);\n    await pageObject.goto('/');\n${lines}\n    // TODO: replace with a real assertion for this feature's UI.\n    await expect(page).toHaveURL(/.+/);\n  });`;
    })
    .join('\n\n');

  const code = `import { test, expect } from '@playwright/test';\nimport { ${className} } from '../pages/${className}';\n\n// Auto-generated by the Generator agent from test plan: ${plan.id}\ntest.describe('${plan.feature}', () => {\n${testBlocks}\n});\n`;

  return { code, filePath };
}

async function llmGenerate(plan: TestPlan, context: string): Promise<{ pageObject?: string; spec?: string } | null> {
  const systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
  const userPrompt = `## Test Plan\n${JSON.stringify(plan, null, 2)}\n\n## Context\n${context}`;
  const response = await askLlm(systemPrompt, userPrompt);
  if (!response) return null;
  const blocks = Array.from(response.matchAll(/```typescript\s*([\s\S]*?)```/gi)).map((m) => m[1]);
  if (blocks.length < 2) return null;
  return { pageObject: blocks[0], spec: blocks[1] };
}

async function generateFromPlan(plan: TestPlan): Promise<void> {
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  fs.mkdirSync(TESTS_DIR, { recursive: true });

  const locatorMap = loadLocatorMap();
  const knownSelectors = scanExistingSelectors(PAGES_DIR);
  const conventions = readConventions();
  const healingHistory = loadHealingHistory();

  console.log(`[Generator] Context: ${knownSelectors.length} known selector(s), ${Object.keys(locatorMap).length} locator-map entr(y/ies), ${healingHistory.records.length} healing record(s).`);

  let pageObjectCode: string;
  let specCode: string;
  const className = `${pascalCase(plan.feature)}Page`;

  if (isLlmAvailable()) {
    const contextSummary = [
      `Known selectors:\n${knownSelectors.join('\n') || '(none yet)'}`,
      `Locator map:\n${JSON.stringify(locatorMap, null, 2)}`,
      `Conventions:\n${conventions || '(none yet)'}`,
      `Past healing patterns to avoid:\n${JSON.stringify(healingHistory.records.slice(-10), null, 2)}`,
    ].join('\n\n');
    const llmResult = await llmGenerate(plan, contextSummary);
    if (llmResult?.pageObject && llmResult?.spec) {
      pageObjectCode = llmResult.pageObject;
      specCode = llmResult.spec;
    } else {
      const po = buildPageObject(plan.feature, plan.cases, locatorMap, knownSelectors);
      pageObjectCode = po.code;
      specCode = buildSpecFile(plan, po.className, po.methods).code;
    }
  } else {
    const po = buildPageObject(plan.feature, plan.cases, locatorMap, knownSelectors);
    pageObjectCode = po.code;
    specCode = buildSpecFile(plan, po.className, po.methods).code;
  }

  const pageObjectPath = path.join(PAGES_DIR, `${className}.ts`);
  const specPath = path.join(TESTS_DIR, `${slugify(plan.feature)}.spec.ts`);

  fs.writeFileSync(pageObjectPath, pageObjectCode, 'utf-8');
  fs.writeFileSync(specPath, specCode, 'utf-8');

  // Register newly-scaffolded locators so future runs (and the Healer) know about them.
  for (const c of plan.cases) {
    for (const step of c.steps) {
      if (!step.target) continue;
      const key = `${className}:${slugify(step.target)}`;
      upsertLocator(key, {
        page: className,
        element: step.target,
        selector: resolveLocator(step.target, locatorMap, knownSelectors),
        strategy: 'role',
        lastVerified: new Date().toISOString(),
        timesHealed: 0,
      });
    }
  }

  console.log(`[Generator] Wrote ${pageObjectPath}`);
  console.log(`[Generator] Wrote ${specPath}`);
}

async function main() {
  const planIdArg = process.argv[2];
  const plan = planIdArg ? loadTestPlan(planIdArg) : latestTestPlan();

  if (!plan) {
    console.error('[Generator] No test plan found. Run `npm run agent:plan` first.');
    process.exit(1);
  }

  console.log(`[Generator] LLM backend: ${isLlmAvailable() ? 'Claude (ANTHROPIC_API_KEY set)' : 'heuristic fallback'}`);
  await generateFromPlan(plan);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Generator] Failed:', err);
    process.exit(1);
  });
}

export { generateFromPlan };
