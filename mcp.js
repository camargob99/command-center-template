#!/usr/bin/env node
// Command Center as an MCP server (stdio), so Claude desktop and Duet can read and change your tasks.
// Add to Claude desktop: Settings > Developer > Edit config, then under "mcpServers":
//   "command-center": { "command": "node", "args": ["C:\\path\\to\\command-center\\mcp.js"] }
const readline = require('readline');
const { run } = require('./lib/client');

const { TOOLS, INSTRUCTIONS } = require('./lib/tools');

const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // notification
  const ok = (result) => out({ jsonrpc: '2.0', id: m.id, result });
  try {
    if (m.method === 'initialize') return ok({ protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'command-center', version: '2.2.0' }, instructions: INSTRUCTIONS });
    if (m.method === 'ping') return ok({});
    if (m.method === 'tools/list') return ok({ tools: TOOLS.map(({ op, ...t }) => t) });
    if (m.method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === m.params.name);
      if (!tool) throw new Error(`Unknown tool ${m.params.name}`);
      const [r] = await run([{ op: tool.op, ...(m.params.arguments || {}), source: 'claude' }]);
      return ok({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: r.ok === false });
    }
    out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `No method ${m.method}` } });
  } catch (e) { out({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: e.message } }); }
});
