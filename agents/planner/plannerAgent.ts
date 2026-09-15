import * as fs from 'fs';
import * as path from 'path';
import { TestCase, TestPlan } from '../shared/types';
import { saveTestPlan, getHighRiskAreas } from '../shared/memoryStore';
import { askLlm, extractJson, isLlmAvailable } from '../shared/llmClient';

const REQUIREMENTS_DIR = path.resolve(__dirname, '..', '..', 'requirements');
const PROMPT_PATH = path.join(__dirname, 'prompts', 'planner.prompt.md');

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Deterministic fallback used when no LLM key is configured. */
function heuristicPlan(source: string, markdown: string): TestPlan {
  const titleMatch = markdown.match(/^#\s*(?:Feature:\s*)?(.+)$/m);
  const feature = titleMatch ? titleMatch[1].trim() : path.basename(source, '.md');

  const acceptanceCriteria = Array.from(
    markdown.matchAll(/-\s*Given\s+(.+?),\s*when\s+(.+?),\s*then\s+(.+?)\.?$/gim)
  );

  const tagLine = markdown.match(/Tag this feature:\s*(.+)$/im);
  const tags = tagLine
    ? tagLine[1].match(/`([^`]+)`/g)?.map((t) => t.replace(/`/g, '')) ?? []
    : [];

  const riskAreas = Array.from(new Set(getHighRiskAreas().map((t) => t.testFile)));
  const featureSlug = slugify(feature);
  const riskSlugs = riskAreas.map((r) => slugify(path.basename(r, path.extname(r)).replace(/\.spec$/, '')));

  const cases: TestCase[] = acceptanceCriteria.map(([, given, when, then], idx) => {
    const isNegative = /incorrect|invalid|empty|locked|error|fail/i.test(when + then);
    const touchesRisk = riskSlugs.some((r) => r.includes(featureSlug) || featureSlug.includes(r));
    const skipEmail = /empty email/i.test(given);

    const steps: TestCase['steps'] = [];
    if (!skipEmail) steps.push({ action: 'fill', target: 'email field', data: given.trim() });
    steps.push({ action: 'fill', target: 'password field', data: when.trim() });
    steps.push({ action: 'click', target: 'submit button' });
    steps.push({ action: 'assert', expected: then.trim() });

    return {
      id: `${slugify(feature)}-${idx + 1}`,
      title: `${given} — ${when} → ${then}`.trim(),
      priority: touchesRisk ? 'high' : isNegative ? 'medium' : 'high',
      tags: [...tags, isNegative ? 'negative' : 'happy-path'],
      steps,
      riskNotes: touchesRisk ? ['Touches an area flagged as high-risk by failure trend analysis.'] : undefined,
    };
  });

  if (!cases.length) {
    cases.push({
      id: `${slugify(feature)}-1`,
      title: `Smoke check for ${feature}`,
      priority: 'medium',
      tags: [...tags, 'smoke'],
      steps: [{ action: 'assert', expected: 'Feature loads without error' }],
    });
  }

  return {
    id: `${slugify(feature)}-${Date.now()}`,
    feature,
    source,
    createdAt: new Date().toISOString(),
    riskAreas,
    cases,
  };
}

async function llmPlan(source: string, markdown: string): Promise<TestPlan | null> {
  const systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
  const highRisk = getHighRiskAreas();
  const userPrompt = [
    `## Requirement (${source})\n\n${markdown}`,
    `## Known high-risk areas (from failure trend memory)\n${JSON.stringify(highRisk, null, 2)}`,
  ].join('\n\n');

  const response = await askLlm(systemPrompt, userPrompt);
  if (!response) return null;
  return extractJson<TestPlan>(response);
}

async function planFeature(fileName: string): Promise<TestPlan> {
  const fullPath = path.join(REQUIREMENTS_DIR, fileName);
  const markdown = fs.readFileSync(fullPath, 'utf-8');

  const plan = isLlmAvailable() ? (await llmPlan(fileName, markdown)) ?? heuristicPlan(fileName, markdown) : heuristicPlan(fileName, markdown);

  const savedPath = saveTestPlan(plan);
  console.log(`[Planner] ${fileName} -> ${plan.cases.length} case(s) -> ${savedPath}`);
  return plan;
}

async function main() {
  if (!fs.existsSync(REQUIREMENTS_DIR)) {
    console.error(`[Planner] No requirements directory at ${REQUIREMENTS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(REQUIREMENTS_DIR).filter((f) => f.endsWith('.md'));
  if (!files.length) {
    console.warn('[Planner] No requirement files found (requirements/*.md).');
    return;
  }

  console.log(`[Planner] LLM backend: ${isLlmAvailable() ? 'Claude (ANTHROPIC_API_KEY set)' : 'heuristic fallback'}`);
  for (const file of files) {
    await planFeature(file);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Planner] Failed:', err);
    process.exit(1);
  });
}

export { planFeature, heuristicPlan };
