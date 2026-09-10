import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassClient, PassError, runCli } from '../src/pass.mjs';

function setup(override) {
  const calls = [];
  const items = [
    { id: 'a', share_id: 'vault', title: '一致', state: 'Trashed', item_type: 'note', password: 'DO_NOT_RETURN' },
    { id: 'b', share_id: 'vault', title: '別', state: 'Active', item_type: 'note' },
  ];
  const client = new PassClient({ executable: 'fake', sessionDir: 'isolated',
    env: { PROTON_PASS_PERSONAL_ACCESS_TOKEN: 'DO_NOT_PASS', PROTON_PASS_AGENT_REASON: 'old' },
    runner: async (exe, args, env) => {
      calls.push({ args, env });
      if (override) return override(args);
      if (args[0] === 'info') return 'authenticated';
      if (args[0] === 'share') return JSON.stringify({ shares: [{ id: 'vault', name: 'Default' }] });
      if (args[1] === 'list') return JSON.stringify({ items });
      if (args.includes('--field')) return 'field-value\n';
      return JSON.stringify({ item: { content: { title: 'title', note:
        args.includes('a') ? 'SECRET Keeperからインポート PRIVATE' : 'unrelated' } } });
    } });
  return { client, calls, items };
}

test('本文・秘密を返さず検索を続行し各CLI操作前に認証を確認する', async () => {
  const { client, calls } = setup();
  const input = { share_id: 'vault', query: 'Keeperからインポート', reason: '指定文字列の検索', state: 'all', page_size: 1 };
  const first = await client.searchNotes(input);
  assert.equal(first.matches[0].title, '一致');
  assert.equal(first.complete, false);
  assert.equal(JSON.stringify(first).includes('SECRET'), false);
  assert.equal(JSON.stringify(first).includes('DO_NOT_RETURN'), false);
  const second = await client.searchNotes({ ...input, cursor: first.next_cursor });
  assert.equal(second.complete, true);
  assert.equal(second.checked_total, 2);
  assert.deepEqual(second.matches, []);
  for (let i = 0; i < calls.length; i += 2) {
    assert.deepEqual(calls[i].args, ['info']);
    assert.equal(calls[i].env.PROTON_PASS_PERSONAL_ACCESS_TOKEN, undefined);
    assert.equal(calls[i].env.PROTON_PASS_AGENT_REASON, undefined);
  }
  assert.equal(calls.find(c => c.args[1] === 'view').env.PROTON_PASS_AGENT_REASON, input.reason);
});

test('別条件・一覧変更・不正なカーソルは拒否する', async () => {
  const { client, items } = setup();
  const input = { share_id: 'vault', query: 'Keeper', reason: 'test reason', page_size: 1 };
  const first = await client.searchNotes(input);
  await assert.rejects(client.searchNotes({ ...input, query: 'different', cursor: first.next_cursor }), PassError);
  await assert.rejects(client.searchNotes({ ...input, cursor: 'invalid' }), PassError);
  items.pop();
  await assert.rejects(client.searchNotes({ ...input, cursor: first.next_cursor }), PassError);
});

test('空一覧は完了、想定外JSON構造はエラーにする', async () => {
  const { client, items } = setup();
  items.length = 0;
  assert.equal((await client.searchNotes({ share_id: 'vault', query: 'x', reason: 'reason' })).complete, true);
  const broken = setup(async args => args[0] === 'info' ? '' : args[1] === 'list'
    ? JSON.stringify({ items: [{ id: 'a', share_id: 'vault' }] }) : '{"item":{}}').client;
  await assert.rejects(broken.searchNotes({ share_id: 'vault', query: 'x', reason: 'reason' }), PassError);
});

test('認証失敗時にデータ取得を実行しない', async () => {
  const { client, calls } = setup(async () => { throw new PassError('authentication required'); });
  await assert.rejects(client.vaults(), PassError);
  assert.equal(calls.length, 1);
});

test('CLIの生エラーに含まれる秘密を返さない', async () => {
  await assert.rejects(runCli(process.execPath,
    ['-e', 'process.stderr.write("SECRET_PASSWORD"); process.exit(1)'], process.env), error => {
    assert.ok(error instanceof PassError);
    assert.equal(error.message.includes('SECRET_PASSWORD'), false);
    assert.equal(error.stderr, undefined);
    return true;
  });
});

test('指定フィールド1つを理由付きで取得し共有IDも正しく返す', async () => {
  const { client, calls } = setup();
  assert.deepEqual(await client.field({ share_id: 'vault', item_id: 'a', field: 'password', reason: 'explicit request' }),
    { field: 'password', value: 'field-value' });
  assert.deepEqual(calls[1].args.slice(-2), ['--field', 'password']);
  assert.equal(calls[1].env.PROTON_PASS_AGENT_REASON, 'explicit request');
  assert.equal((await client.shares()).shares[0].share_id, 'vault');
  assert.equal(JSON.stringify(await client.listItems({ share_id: 'vault' })).includes('password'), false);
});

test('同時アクセスは直列化し失敗後も次を実行する', async () => {
  const { client } = setup();
  const order = [];
  const one = client.exclusive(async () => { order.push(1); await new Promise(r => setTimeout(r, 10)); order.push(2); throw new PassError('failed'); });
  const two = client.exclusive(async () => { order.push(3); });
  await Promise.allSettled([one, two]);
  assert.deepEqual(order, [1, 2, 3]);
});
