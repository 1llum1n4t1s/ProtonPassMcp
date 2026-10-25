import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'proton-pass-verification', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('../src/cli.mjs', import.meta.url))],
  env: { ...process.env }, stderr: 'pipe' });
try {
  await client.connect(transport);
  assert.ok(client.getInstructions()?.includes('create_field_handoff'));
  const { tools } = await client.listTools();
  const secretReadDisabled = process.env.PROTON_PASS_DISABLE_SECRET_READ === '1';
  const fileTools = ['create_field_handoff', 'release_field_handoff'];
  const expectedTools = ['session_status', 'list_vaults', 'list_shares', 'list_items', 'search_notes', ...fileTools];
  if (!secretReadDisabled) expectedTools.push('read_field');
  assert.deepEqual(tools.map(tool => tool.name).sort(), expectedTools.sort());
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint === !fileTools.includes(tool.name)));
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
    assert.ok(!result.isError, `Tool failed: ${name}`);
    return result.structuredContent;
  };
  assert.equal((await call('session_status')).authenticated, true);
  const vaults = (await call('list_vaults')).vaults;
  const shares = (await call('list_shares')).shares;
  assert.ok(shares.every(s => typeof s.share_id === 'string'));
  const policy = process.env.PROTON_PASS_ACCESS_POLICY === undefined
    ? undefined : JSON.parse(process.env.PROTON_PASS_ACCESS_POLICY);
  if (policy) {
    const allowedShares = new Set(policy.allowed_items.map(item => item.share_id));
    assert.ok([...vaults, ...shares].every(item => allowedShares.has(item.share_id)));
    if (policy.allowed_items.length) {
      const shareId = policy.allowed_items[0].share_id;
      const result = await call('list_items', { share_id: shareId });
      assert.ok(result.items.every(item => item.share_id === shareId
        && policy.allowed_items.some(allowed => allowed.share_id === item.share_id && allowed.item_id === item.id)));
    }
  } else {
    assert.ok(vaults.length > 0);
  }
  const validationShare = vaults[0]?.share_id ?? shares[0]?.share_id ?? 'validation';
  const invalid = secretReadDisabled
    ? await client.callTool({ name: 'read_field', arguments: { share_id: validationShare,
      item_id: 'x', field: 'password', reason: '無効化された取得ツールの拒否を確認する' } })
    : await client.callTool({ name: 'read_field', arguments: { share_id: validationShare,
      item_id: 'x', field: 'password', reason: '' } });
  assert.equal(invalid.isError, true);
  const invalidSearch = await client.callTool({ name: 'search_notes', arguments: {
    share_id: validationShare, query: 'validation', reason: '',
  } });
  assert.equal(invalidSearch.isError, true);
  const invalidHandoff = await client.callTool({ name: 'create_field_handoff', arguments: {
    share_id: validationShare, item_id: 'x', field: 'password', reason: '',
  } });
  assert.equal(invalidHandoff.isError, true);
  assert.deepEqual(await call('release_field_handoff', { handoff_id: '0'.repeat(32) }), { released: false });
  console.log(JSON.stringify({ protocol: 'passed', tools: tools.map(t => t.name), vaults: vaults.length, shares: shares.length, validation: 'passed' }));
} finally {
  await client.close();
}
