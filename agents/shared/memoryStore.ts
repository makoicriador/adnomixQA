import * as fs from 'fs';
import * as path from 'path';
import {
  HealingHistory,
  HealingRecord,
  LocatorMap,
  LocatorMapEntry,
  FailureTrends,
  FailureTrend,
  TestPlan,
} from './types';

/**
 * Single access point to the .agent-memory/ store.
 * Every agent (Planner, Generator, Healer) reads and writes through this
 * module so the on-disk JSON stays consistently shaped across agents.
 */
const MEMORY_ROOT = path.resolve(__dirname, '..', '..', '.agent-memory');

const PATHS = {
  healingHistory: path.join(MEMORY_ROOT, 'healing_history.json'),
  locatorMap: path.join(MEMORY_ROOT, 'locator_map.json'),
  failureTrends: path.join(MEMORY_ROOT, 'failure_trends.json'),
  conventions: path.join(MEMORY_ROOT, 'project_conventions.md'),
  testPlansDir: path.join(MEMORY_ROOT, 'test-plans'),
};

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return raw.trim() ? (JSON.parse(raw) as T) : fallback;
  } catch (err) {
    console.warn(`[memoryStore] Failed to read ${filePath}, using fallback.`, err);
    return fallback;
  }
}

function writeJson<T>(filePath: string, data: T): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---- Healing history -------------------------------------------------

export function loadHealingHistory(): HealingHistory {
  return readJson<HealingHistory>(PATHS.healingHistory, { records: [] });
}

export function appendHealingRecord(record: HealingRecord): void {
  const history = loadHealingHistory();
  history.records.push(record);
  writeJson(PATHS.healingHistory, history);
}

// ---- Locator map -------------------------------------------------------

export function loadLocatorMap(): LocatorMap {
  return readJson<LocatorMap>(PATHS.locatorMap, {});
}

export function upsertLocator(key: string, entry: LocatorMapEntry): void {
  const map = loadLocatorMap();
  const existing = map[key];
  map[key] = {
    ...entry,
    timesHealed: existing ? existing.timesHealed + (entry.timesHealed || 0) : entry.timesHealed || 0,
  };
  writeJson(PATHS.locatorMap, map);
}

// ---- Failure trends ------------------------------------------------------

export function loadFailureTrends(): FailureTrends {
  return readJson<FailureTrends>(PATHS.failureTrends, { trends: [] });
}

export function recordFailure(testFile: string, testTitle: string, failureType: string): void {
  const trends = loadFailureTrends();
  let trend = trends.trends.find((t) => t.testFile === testFile && t.testTitle === testTitle);
  if (!trend) {
    trend = {
      testFile,
      testTitle,
      failureCount: 0,
      lastFailure: new Date().toISOString(),
      failureTypes: {},
      flakinessScore: 0,
    };
    trends.trends.push(trend);
  }
  trend.failureCount += 1;
  trend.lastFailure = new Date().toISOString();
  trend.failureTypes[failureType] = (trend.failureTypes[failureType] || 0) + 1;
  // Simple recency-weighted flakiness heuristic: more failures + more distinct
  // failure types => higher score. Consumed by the Planner's risk analysis.
  trend.flakinessScore = trend.failureCount + Object.keys(trend.failureTypes).length * 0.5;
  writeJson(PATHS.failureTrends, trends);
}

export function getHighRiskAreas(minScore = 2): FailureTrend[] {
  return loadFailureTrends()
    .trends.filter((t) => t.flakinessScore >= minScore)
    .sort((a, b) => b.flakinessScore - a.flakinessScore);
}

// ---- Project conventions (freeform markdown knowledge) -------------------

export function readConventions(): string {
  try {
    return fs.readFileSync(PATHS.conventions, 'utf-8');
  } catch {
    return '';
  }
}

export function appendConvention(note: string): void {
  fs.mkdirSync(MEMORY_ROOT, { recursive: true });
  const stamp = new Date().toISOString();
  fs.appendFileSync(PATHS.conventions, `\n- [${stamp}] ${note}\n`, 'utf-8');
}

// ---- Test plans ------------------------------------------------------------

export function saveTestPlan(plan: TestPlan): string {
  fs.mkdirSync(PATHS.testPlansDir, { recursive: true });
  const filePath = path.join(PATHS.testPlansDir, `${plan.id}.json`);
  writeJson(filePath, plan);
  return filePath;
}

export function loadTestPlan(id: string): TestPlan | null {
  const filePath = path.join(PATHS.testPlansDir, `${id}.json`);
  return readJson<TestPlan | null>(filePath, null);
}

export function listTestPlans(): TestPlan[] {
  if (!fs.existsSync(PATHS.testPlansDir)) return [];
  return fs
    .readdirSync(PATHS.testPlansDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson<TestPlan | null>(path.join(PATHS.testPlansDir, f), null))
    .filter((p): p is TestPlan => p !== null);
}

export function latestTestPlan(): TestPlan | null {
  const plans = listTestPlans();
  if (!plans.length) return null;
  return plans.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

// ---- Page object / selector discovery (Generator context awareness) -------

export function scanExistingSelectors(pagesDir = path.resolve(__dirname, '..', '..', 'pages')): string[] {
  const results: string[] = [];
  if (!fs.existsSync(pagesDir)) return results;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const content = fs.readFileSync(full, 'utf-8');
        const matches = content.match(/getBy(Role|TestId|Text|Label|Placeholder)\([^)]*\)|locator\(['"`][^'"`]+['"`]\)/g);
        if (matches) results.push(...matches.map((m) => `${path.basename(full)}: ${m}`));
      }
    }
  };
  walk(pagesDir);
  return results;
}

export { PATHS as MEMORY_PATHS, MEMORY_ROOT };
