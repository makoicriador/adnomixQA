/**
 * Optional LLM backend for the agents.
 *
 * All three agents (Planner, Generator, Healer) work with zero configuration
 * using deterministic, rule-based fallback logic. If ANTHROPIC_API_KEY is set,
 * they instead delegate the reasoning-heavy steps (writing test cases,
 * generating code, diagnosing failures) to Claude.
 *
 * This keeps the framework runnable out of the box while staying "agentic"
 * once a key is provided.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';

export function isLlmAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function askLlm(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    console.warn(`[llmClient] Anthropic API returned ${response.status}: ${await response.text()}`);
    return null;
  }

  const data = (await response.json()) as { content: { type: string; text?: string }[] };
  return data.content.find((block) => block.type === 'text')?.text ?? null;
}

/** Extracts the first fenced JSON block from an LLM response, or parses the whole string. */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate.trim()) as T;
  } catch {
    return null;
  }
}
