import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { removeFixture } from './cleanup-fixture.mjs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MANIFEST_URL, SetupError, platformAssetKey, resolveCliPath, runSetup,
  selectManifestAsset,
} from '../src/setup.mjs';

function release(asset, overrides = {}) {
  const hash = createHash('sha256').update(asset).digest('hex');
  return {
    formatVersion: 1,
    passCliVersions: {
      version: '2.3.3',
      urls: {
        linux: { x86_64: { url: 'https://proton.me/download/pass-cli/2.3.3/pass-cli-linux-x86_64', hash } },
        macos: { aarch64: { url: 'https://proton.me/download/pass-cli/2.3.3/pass-cli-macos-aarch64', hash } },
        windows: { x86_64: { url: 'https://proton.me/download/pass-cli/2.3.3/pass-cli-windows-x86_64.zip', hash } },
      },
      ...overrides,
    },
  };
}

function responses(manifest, asset, calls = []) {
  return async url => {
    const value = url.toString();
    calls.push(value);
    if (value === MANIFEST_URL) return new Response(JSON.stringify(manifest));
    return new Response(asset);
  };
}

async function temporary() {
  return mkdtemp(path.join(os.tmpdir(), 'proton-pass-mcp-test-'));
}

test('公式マニフェストから対応platform/archの資産だけを選ぶ', () => {
  const manifest = release(Buffer.from('asset'));
  assert.deepEqual(platformAssetKey('win32', 'x64'), { platformKey: 'windows', archKey: 'x86_64' });
  assert.deepEqual(platformAssetKey('darwin', 'arm64'), { platformKey: 'macos', archKey: 'aarch64' });
  assert.deepEqual(platformAssetKey('linux', 'x64'), { platformKey: 'linux', archKey: 'x86_64' });
  assert.equal(selectManifestAsset(manifest, 'linux', 'x64').version, '2.3.3');
  for (const pair of [['win32', 'arm64'], ['freebsd', 'x64'], ['linux', 'ia32']]) {
    assert.throws(() => platformAssetKey(...pair), SetupError);
  }
  for (const invalid of [null, {}, { ...manifest, formatVersion: 2 },
    release(Buffer.from('asset'), { version: '' })]) {
    assert.throws(() => selectManifestAsset(invalid, 'linux', 'x64'), SetupError);
  }
});

test('PASS_CLI_PATHを固定指定として扱い、省略時だけ導入先とPATHを探索する', async t => {
  const root = await temporary();
  t.after(() => removeFixture(root, { recursive: true, force: true }));
  const platform = process.platform;
  const executable = platform === 'win32' ? 'pass-cli.exe' : 'pass-cli';
  const explicit = path.join(root, 'explicit', executable);
  const installedDir = path.join(root, 'installed');
  const installed = path.join(installedDir, executable);
  const pathDir = path.join(root, 'path');
  const pathCli = path.join(pathDir, executable);
  for (const filename of [explicit, installed, pathCli]) {
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, 'cli');
    await chmod(filename, 0o755);
  }
  const env = { PASS_CLI_PATH: explicit, PATH: pathDir };
  assert.equal(resolveCliPath({ platform, env, installDir: installedDir }), explicit);
  await removeFixture(explicit);
  assert.throws(
    () => resolveCliPath({ platform, env, installDir: installedDir }),
    error => error instanceof SetupError && /PASS_CLI_PATH/.test(error.message),
  );
  for (const invalid of ['', '   ']) {
    env.PASS_CLI_PATH = invalid;
    assert.throws(
      () => resolveCliPath({ platform, env, installDir: installedDir }),
      error => error instanceof SetupError && /PASS_CLI_PATH/.test(error.message),
    );
  }
  delete env.PASS_CLI_PATH;
  assert.equal(resolveCliPath({ platform, env, installDir: installedDir }), installed);
  await removeFixture(installed);
  assert.equal(resolveCliPath({ platform, env, installDir: installedDir }), pathCli);
});

