import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassClient, PassError, runCli, checkCancellation } from '../src/pass.mjs';

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
      if (args[0] === 'share') return JSON.stringify({ shares: [{ id: 'vault', name: 'Default', share_type: 'Vault', share_role: 'Owner' }] });
      if (args[1] === 'list') return JSON.stringify({ items });
      if (args.some(arg => arg.startsWith('--field='))) return 'field-value\n';
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
    ? JSON.stringify({ items: [{ id: 'a', share_id: 'vault', title: 'title', state: 'Active', item_type: 'note' }] }) : '{"item":{}}').client;
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

test('認証エラーを具体的に分類し、sessionを含むだけの障害は未認証扱いしない', async () => {
  const cases = [
    ['Command is not logout there is no session\nError: This operation requires an authenticated client',
      '指定された保存先に有効なProton Passセッションがありません。同じ PROTON_PASS_SESSION_DIR で認証状態を確認してください。失効理由はCLIから取得できません。'],
    ['Your session has been invalidated and you have been logged out automatically.\nPlease log in again with: pass login',
      'Proton Passセッションが無効化され、CLIにより自動ログアウトされました。同じ PROTON_PASS_SESSION_DIR で再認証してください。'],
    ['Error: This operation requires an authenticated client',
      'Proton Passの認証が必要です。同じ PROTON_PASS_SESSION_DIR で再認証してください。'],
    ['Error: Permission denied reading session.json',
      'pass-cli が失敗しました。対象ID・フィールド名・接続とアクセス権を確認してください。'],
    ['Error: connection failed at https://example.invalid/session',
      'pass-cli が失敗しました。対象ID・フィールド名・接続とアクセス権を確認してください。'],
  ];
  for (const [stderr, expected] of cases) {
    await assert.rejects(runCli(process.execPath,
      ['-e', `process.stderr.write(${JSON.stringify(stderr + '\nSECRET_PASSWORD')}); process.exit(1)`], process.env), error => {
      assert.ok(error instanceof PassError);
      assert.equal(error.message, expected);
      assert.equal(error.stderr, undefined);
      assert.equal(error.stdout, undefined);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('指定フィールド1つを理由付きで取得し共有IDも正しく返す', async () => {
  const { client, calls } = setup();
  assert.deepEqual(await client.field({ share_id: 'vault', item_id: 'a', field: 'password', reason: 'explicit request' }),
    { field: 'password', value: 'field-value' });
  assert.equal(calls[1].args.at(-1), '--field=password');
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

test('不正な一覧メタデータは一覧・ノート検索とも安全な構造エラーにする', async () => {
  const valid = { id: 'a', share_id: 'vault', title: '', state: 'Active', item_type: 'note' };
  const malformed = [null, ...Object.keys(valid).flatMap(key =>
    [undefined, null, 42, { secret: 'DO_NOT_RETURN' }].map(value => ({ ...valid, [key]: value })))];
  for (const item of malformed) {
    const { client, calls } = setup(async args => args[0] === 'info' ? '' : JSON.stringify({ items: [item] }));
    for (const work of [() => client.listItems({ share_id: 'vault' }),
      () => client.searchNotes({ share_id: 'vault', query: 'x', reason: 'test reason' })]) {
      await assert.rejects(work(), error => {
        assert.ok(error instanceof PassError);
        assert.equal(error.message, 'pass-cliのJSON構造が想定と異なります。');
        return true;
      });
    }
    assert.ok(calls.every(call => !call.args.includes('view')));
  }
  const { client } = setup(async args => args[0] === 'info' ? '' : JSON.stringify({ items: [valid] }));
  assert.equal((await client.listItems({ share_id: 'vault' })).items[0].title, '');
});

test('キュー待ち中のキャンセルは秘密の理由を出さず後続処理を妨げない', async () => {
  const { client, calls } = setup();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = client.exclusive(() => gate);
  const controller = new AbortController();
  const cancelled = client.exclusive(async () => {
    checkCancellation(controller.signal);
    return client.info(controller.signal);
  });
  const rejected = assert.rejects(cancelled, error => {
    assert.ok(error instanceof PassError);
    assert.equal(error.message, '呼び出しをキャンセルしました。');
    return true;
  });
  controller.abort(new Error('SECRET_REASON'));
  const next = client.exclusive(() => client.info());
  release();
  await Promise.all([first, rejected, next]);
  assert.equal(calls.length, 1);
  assert.doesNotThrow(() => checkCancellation(new AbortController().signal));
});

test('保管庫・共有はCLIの型に従い許可メタデータだけを返す', async () => {
  const vault = { name: 'name', share_id: 'v', secret: 'DO_NOT_RETURN' };
  const share = { id: 's', name: 'name', share_type: 'Item', share_role: 'Viewer', secret: 'DO_NOT_RETURN' };
  const make = data => setup(async args => args[0] === 'info' ? '' : JSON.stringify(data)).client;
  assert.deepEqual(await make({ vaults: [vault] }).vaults(), { vaults: [{ name: 'name', share_id: 'v' }] });
  for (const role of ['Owner', 'Manager', 'Editor', 'Viewer', { Custom: { name: 'custom', permission: 63 } }]) {
    const value = { ...share, share_role: typeof role === 'object'
      ? { Custom: { ...role.Custom, secret: 'DO_NOT_RETURN' }, secret: 'DO_NOT_RETURN' } : role };
    assert.deepEqual((await make({ shares: [value] }).shares()).shares[0],
      { share_id: 's', name: 'name', share_type: 'Item', share_role: role });
  }
  for (const value of [undefined, null, [], { secret: 'DO_NOT_RETURN' }, 1]) {
    for (const key of ['name', 'share_id']) {
      await assert.rejects(make({ vaults: [{ ...vault, [key]: value }] }).vaults(), PassError);
    }
    for (const key of ['id', 'name', 'share_type', 'share_role']) {
      await assert.rejects(make({ shares: [{ ...share, [key]: value }] }).shares(), PassError);
    }
  }
  for (const role of ['unknown', { Custom: { name: {}, permission: 1 } },
    { Custom: { name: 'x', permission: -1 } }, { Custom: { name: 'x', permission: 65536 } },
    { Custom: { name: 'x', permission: 1.5 } }]) {
    await assert.rejects(make({ shares: [{ ...share, share_role: role }] }).shares(), PassError);
  }
  for (const method of ['vaults', 'shares', 'items']) {
    await assert.rejects(make(null)[method]({ share_id: 'v' }), PassError);
    const root = method === 'items' ? 'items' : method;
    await assert.rejects(make({ [root]: [null] })[method]({ share_id: 'v' }), PassError);
  }
});

test('stdoutとstderrの出力上限超過は内容を出さず専用エラーにする', async () => {
  for (const stream of ['stdout', 'stderr']) {
    await assert.rejects(runCli(process.execPath,
      ['-e', `process.${stream}.write('SECRET'.repeat(1500000))`], process.env), error => {
      assert.ok(error instanceof PassError);
      assert.equal(error.message, 'pass-cli の出力が上限（8 MiB）を超えました。');
      assert.equal(error.stdout, undefined);
      assert.equal(error.stderr, undefined);
      return true;
    });
  }
});
