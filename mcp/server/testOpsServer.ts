import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * "test-ops" MCP server.
 *
 * Exposes a small, deliberately-narrow toolset so the Planner, Generator, and
 * Healer agents (or any MCP-capable client) can interact with this project's
 * filesystem and test runner without shelling out arbitrarily:
 *   - read_file / write_file / list_dir: sandboxed to the repo root.
 *   - run_tests: runs Playwright via a fixed argv array (no shell string
 *     interpolation), optionally filtered by a `grep` title pattern.
 *   - read_report: reads the JSON or JUnit XML report produced by the run.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function resolveInRepo(relativePath: string): string {
  const resolved = path.resolve(REPO_ROOT, relativePath);
  if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep)) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }
  return resolved;
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

const server = new McpServer({ name: 'adnomix-test-ops', version: '1.0.0' });

server.registerTool(
  'read_file',
  {
    title: 'Read File',
    description: 'Read a UTF-8 text file relative to the project root.',
    inputSchema: { path: z.string().describe('Path relative to the project root, e.g. "tests/login.spec.ts"') },
  },
  async ({ path: relPath }) => {
    const absPath = resolveInRepo(relPath);
    const content = fs.readFileSync(absPath, 'utf-8');
    return textResult(content);
  }
);

server.registerTool(
  'write_file',
  {
    title: 'Write File',
    description: 'Write (or overwrite) a UTF-8 text file relative to the project root, creating parent directories as needed.',
    inputSchema: {
      path: z.string().describe('Path relative to the project root'),
      content: z.string().describe('Full file content to write'),
    },
  },
  async ({ path: relPath, content }) => {
    const absPath = resolveInRepo(relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
    return textResult(`Wrote ${content.length} bytes to ${relPath}`);
  }
);

server.registerTool(
  'list_dir',
  {
    title: 'List Directory',
    description: 'List files and folders at a path relative to the project root.',
    inputSchema: { path: z.string().default('.').describe('Directory relative to the project root') },
  },
  async ({ path: relPath }) => {
    const absPath = resolveInRepo(relPath ?? '.');
    const entries = fs.readdirSync(absPath, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    return textResult(entries.join('\n'));
  }
);

const ALLOWED_TEST_ARGS = /^[a-zA-Z0-9 _\-./@:*]*$/;

server.registerTool(
  'run_tests',
  {
    title: 'Run Playwright Tests',
    description: 'Executes `npx playwright test`, optionally filtered by a title/tag grep pattern, project, and/or specific spec file(s).',
    inputSchema: {
      grep: z.string().optional().describe('Optional pattern passed to --grep'),
      project: z.string().optional().describe('Optional Playwright project name'),
      files: z.array(z.string()).optional().describe('Optional spec file paths (relative to the project root) to run instead of the whole suite'),
    },
  },
  async ({ grep, project, files }) => {
    const args = ['playwright', 'test'];
    if (grep) {
      if (!ALLOWED_TEST_ARGS.test(grep)) throw new Error('grep pattern contains disallowed characters');
      args.push('--grep', grep);
    }
    if (project) {
      if (!ALLOWED_TEST_ARGS.test(project)) throw new Error('project name contains disallowed characters');
      args.push('--project', project);
    }
    if (files) {
      for (const file of files) {
        resolveInRepo(file); // throws if the path escapes the project root
        args.push(file);
      }
    }

    const output = await new Promise<string>((resolve) => {
      // shell: true is required for npx to resolve on Windows (npx.cmd);
      // args are still passed as an array, which Node escapes per-platform.
      // Safe here because every element is either a fixed literal or has
      // already been validated (ALLOWED_TEST_ARGS / resolveInRepo above).
      execFile('npx', args, { cwd: REPO_ROOT, shell: true, timeout: 10 * 60 * 1000 }, (error, stdout, stderr) => {
        resolve(`${stdout}\n${stderr}\n${error ? `Exit: ${error.code}` : 'Exit: 0'}`);
      });
    });

    return textResult(output);
  }
);

server.registerTool(
  'read_report',
  {
    title: 'Read Test Report',
    description: 'Reads the last Playwright run report (JSON or JUnit XML) from test-results/.',
    inputSchema: { format: z.enum(['json', 'junit']).default('json') },
  },
  async ({ format }) => {
    const file = format === 'junit' ? 'results.xml' : 'results.json';
    const absPath = resolveInRepo(path.join('test-results', file));
    if (!fs.existsSync(absPath)) {
      return textResult(`No report found at test-results/${file}. Run the run_tests tool first.`);
    }
    return textResult(fs.readFileSync(absPath, 'utf-8'));
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[test-ops MCP server] Listening on stdio.');
}

main().catch((err) => {
  console.error('[test-ops MCP server] Fatal error:', err);
  process.exit(1);
});