test('無効なPASS_CLI_PATHでは代替CLIの検索もダウンロードも行わない', async t => {
  const root = await temporary();
  t.after(() => removeFixture(root, { recursive: true, force: true }));
  const installDir = path.join(root, 'installed');
  const fallback = path.join(installDir, 'pass-cli');
  await mkdir(installDir);
  await writeFile(fallback, 'fallback');
  await chmod(fallback, 0o755);
  let fetched = false;
  await assert.rejects(runSetup([], {
    platform: 'linux', arch: 'x64', installDir,
    env: { PASS_CLI_PATH: path.join(root, 'missing', 'pass-cli'), PATH: '' },
    fetch: async () => { fetched = true; },
  }), /PASS_CLI_PATH/);
  assert.equal(fetched, false);
});

test('forceなしで既存CLIを再利用しダウンロードしない', async t => {
  const root = await temporary();
  t.after(() => removeFixture(root, { recursive: true, force: true }));
  const executable = path.join(root, 'pass-cli');
  await writeFile(executable, 'existing');
  await chmod(executable, 0o755);
  let fetched = false;
  const result = await runSetup([], {
    platform: 'linux', arch: 'x64', installDir: root,
    env: { PASS_CLI_PATH: executable, PATH: '' }, fetch: async () => { fetched = true; },
  });
  assert.equal(result.installed, false);
  assert.equal(result.executable, executable);
  assert.equal(fetched, false);
  assert.match(result.message, /既存/);
});

test('Unix資産を検証して指定先へ755で導入し一時物を清掃する', async t => {
  const root = await temporary();
  t.after(() => removeFixture(root, { recursive: true, force: true }));
  const installDir = path.join(root, 'install');
  const scratch = path.join(root, 'scratch');
  await mkdir(scratch);
  const asset = Buffer.from('#!/bin/sh\necho pass\n');
  const calls = [];
  const result = await runSetup(['--install-dir', installDir], {
    platform: 'linux', arch: 'x64', env: { PATH: '' }, tmpdir: scratch,
    fetch: responses(release(asset), asset, calls),
  });
  assert.equal(result.installed, true);
  assert.equal(result.version, '2.3.3');
  assert.equal(result.executable, path.join(installDir, 'pass-cli'));
  assert.deepEqual(await readFile(result.executable), asset);
  if (process.platform !== 'win32') assert.equal((statSync(result.executable).mode & 0o777), 0o755);
  assert.deepEqual(await readdir(scratch), []);
  assert.equal(calls.length, 2);
  assert.match(result.message, /ログインとPATHの変更は行っていません/);
});

test('Windows ZIP内の通常ファイルをすべて指定先へ配置する', async t => {
  const root = await temporary();
  t.after(() => removeFixture(root, { recursive: true, force: true }));
  const installDir = path.join(root, 'install');
  const scratch = path.join(root, 'scratch');
  await mkdir(scratch);
  const archive = Buffer.from('fake zip bytes');
  const result = await runSetup(['--force'], {
    platform: 'win32', arch: 'x64', installDir, env: { PATH: '' }, tmpdir: scratch,
    fetch: responses(release(archive), archive),
    expandArchive: async (_source, destination) => {
      await writeFile(path.join(destination, 'pass-cli.exe'), 'exe');
      await mkdir(path.join(destination, 'licenses'));
      await writeFile(path.join(destination, 'licenses', 'LICENSE'), 'license');
    },
  });
  assert.equal(result.executable, path.join(installDir, 'pass-cli.exe'));
  assert.equal(await readFile(result.executable, 'utf8'), 'exe');
  assert.equal(await readFile(path.join(installDir, 'licenses', 'LICENSE'), 'utf8'), 'license');
  assert.deepEqual(await readdir(scratch), []);
});

