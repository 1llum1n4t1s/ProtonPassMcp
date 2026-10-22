import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  accessSync, constants, createWriteStream, lstatSync, mkdirSync,
  mkdtempSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { copyFile, mkdir, open, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export const MANIFEST_URL = 'https://proton.me/download/pass-cli/versions.json';
export const DEFAULT_MANIFEST_MAX_BYTES = 1024 * 1024;
export const DEFAULT_DOWNLOAD_MAX_BYTES = 256 * 1024 * 1024;
export const DEFAULT_FETCH_TIMEOUT_MS = 60000;
const TRUSTED_PATH_PREFIX = '/download/pass-cli/';
const MAX_REDIRECTS = 5;

export class SetupError extends Error {
  constructor(message, { recoveryDir } = {}) {
    super(message);
    this.recoveryDir = recoveryDir;
  }
}

function isRegularFile(filename, platform) {
  try {
    if (!statSync(filename).isFile()) return false;
    accessSync(filename, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableName(platform) {
  return platform === 'win32' ? 'pass-cli.exe' : 'pass-cli';
}

function envValue(env, name, platform) {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).find(candidate => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

export function defaultInstallDir({
  platform = process.platform,
  env = process.env,
  homedir = os.homedir(),
} = {}) {
  if (platform === 'win32') {
    const localAppData = envValue(env, 'LOCALAPPDATA', platform);
    if (!localAppData) throw new SetupError('LOCALAPPDATA が設定されていないため、既定の導入先を決定できません。');
    return path.join(localAppData, 'Programs', 'ProtonPass');
  }
  return path.join(homedir, '.local', 'bin');
}

/** PASS_CLI_PATHを固定指定として扱い、省略時は導入先、PATHの順でCLIを同期的に解決する。 */
export function resolveCliPath({
  platform = process.platform,
  env = process.env,
  homedir = os.homedir(),
  installDir,
} = {}) {
  const configured = envValue(env, 'PASS_CLI_PATH', platform);
  if (configured !== undefined) {
    const explicit = typeof configured === 'string' ? configured.trim() : '';
    const candidate = path.resolve(explicit);
    if (explicit && isRegularFile(candidate, platform)) return candidate;
    throw new SetupError('PASS_CLI_PATH が有効なProton Pass CLIの実行ファイルを指していません。値を修正するか、自動検出を使う場合はこの変数を削除してください。');
  }

  let destinationDir;
  try {
    destinationDir = path.resolve(installDir ?? defaultInstallDir({ platform, env, homedir }));
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
  }
  if (destinationDir) {
    const installed = path.join(destinationDir, executableName(platform));
    if (isRegularFile(installed, platform)) return installed;
  }

  const separator = platform === 'win32' ? ';' : ':';
  const names = platform === 'win32' ? ['pass-cli.exe'] : ['pass-cli'];
  const searchPath = envValue(env, 'PATH', platform) ?? '';
  for (let entry of searchPath.split(separator)) {
    if (!entry) continue;
    if (entry.startsWith('"') && entry.endsWith('"')) entry = entry.slice(1, -1);
    for (const name of names) {
      const candidate = path.resolve(entry, name);
      if (isRegularFile(candidate, platform)) return candidate;
    }
  }
  return null;
}

export function platformAssetKey(platform = process.platform, arch = process.arch) {
  const platformKey = { win32: 'windows', darwin: 'macos', linux: 'linux' }[platform];
  const archKey = { x64: 'x86_64', arm64: 'aarch64' }[arch];
  if (!platformKey || !archKey || (platform === 'win32' && arch !== 'x64')) {
    throw new SetupError(`この環境（${platform}/${arch}）向けのProton Pass CLIはサポートしていません。`);
  }
  return { platformKey, archKey };
}

export function validateDownloadUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new SetupError('公式マニフェスト内のダウンロードURLが不正です。'); }
  if (url.protocol !== 'https:' || url.hostname !== 'proton.me'
    || !url.pathname.startsWith(TRUSTED_PATH_PREFIX)
    || url.username || url.password || url.port) {
    throw new SetupError('公式マニフェスト内のダウンロードURLが許可範囲外です。');
  }
  return url;
}

export function selectManifestAsset(manifest, platform = process.platform, arch = process.arch) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.formatVersion !== 1) {
    throw new SetupError('Proton Pass CLIのマニフェスト形式に対応していません。');
  }
  const release = manifest.passCliVersions;
  if (!release || typeof release !== 'object' || Array.isArray(release)
    || typeof release.version !== 'string'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version)) {
    throw new SetupError('Proton Pass CLIのマニフェストにバージョン情報がありません。');
  }
  const { platformKey, archKey } = platformAssetKey(platform, arch);
  const asset = release.urls?.[platformKey]?.[archKey];
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)
    || typeof asset.url !== 'string' || typeof asset.hash !== 'string') {
    throw new SetupError('この環境向けのProton Pass CLIがマニフェストにありません。');
  }
  const url = validateDownloadUrl(asset.url);
  if (!/^[0-9a-fA-F]{64}$/.test(asset.hash)) {
    throw new SetupError('公式マニフェスト内のSHA-256が不正です。');
  }
  return { version: release.version, url: url.href, hash: asset.hash.toLowerCase() };
}

