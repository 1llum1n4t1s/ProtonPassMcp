import { lstat, open, rename } from 'node:fs/promises';
import { dirname, parse } from 'node:path';
import { APP_ID, receiptPath, regular, same, removeFile } from './handoff-protocol.mjs';

const failure = () => new Error('フィールドの受け渡しに失敗しました。新しい受け渡しを作成してください。');
export async function withFieldHandoff(receipt, consumer) {
  let claimed;
  let identity;
  let handle;
  let original;
  let lock;
  let lockHandle;
  let lockIdentity;
  try {
    const { file, deadline } = receiptPath(receipt);
    if (typeof consumer !== 'function') throw failure();
    // パスの親をリンク経由で辿らないことを確認する。
    let directory = dirname(file);
    while (directory !== parse(directory).root) {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure();
      directory = dirname(directory);
    }
    identity = await lstat(file);
    if (!regular(identity)) throw failure();
    for (const markerDirectory of [dirname(file), dirname(dirname(file))]) {
      const markerFile = `${markerDirectory}/.handoff-owner.json`;
      const markerStat = await lstat(markerFile);
      if (!regular(markerStat)) throw failure();
      const markerHandle = await open(markerFile, 'r');
      try {
        if (!same(markerStat, await markerHandle.stat())) throw failure();
        const data = JSON.parse(await markerHandle.readFile({ encoding: 'utf8' }));
        if (data.app !== APP_ID) throw failure();
      } finally { await markerHandle.close(); }
    }
    // Windowsのrenameは並行呼出しで両方成功し得るため、先に排他作成する。
    const lockPath = `${file}.lock`;
    lockHandle = await open(lockPath, 'wx', 0o600);
    lock = lockPath;
    lockIdentity = await lockHandle.stat();
    if (!regular(lockIdentity)) throw failure();
    await lockHandle.close(); lockHandle = undefined;
    original = file;
    if (Date.now() >= deadline) throw failure();
    const destination = `${file}.claimed`;
    try { await lstat(destination); throw failure(); } catch (error) { if (error.code !== 'ENOENT') throw failure(); }
    await rename(file, destination);
    claimed = destination;
    original = undefined;
    const current = await lstat(claimed);
    if (!same(identity, current) || Date.now() >= deadline) throw failure();
    handle = await open(claimed, 'r');
    if (!same(identity, await handle.stat())) throw failure();
    const value = await handle.readFile({ encoding: 'utf8' });
    await handle.close(); handle = undefined;
    if (Date.now() >= deadline) throw failure();
    await consumer(value);
  } catch { throw failure(); }
  finally {
    let cleanupFailed = false;
    for (const cleanup of [
      () => handle?.close(),
      () => lockHandle?.close(),
      () => claimed && identity ? removeFile(claimed, identity) : undefined,
      () => original && identity ? removeFile(original, identity) : undefined,
      () => lock ? removeFile(lock, lockIdentity) : undefined,
    ]) {
      try { await cleanup(); } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) throw failure();
  }
  return { consumed: true };
}
