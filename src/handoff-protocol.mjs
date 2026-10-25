import { lstat, unlink } from 'node:fs/promises';
import path from 'node:path';

export const APP_ID = 'proton-pass-mcp-handoff-v1';
export const FILE_PATTERN = /^field-(\d{13})-([a-f0-9]{32})\.secret(?:\.claimed|\.lock)?$/;
export const SESSION_PATTERN = /^session-[a-f0-9]{32}$/;
export function regular(stat) { return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1; }
export function same(a, b) { return a.dev === b.dev && a.ino === b.ino && regular(b); }
export async function removeFile(file, identity) {
  try {
    const current = await lstat(file);
    if (!regular(current) || (identity && !same(identity, current))) throw new Error('identity');
    await unlink(file);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export function receiptPath(receipt) {
  if (!receipt || !/^[a-f0-9]{32}$/.test(receipt.handoff_id) || typeof receipt.field !== 'string' || !receipt.field || typeof receipt.file_path !== 'string' || !path.isAbsolute(receipt.file_path) || path.normalize(receipt.file_path) !== receipt.file_path || receipt.file_path.startsWith('\\\\') || receipt.file_path.startsWith('//')) throw new Error('receipt');
  const match = FILE_PATTERN.exec(path.basename(receipt.file_path));
  const deadline = Date.parse(receipt.expires_at);
  if (!match || !receipt.file_path.endsWith('.secret') || match[2] !== receipt.handoff_id || !SESSION_PATTERN.test(path.basename(path.dirname(receipt.file_path))) || !Number.isFinite(deadline) || deadline !== Number(match[1]) || new Date(deadline).toISOString() !== receipt.expires_at) throw new Error('receipt');
  return { file: receipt.file_path, deadline };
}
