import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reason, field } from '../src/inputs.mjs';
import { PassClient, runCli } from '../src/pass.mjs';

test('理由の300文字境界はUnicodeコードポイント数で検証する', () => {
  for (const character of ['a', 'あ', '🔑']) {
    assert.equal(reason.parse(` ${character.repeat(300)} `), character.repeat(300));
    assert.equal(reason.safeParse(character.repeat(301)).success, false);
  }
  assert.equal(reason.safeParse('    ').success, false);
  assert.equal(reason.safeParse('abcd').success, false);
  assert.equal(reason.parse(' abcde '), 'abcde');
});

test('カスタムフィールド名を変形せず単一引数で渡す', async () => {
  for (const name of ['password', 'My Custom Field', '本番.パスワード', '--help', 'key=value', '$(echo test); & x']) {
    const parsed = field.parse(name);
    const client = new PassClient({ executable: 'fake', sessionDir: 'fake', runner: async (_, args) => {
      if (args[0] === 'info') return '';
      assert.deepEqual(args, ['item', 'view', '--share-id', 'vault', '--item-id', 'item', `--field=${name}`]);
      const actual = await runCli(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', args.at(-1)], process.env);
      assert.deepEqual(JSON.parse(actual), [`--field=${name}`]);
      return 'dummy-value\n';
    } });
    assert.equal((await client.field({ share_id: 'vault', item_id: 'item', field: parsed, reason: 'test reason' })).value, 'dummy-value');
  }
  for (const name of ['', 'x\0y', 'x\ny', 'x\ty', 'x\u007fy', 'x'.repeat(101)]) {
    assert.equal(field.safeParse(name).success, false);
  }
});

test('大小文字の異なるPAT・旧理由・セッションを整理し子プロセスでも確認する', async () => {
  const original = { ...process.env, proton_pass_personal_access_token: 'dummy',
    Proton_Pass_Agent_Reason: 'old', proton_pass_session_dir: 'stale',
    PROTON_PASS_SESSION_DIR: 'also-stale' };
  const calls = [];
  const client = new PassClient({ executable: 'fake', sessionDir: 'chosen', env: original,
    runner: async (_, args, env) => {
      const output = await runCli(process.execPath, ['-e', `process.stdout.write(JSON.stringify({
        pat: Object.keys(process.env).some(key => key.toUpperCase() === 'PROTON_PASS_PERSONAL_ACCESS_TOKEN'),
        reasons: Object.keys(process.env).filter(key => key.toUpperCase() === 'PROTON_PASS_AGENT_REASON').map(key => process.env[key]),
        sessions: Object.keys(process.env).filter(key => key.toUpperCase() === 'PROTON_PASS_SESSION_DIR').map(key => process.env[key])
      }))`], env);
      calls.push(JSON.parse(output));
      return args[0] === 'info' ? '' : 'dummy-value';
    } });
  await client.field({ share_id: 'vault', item_id: 'item', field: 'password', reason: 'new reason' });
  await client.info();
  assert.deepEqual(calls, [
    { pat: false, reasons: [], sessions: ['chosen'] },
    { pat: false, reasons: ['new reason'], sessions: ['chosen'] },
    { pat: false, reasons: [], sessions: ['chosen'] },
  ]);
  assert.equal(original.proton_pass_personal_access_token, 'dummy');
  assert.equal(original.Proton_Pass_Agent_Reason, 'old');
});
