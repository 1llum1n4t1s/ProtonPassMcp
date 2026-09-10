import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'proton-pass-verification', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
  env: { ...process.env }, stderr: 'pipe' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 6);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
    assert.ok(!result.isError, `Tool failed: ${name}`);
    return result.structuredContent;
  };
  assert.equal((await call('session_status')).authenticated, true);
  const vaults = (await call('list_vaults')).vaults;
  assert.ok(vaults.length > 0);
  const shares = (await call('list_shares')).shares;
  assert.ok(shares.every(s => typeof s.share_id === 'string'));
  const invalid = await client.callTool({ name: 'read_field', arguments: { share_id: vaults[0].share_id,
    item_id: 'x', field: 'password', reason: '' } });
  assert.equal(invalid.isError, true);
  console.log(JSON.stringify({ protocol: 'passed', tools: tools.map(t => t.name), vaults: vaults.length, shares: shares.length, validation: 'passed' }));
} finally {
  await client.close();
}
