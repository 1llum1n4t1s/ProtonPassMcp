import { randomBytes, createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { lstat, readdir, rmdir } from 'node:fs/promises';
import { PassError } from './pass.mjs';
import { APP_ID, FILE_PATTERN, removeFile } from './handoff-protocol.mjs';
import { marker, minimalEnvironment, protectDirectory, sweepOldSessions, sweepSession, writePrivate } from './handoff-security.mjs';

const failure = () => new PassError('フィールドの受け渡しを準備または回収できませんでした。保存先とアクセス権を確認し、再起動してください。');
const cancelled = signal => { if (signal?.aborted) throw failure(); };
export class FileHandoffStore {
  constructor({ directory, ttlSeconds = 60 } = {}) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 300 || (directory !== undefined && (typeof directory !== 'string' || !path.isAbsolute(directory) || path.normalize(directory) !== directory || directory.startsWith('\\\\') || directory.startsWith('//') || directory === path.parse(directory).root))) throw failure();
    this.directory = directory ?? path.join(tmpdir(), `proton-pass-mcp-handoff-${createHash('sha256').update(homedir()).digest('hex').slice(0, 24)}`);
    this.ttlSeconds = ttlSeconds;
    this.session = path.join(this.directory, `session-${randomBytes(16).toString('hex')}`);
    this.healthy = false;
    this.failed = false;
    this.closed = false;
    this.files = new Map();
    this.operations = new Set();
  }
  async ready(signal) {
    try {
      if (this.closed || this.failed) throw failure();
      this.preparation ??= this.prepare(signal).catch(async () => {
        this.failed = true; this.healthy = false;
        try { await this.disposeSession(); } catch { this.cleanupFailed = true; }
        throw failure();
      });
      await this.preparation;
      cancelled(signal);
      if (!this.healthy || this.failed || this.closed) throw failure();
      await protectDirectory(this.directory, signal);
      await marker(this.directory, { app: APP_ID }, false);
      await protectDirectory(this.session, signal);
      await marker(this.session, { app: APP_ID, pid: process.pid }, false);
      cancelled(signal);
      if (!this.healthy || this.failed || this.closed) throw failure();
    } catch {
      this.invalidate();
      throw failure();
    }
  }
  async recover() {
    try {
      try { await lstat(this.directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      await protectDirectory(this.directory);
      await marker(this.directory, { app: APP_ID }, false);
      await sweepOldSessions(this.directory);
    } catch { this.failed = true; this.healthy = false; throw failure(); }
  }
  invalidate() {
    this.failed = true; this.healthy = false;
    this.cleanupAttempt ??= this.waitOperations().then(async () => {
      try { await lstat(this.session); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      await sweepSession(this.session, true);
    }).catch(() => { this.cleanupFailed = true; });
  }
  async prepare(signal) {
    cancelled(signal);
    await protectDirectory(this.directory, signal);
    await marker(this.directory, { app: APP_ID });
    await sweepOldSessions(this.directory);
    await protectDirectory(this.session, signal);
    await marker(this.session, { app: APP_ID, pid: process.pid });
    cancelled(signal);
    const child = spawn(process.execPath, [fileURLToPath(new URL('./handoff-janitor.mjs', import.meta.url)), this.session], { shell: false, windowsHide: true, detached: true, env: minimalEnvironment(), stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => this.invalidate());
    child.stdout.on('end', () => { if (!this.closed) this.invalidate(); });
    this.childExit = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
    child.on('exit', () => {
      this.healthy = false;
      if (!this.closed) this.invalidate();
    });
    await new Promise((resolve, reject) => {
      let output = '';
      let settled = false;
      let receivedReady = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        child.off('error', bad); child.off('exit', bad);
        if (error) { child.stdin.end(); reject(failure()); } else resolve();
      };
      const bad = () => finish(true);
      const abort = () => finish(true);
      const data = chunk => {
        output += chunk.toString();
        if (output.length > 128) { this.invalidate(); finish(true); return; }
        while (output.includes('\n')) {
          const index = output.indexOf('\n');
          const line = output.slice(0, index); output = output.slice(index + 1);
          if (line === 'HANDOFF_READY_V1' && !receivedReady) { receivedReady = true; finish(false); }
          else { this.invalidate(); finish(true); }
        }
      };
      const timer = setTimeout(bad, 20000);
      child.stdout.on('data', data); child.once('error', bad); child.once('exit', bad);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    cancelled(signal);
    child.on('error', () => this.invalidate());
    if (child.exitCode !== null || child.signalCode !== null || this.closed || this.failed) throw failure();
    this.healthy = true;
  }
  async create(input, signal) {
    const operation = this.createInternal(input, signal);
    this.operations.add(operation);
    try { return await operation; } finally { this.operations.delete(operation); }
  }
  async createInternal({ value, field, expiresAt }, signal) {
    let file;
    let identity;
    try {
      await this.ready(signal);
      if (typeof value !== 'string' || typeof field !== 'string' || !field || (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()))) throw failure();
      const id = randomBytes(16).toString('hex');
      // 親ディレクトリの置換・権限変更を秘密の書込み前に再検査する。
      await protectDirectory(this.directory, signal);
      await protectDirectory(this.session, signal);
      cancelled(signal);
      const deadline = Math.min(Date.now() + this.ttlSeconds * 1000, expiresAt ?? Infinity);
      if (!this.healthy || this.closed || Date.now() >= deadline) throw failure();
      file = path.join(this.session, `field-${deadline}-${id}.secret`);
      identity = await writePrivate(file, value);
      this.files.set(id, { file, identity });
      cancelled(signal);
      if (!this.healthy || this.closed || Date.now() >= deadline) throw failure();
      return { handoff_id: id, file_path: file, expires_at: new Date(deadline).toISOString(), consumer_module_url: new URL('./handoff-consumer.mjs', import.meta.url).href, field };
    } catch {
      if (file) { try { await removeFile(file, identity); } catch { throw failure(); } }
      throw failure();
    }
  }
  async release(id) {
    try {
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw failure();
      const entry = this.files.get(id);
      if (entry) {
        await removeFile(entry.file, entry.identity);
        await removeFile(`${entry.file}.claimed`, entry.identity);
        await removeFile(`${entry.file}.lock`);
        this.files.delete(id);
      }
      return { released: Boolean(entry) };
    } catch { throw failure(); }
  }
  async waitOperations() { await Promise.allSettled([...this.operations]); }
  async close() {
    if (this.closing) return this.closing;
    this.closed = true; this.healthy = false;
    this.closing = this.closeInternal();
    return this.closing;
  }
  async closeInternal() {
    try {
      await this.preparation?.catch(() => {});
      await this.waitOperations();
      await this.cleanupAttempt;
      await this.disposeSession();
    } catch { throw failure(); }
  }
  async disposeSession() {
    this.child?.stdin.end();
    if (this.child) {
      let timer;
      try { await Promise.race([this.childExit, new Promise((_, reject) => { timer = setTimeout(() => reject(failure()), 10000); })]); }
      finally { clearTimeout(timer); }
    }
    try { await lstat(this.session); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await sweepSession(this.session, true);
    for (const name of await readdir(this.session)) if (FILE_PATTERN.test(name)) throw failure();
    await removeFile(path.join(this.session, '.handoff-owner.json'));
    await rmdir(this.session);
    this.files.clear();
  }
}
