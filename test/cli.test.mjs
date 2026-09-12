import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const execute = promisify(execFile);

async function cli(args) {
  return execute(process.execPath, ['src/cli.mjs', ...args], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', windowsHide: true,
  });
}

test('CLIヘルプはMCPサーバーを起動せず利用方法を表示する', async () => {
  const { stdout, stderr } = await cli(['--help']);
  assert.match(stdout, /proton-pass-mcp setup/);
  assert.equal(stderr, '');
});

test('setupヘルプはネットワークへ接続せずオプションを表示する', async () => {
  const { stdout, stderr } = await cli(['setup', '--help']);
  assert.match(stdout, /--install-dir/);
  assert.match(stdout, /--force/);
  assert.equal(stderr, '');
});

test('未知のコマンドはMCPサーバーを起動せず失敗する', async () => {
  await assert.rejects(cli(['unknown']), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /不明なコマンド/);
    return true;
  });
});