test('Windows ZIPの展開失敗を専用エラーへ分類して一時物を清掃する', async t => {
  const root = await temporary();
  t.after(() => removeFixture(root, { recursive: true, force: true }));
  const scratch = path.join(root, 'scratch');
  await mkdir(scratch);
  const archive = Buffer.from('fake zip bytes');
  await assert.rejects(runSetup(['--force'], {
    platform: 'win32', arch: 'x64', installDir: path.join(root, 'install'),
    env: { PATH: '' }, tmpdir: scratch,
    fetch: responses(release(archive), archive),
    expandArchive: async () => { throw new Error('simulated Expand-Archive failure'); },
  }), error => error instanceof SetupError
    && /Windows ZIPの展開/.test(error.message)
    && !/権限と空き容量/.test(error.message));
  assert.deepEqual(await readdir(scratch), []);
});

test('Windowsの複数ファイル更新に失敗した場合は既存版を復元する', async t => {
  const root = await temporary();
  t.after(() => removeFixture(root, { recursive: true, force: true }));
  const installDir = path.join(root, 'install');
  const scratch = path.join(root, 'scratch');
  await mkdir(installDir);
  await mkdir(scratch);
  await writeFile(path.join(installDir, 'libcrypto-3-x64.dll'), 'old dll');
  await writeFile(path.join(installDir, 'pass-cli.exe'), 'old exe');
  const archive = Buffer.from('fake zip bytes');
  await assert.rejects(runSetup(['--force'], {
    platform: 'win32', arch: 'x64', installDir, env: { PATH: '' }, tmpdir: scratch,
    fetch: responses(release(archive), archive),
    expandArchive: async (_source, destination) => {
      await writeFile(path.join(destination, 'libcrypto-3-x64.dll'), 'new dll');
      await writeFile(path.join(destination, 'pass-cli.exe'), 'new exe');
    },
    replaceFile: async (source, destination) => {
      if (source.includes(`${path.sep}extracted${path.sep}`) && destination.endsWith('pass-cli.exe')) {
        throw new Error('simulated locked executable');
      }
      await copyFile(source, destination);
    },
  }), /既存ファイルを復元/);
  assert.equal(await readFile(path.join(installDir, 'libcrypto-3-x64.dll'), 'utf8'), 'old dll');
  assert.equal(await readFile(path.join(installDir, 'pass-cli.exe'), 'utf8'), 'old exe');
  assert.deepEqual(await readdir(scratch), []);
});

test('Windowsの復元にも失敗した場合は旧版バックアップを保持する', async t => {
  const root = await temporary();
  t.after(() => removeFixture(root, { recursive: true, force: true }));
  const installDir = path.join(root, 'install');
  const scratch = path.join(root, 'scratch');
  await mkdir(installDir);
  await mkdir(scratch);
  await writeFile(path.join(installDir, 'libcrypto-3-x64.dll'), 'old dll');
  await writeFile(path.join(installDir, 'pass-cli.exe'), 'old exe');
  const archive = Buffer.from('fake zip bytes');
  let failure;
  try {
    await runSetup(['--force'], {
      platform: 'win32', arch: 'x64', installDir, env: { PATH: '' }, tmpdir: scratch,
      fetch: responses(release(archive), archive),
      expandArchive: async (_source, destination) => {
        await writeFile(path.join(destination, 'libcrypto-3-x64.dll'), 'new dll');
        await writeFile(path.join(destination, 'pass-cli.exe'), 'new exe');
      },
      replaceFile: async (source, destination) => {
        if (source.includes(`${path.sep}extracted${path.sep}`) && destination.endsWith('pass-cli.exe')) {
          throw new Error('simulated locked executable');
        }
        if (source.includes(`${path.sep}backup${path.sep}`) && destination.endsWith('libcrypto-3-x64.dll')) {
          throw new Error('simulated rollback failure');
        }
        await copyFile(source, destination);
      },
    });
  } catch (error) { failure = error; }
  assert.ok(failure instanceof SetupError);
  assert.match(failure.message, /旧版バックアップを保持/);
  assert.equal(await readFile(path.join(failure.recoveryDir, 'libcrypto-3-x64.dll'), 'utf8'), 'old dll');
  assert.equal(await readFile(path.join(failure.recoveryDir, 'pass-cli.exe'), 'utf8'), 'old exe');
});

