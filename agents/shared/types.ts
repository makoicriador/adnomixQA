export interface TestStep {
  action: string;
  target?: string;
  data?: string;
  expected?: string;
}

export interface TestCase {
  id: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  tags: string[];
  steps: TestStep[];
  riskNotes?: string[];
}

export interface TestPlan {
  id: string;
  feature: string;
  source: string;
  createdAt: string;
  riskAreas: string[];
  cases: TestCase[];
}

export interface LocatorMapEntry {
  page: string;
  element: string;
  selector: string;
  strategy: 'role' | 'testid' | 'text' | 'css' | 'xpath';
  lastVerified: string;
  timesHealed: number;
}

export type LocatorMap = Record<string, LocatorMapEntry>;

export interface HealingRecord {
  id: string;
  timestamp: string;
  testFile: string;
  testTitle: string;
  failureType: 'stale-locator' | 'timeout' | 'assertion' | 'unknown';
  oldSelector?: string;
  newSelector?: string;
  reasoning: string;
  applied: boolean;
  confidence: number;
}

export interface HealingHistory {
  records: HealingRecord[];
}

export interface FailureTrend {
  testFile: string;
  testTitle: string;
  failureCount: number;
  lastFailure: string;
  failureTypes: Record<string, number>;
  flakinessScore: number;
}

export interface FailureTrends {
  trends: FailureTrend[];
}

export interface PlaywrightJsonReport {
  suites: any[];
  stats?: Record<string, unknown>;
}