function parseArgs(args) {
  let force = false;
  let installDir;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--force') {
      force = true;
    } else if (argument === '--install-dir') {
      installDir = args[++index];
      if (!installDir) throw new SetupError('--install-dir には導入先ディレクトリが必要です。');
    } else if (argument.startsWith('--install-dir=')) {
      installDir = argument.slice('--install-dir='.length);
      if (!installDir) throw new SetupError('--install-dir には導入先ディレクトリが必要です。');
    } else {
      throw new SetupError('不明なsetupオプションです。');
    }
  }
  return { force, installDir: installDir ? path.resolve(installDir) : undefined };
}

async function trustedFetch(fetchImpl, initialUrl, timeoutMs) {
  let current = validateDownloadUrl(initialUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    let response;
    try {
      response = await fetchImpl(current, {
        redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new SetupError('Proton Pass CLIの公式ダウンロードに失敗しました。');
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === MAX_REDIRECTS) throw new SetupError('公式ダウンロードのリダイレクト回数が上限を超えました。');
      const location = response.headers.get('location');
      if (!location) throw new SetupError('公式ダウンロードのリダイレクト先がありません。');
      await response.body?.cancel();
      current = validateDownloadUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) throw new SetupError('Proton Pass CLIの公式ダウンロードに失敗しました。');
    return response;
  }
  throw new SetupError('Proton Pass CLIの公式ダウンロードに失敗しました。');
}

function contentLengthWithin(response, maxBytes) {
  const header = response.headers.get('content-length');
  if (header === null) return;
  if (!/^\d+$/.test(header) || Number(header) > maxBytes) {
    throw new SetupError(`ダウンロードサイズが上限（${maxBytes} bytes）を超えています。`);
  }
}

async function responseBuffer(response, maxBytes) {
  contentLengthWithin(response, maxBytes);
  if (!response.body) throw new SetupError('公式ダウンロードの内容が空です。');
  const chunks = [];
  let size = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    size += chunk.length;
    if (size > maxBytes) throw new SetupError(`ダウンロードサイズが上限（${maxBytes} bytes）を超えています。`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function downloadFile(response, filename, maxBytes) {
  contentLengthWithin(response, maxBytes);
  if (!response.body) throw new SetupError('公式ダウンロードの内容が空です。');
  const hash = createHash('sha256');
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) {
        callback(new SetupError(`ダウンロードサイズが上限（${maxBytes} bytes）を超えています。`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(filename, { flags: 'wx' }));
  return hash.digest('hex');
}

async function defaultExpandArchive(archive, destination) {
  const windowsDir = envValue(process.env, 'SYSTEMROOT', 'win32')
    ?? envValue(process.env, 'WINDIR', 'win32');
  if (!windowsDir) throw new SetupError('Windows PowerShellの場所を特定できません。');
  const powershell = path.join(windowsDir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = 'Expand-Archive -LiteralPath $env:PROTON_PASS_MCP_ARCHIVE -DestinationPath $env:PROTON_PASS_MCP_DESTINATION -Force';
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const childEnv = {
    SYSTEMROOT: windowsDir,
    WINDIR: windowsDir,
    TEMP: envValue(process.env, 'TEMP', 'win32') ?? os.tmpdir(),
    TMP: envValue(process.env, 'TMP', 'win32') ?? os.tmpdir(),
    PROTON_PASS_MCP_ARCHIVE: archive,
    PROTON_PASS_MCP_DESTINATION: destination,
  };
  await execute(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    env: childEnv, windowsHide: true, shell: false, timeout: 120000, maxBuffer: 1024 * 1024,
  });
}

function regularFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const filename = path.join(current, entry.name);
    const info = lstatSync(filename);
    if (info.isSymbolicLink()) throw new SetupError('ZIP内にシンボリックリンクが含まれているため導入を中止しました。');
    if (info.isDirectory()) files.push(...regularFiles(root, filename));
    else if (info.isFile()) files.push({ source: filename, relative: path.relative(root, filename) });
    else throw new SetupError('ZIP内に通常ファイル以外が含まれているため導入を中止しました。');
  }
  return files;
}

async function replaceFile(source, destination, mode) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.proton-pass-mcp-${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary);
    if (mode !== undefined) {
      const handle = await open(temporary, 'r');
      try { await handle.chmod(mode); } finally { await handle.close(); }
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (process.platform !== 'win32' || !['EEXIST', 'EPERM'].includes(error.code)) throw error;
      await rm(destination, { force: true });
      await rename(temporary, destination);
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function installFilesTransaction(files, destinationDir, backupRoot, replace = replaceFile) {
  const changes = [];
  for (const file of files) {
    const destination = path.join(destinationDir, file.relative);
    const backup = path.join(backupRoot, file.relative);
    let existed = false;
    let previousMode;
    try {
      const info = lstatSync(destination);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new SetupError('導入先に通常ファイル以外の同名項目があるため中止しました。');
      }
      existed = true;
      previousMode = info.mode & 0o777;
      await mkdir(path.dirname(backup), { recursive: true });
      await copyFile(destination, backup);
    } catch (error) {
      if (error instanceof SetupError) throw error;
      if (error.code !== 'ENOENT') throw error;
    }
    changes.push({ ...file, destination, backup, existed, previousMode });
  }

  const attempted = [];
  try {
    for (const change of changes) {
      attempted.push(change);
      await replace(change.source, change.destination, change.mode);
    }
  } catch {
    const failures = [];
    for (const change of [...attempted].reverse()) {
      try {
        if (change.existed) await replace(change.backup, change.destination, change.previousMode);
        else await rm(change.destination, { force: true });
      } catch { failures.push(change.destination); }
    }
    if (failures.length > 0) {
      const recoveryDir = path.join(path.dirname(path.dirname(backupRoot)),
        `proton-pass-mcp-recovery-${randomUUID()}`);
      try {
        await rename(backupRoot, recoveryDir);
      } catch {
        throw new SetupError(`CLIの導入と既存ファイルの復元に失敗しました。旧版バックアップを保持しています: ${path.dirname(backupRoot)}`, {
          recoveryDir: path.dirname(backupRoot),
        });
      }
      throw new SetupError(`CLIの導入と既存ファイルの復元に失敗しました。旧版バックアップを保持しています: ${recoveryDir}`, {
        recoveryDir,
      });
    }
    throw new SetupError('CLIの導入に失敗したため、既存ファイルを復元しました。');
  }
}

/** 公式CLIを明示的にセットアップし、処理結果と解決済み実行パスを返す。 */
export async function runSetup(args = [], options = {}) {
  const parsed = parseArgs(args);
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();
  const installDir = parsed.installDir ?? options.installDir;
  platformAssetKey(platform, arch);

  if (!parsed.force) {
    const existing = resolveCliPath({ platform, env, homedir, installDir });
    if (existing) {
      return {
        installed: false, executable: existing, version: null,
        message: `既存のProton Pass CLIを使用します: ${existing}\nログインとPATHの変更は行っていません。`,
      };
    }
  }

  const destinationDir = path.resolve(installDir ?? defaultInstallDir({ platform, env, homedir }));
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new SetupError('ダウンロード機能を利用できません。');
  const temporaryRoot = mkdtempSync(path.join(options.tmpdir ?? os.tmpdir(), 'proton-pass-mcp-setup-'));
  let preserveTemporaryRoot = false;
  try {
    const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    if (!Number.isSafeInteger(fetchTimeoutMs) || fetchTimeoutMs < 1) {
      throw new SetupError('ダウンロードのタイムアウト設定が不正です。');
    }
    const manifestResponse = await trustedFetch(fetchImpl, MANIFEST_URL, fetchTimeoutMs);
    const manifestBytes = await responseBuffer(
      manifestResponse, options.manifestMaxBytes ?? DEFAULT_MANIFEST_MAX_BYTES,
    );
    let manifest;
    try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
    catch { throw new SetupError('Proton Pass CLIの公式マニフェストが有効なJSONではありません。'); }
    const asset = selectManifestAsset(manifest, platform, arch);
    const assetResponse = await trustedFetch(fetchImpl, asset.url, fetchTimeoutMs);
    const downloadPath = path.join(temporaryRoot, platform === 'win32' ? 'pass-cli.zip' : 'pass-cli');
    const actualHash = await downloadFile(
      assetResponse, downloadPath, options.downloadMaxBytes ?? DEFAULT_DOWNLOAD_MAX_BYTES,
    );
    if (actualHash !== asset.hash) {
      throw new SetupError('ダウンロードしたProton Pass CLIのSHA-256が公式値と一致しません。導入を中止しました。');
    }

    let executable;
    if (platform === 'win32') {
      const extracted = path.join(temporaryRoot, 'extracted');
      mkdirSync(extracted, { recursive: true });
      try {
        await (options.expandArchive ?? defaultExpandArchive)(downloadPath, extracted);
      } catch (error) {
        if (error instanceof SetupError) throw error;
        throw new SetupError('Windows ZIPの展開に失敗しました。Windows PowerShellと公式配布物を確認してください。');
      }
      const files = regularFiles(extracted);
      if (files.length === 0) throw new SetupError('公式ZIPに導入可能なファイルがありません。');
      if (!files.some(file => file.relative === executableName(platform))) {
        throw new SetupError('公式ZIPに pass-cli.exe がありません。');
      }
      await installFilesTransaction(files, destinationDir, path.join(temporaryRoot, 'backup'),
        options.replaceFile);
      executable = path.join(destinationDir, executableName(platform));
    } else {
      executable = path.join(destinationDir, executableName(platform));
      await installFilesTransaction([
        { source: downloadPath, relative: executableName(platform), mode: 0o755 },
      ], destinationDir, path.join(temporaryRoot, 'backup'), options.replaceFile);
    }

    return {
      installed: true, executable, version: asset.version,
      message: `Proton Pass CLI ${asset.version} を導入しました: ${executable}\nログインとPATHの変更は行っていません。必要に応じて pass-cli login を実行してください。`,
    };
  } catch (error) {
    if (error instanceof SetupError) {
      preserveTemporaryRoot = error.recoveryDir === temporaryRoot;
      throw error;
    }
    throw new SetupError('Proton Pass CLIのセットアップに失敗しました。導入先の権限と空き容量を確認してください。');
  } finally {
    if (!preserveTemporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
