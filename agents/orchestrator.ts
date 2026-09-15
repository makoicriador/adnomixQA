import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { planFeature } from './planner/plannerAgent';
import { generateFromPlan } from './generator/generatorAgent';
import { flattenFailures, healFailure } from './healer/healerAgent';

/**
 * Runs one full agentic cycle: Plan -> Generate -> Execute -> Heal.
 * Intended as the reference entry point wiring all three agents together;
 * each agent also runs standalone via its own npm script.
 */

const REQUIREMENTS_DIR = path.resolve(__dirname, '..', 'requirements');
const REPORT_PATH = path.resolve(__dirname, '..', 'test-results', 'results.json');

async function main() {
  const applyFixes = process.argv.includes('--apply');

  console.log('=== 1/4 Planner: reading requirements ===');
  const files = fs.readdirSync(REQUIREMENTS_DIR).filter((f) => f.endsWith('.md'));
  if (!files.length) {
    console.error('No requirement files in /requirements. Add a .md user story first.');
    process.exit(1);
  }
  const plans = [];
  for (const file of files) {
    plans.push(await planFeature(file));
  }

  console.log('\n=== 2/4 Generator: scaffolding page objects + specs ===');
  for (const plan of plans) {
    await generateFromPlan(plan);
  }

  console.log('\n=== 3/4 Execution: running Playwright ===');
  const result = spawnSync('npx playwright test', { stdio: 'inherit', shell: true });

  console.log('\n=== 4/4 Healer: analyzing results ===');
  if (!fs.existsSync(REPORT_PATH)) {
    console.warn('No results.json produced; skipping healing step.');
    return;
  }
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'));
  const failures = flattenFailures(report);
  if (!failures.length) {
    console.log('All tests passed. Nothing to heal.');
  } else {
    for (const failure of failures) {
      await healFailure(failure, applyFixes);
    }
  }

  process.exitCode = result.status ?? 0;
}

main().catch((err) => {
  console.error('[Orchestrator] Failed:', err);
  process.exit(1);
});
