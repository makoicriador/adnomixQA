import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Boilerplate showing how any agent (Planner, Generator, Healer) talks to the
 * local "adnomix-test-ops" MCP server instead of touching fs/child_process
 * directly. Run with `npm run mcp:demo`.
 *
 * The pattern:
 *   1. Spawn the MCP server as a child process over stdio.
 *   2. Connect an MCP Client to it.
 *   3. Call tools by name with typed arguments; read back `content[0].text`.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');

async function main() {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', path.join('mcp', 'server', 'testOpsServer.ts')],
    cwd: REPO_ROOT,
  });

  const client = new Client({ name: 'adnomix-agent-demo', version: '1.0.0' });
  await client.connect(transport);

  try {
    const tools = await client.listTools();
    console.log(
      '[demo] Available MCP tools:',
      tools.tools.map((t) => t.name)
    );

    const listing = await client.callTool({ name: 'list_dir', arguments: { path: '.' } });
    console.log('\n[demo] list_dir(".") ->\n', (listing.content as any)[0].text);

    const readme = await client.callTool({ name: 'read_file', arguments: { path: 'README.md' } });
    const readmeText = (readme.content as any)[0].text as string;
    console.log('\n[demo] read_file("README.md") -> first 200 chars:\n', readmeText.slice(0, 200));

    const written = await client.callTool({
      name: 'write_file',
      arguments: { path: '.agent-memory/.mcp-demo-scratch.txt', content: `MCP demo write at ${new Date().toISOString()}\n` },
    });
    console.log('\n[demo] write_file(...) ->', (written.content as any)[0].text);

    const report = await client.callTool({ name: 'read_report', arguments: { format: 'json' } });
    console.log('\n[demo] read_report("json") -> first 200 chars:\n', (report.content as any)[0].text.slice(0, 200));

    // Shell-command demo (commented out by default to avoid an unattended,
    // multi-minute browser run when this script is just being smoke-tested):
    // const run = await client.callTool({ name: 'run_tests', arguments: { grep: '@smoke' } });
    // console.log('\n[demo] run_tests({ grep: "@smoke" }) ->\n', (run.content as any)[0].text);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('[demo] Failed:', err);
  process.exit(1);
});