test('SHA改ざんでは既存の導入先を変更せず一時物を清掃する', async t => {
  const root = await temporary();
  t.after(() => removeFixture(root, { recursive: true, force: true }));
  const installDir = path.join(root, 'install');
  const scratch = path.join(root, 'scratch');
  const executable = path.join(installDir, 'pass-cli');
  await mkdir(installDir);
  await mkdir(scratch);
  await writeFile(executable, 'KEEP');
  await assert.rejects(runSetup(['--force'], {
    platform: 'linux', arch: 'x64', installDir, env: { PATH: '' }, tmpdir: scratch,
    fetch: responses(release(Buffer.from('expected')), Buffer.from('tampered')),
  }), /SHA-256/);
  assert.equal(await readFile(executable, 'utf8'), 'KEEP');
  assert.deepEqual(await readdir(scratch), []);
});

test('危険URLと不正SHAをマニフェスト段階で拒否する', () => {
  const asset = Buffer.from('asset');
  for (const url of [
    'http://proton.me/download/pass-cli/pass-cli',
    'https://evil.example/download/pass-cli/pass-cli',
    'https://proton.me/other/pass-cli',
    'https://user@proton.me/download/pass-cli/pass-cli',
  ]) {
    const manifest = release(asset);
    manifest.passCliVersions.urls.linux.x86_64.url = url;
    assert.throws(() => selectManifestAsset(manifest, 'linux', 'x64'), SetupError);
  }
  const manifest = release(asset);
  manifest.passCliVersions.urls.linux.x86_64.hash = 'not-a-sha';
  assert.throws(() => selectManifestAsset(manifest, 'linux', 'x64'), /SHA-256/);
});

test('Content-Lengthと実受信量のサイズ上限を超えた取得を拒否して清掃する', async t => {
  const root = await temporary();
  t.after(() => removeFixture(root, { recursive: true, force: true }));
  for (const contentLength of [true, false]) {
    const scratch = path.join(root, contentLength ? 'header' : 'stream');
    await mkdir(scratch);
    const asset = Buffer.from('123456789');
    const manifest = release(asset);
    const fetch = async url => url.toString() === MANIFEST_URL
      ? new Response(JSON.stringify(manifest))
      : new Response(asset, contentLength ? { headers: { 'content-length': '9' } } : undefined);
    await assert.rejects(runSetup(['--force'], {
      platform: 'linux', arch: 'x64', installDir: path.join(root, 'install'),
      env: { PATH: '' }, tmpdir: scratch, fetch, downloadMaxBytes: 8,
    }), /サイズが上限/);
    assert.deepEqual(await readdir(scratch), []);
  }
});

test('manifest取得と資産取得の両方へタイムアウトを設定する', async t => {
  const root = await temporary();
  t.after(() => removeFixture(root, { recursive: true, force: true }));
  const scratch = path.join(root, 'scratch');
  await mkdir(scratch);
  const asset = Buffer.from('asset');
  const signals = [];
  const fetch = async (url, init) => {
    signals.push(init.signal);
    return url.toString() === MANIFEST_URL
      ? new Response(JSON.stringify(release(asset))) : new Response(asset);
  };
  await runSetup(['--force'], {
    platform: 'linux', arch: 'x64', installDir: path.join(root, 'install'),
    env: { PATH: '' }, tmpdir: scratch, fetch, fetchTimeoutMs: 1234,
  });
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal instanceof AbortSignal));
  assert.deepEqual(await readdir(scratch), []);
});
