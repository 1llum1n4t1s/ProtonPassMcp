import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
export class PassError extends Error {}

export function checkCancellation(signal) {
  if (signal?.aborted) throw new PassError('The call was cancelled.');
}

// 生のCLIエラーには秘密が含まれ得るため、分類したメッセージだけ返す。
export async function runCli(executable, args, env, signal) {
  try {
    const { stdout } = await execute(executable, args, {
      env, signal, windowsHide: true, shell: false,
      // infoも初期化とAPI通信を行うため、他のCLI操作と同じ実行予算を確保する。
      timeout: 20000, maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    });
    return stdout;
  } catch (error) {
    if (error.name === 'AbortError') throw new PassError('The call was cancelled.');
    if (error.code === 'ENOENT') throw new PassError('The pass-cli executable was not found. Run proton-pass-mcp setup or check PASS_CLI_PATH.');
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new PassError('pass-cli output exceeded the limit (8 MiB).');
    if (error.killed) throw new PassError('pass-cli timed out. Please retry.');
    const stderr = error.stderr ?? '';
    // CLIの具体的な診断だけを分類する。パスやURL中のsession等では判定しない。
    if (/Your session has been invalidated and you have been logged out automatically\./i.test(stderr)) {
      throw new PassError('The Proton Pass session was invalidated and the CLI logged out automatically. Re-authenticate with the same PROTON_PASS_SESSION_DIR.');
    }
    if (/Command is not logout there is no session/i.test(stderr)) {
      throw new PassError('No valid Proton Pass session exists in the specified directory. Check the authentication state with the same PROTON_PASS_SESSION_DIR. The CLI cannot report why a session expired.');
    }
    if (/This operation requires an authenticated client/i.test(stderr)) {
      throw new PassError('Proton Pass authentication is required. Re-authenticate with the same PROTON_PASS_SESSION_DIR.');
    }
    throw new PassError('pass-cli failed. Check the target IDs, field name, connection, and access rights.');
  }
}

function decode(text) {
  try { return JSON.parse(text); }
  catch { throw new PassError('pass-cli did not return valid JSON.'); }
}

function array(value) {
  if (!Array.isArray(value)) throw new PassError('The pass-cli JSON structure is unexpected.');
  return value;
}

function metadata(item) {
  if (!item || !['id', 'share_id', 'title', 'state', 'item_type'].every(key => typeof item[key] === 'string')) {
    throw new PassError('The pass-cli JSON structure is unexpected.');
  }
  return { id: item.id, share_id: item.share_id, title: item.title,
    state: item.state, item_type: item.item_type };
}

function strings(value, keys) {
  if (!value || !keys.every(key => typeof value[key] === 'string')) {
    throw new PassError('The pass-cli JSON structure is unexpected.');
  }
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

function shareRole(value) {
  if (['Owner', 'Manager', 'Editor', 'Viewer'].includes(value)) return value;
  // CLIのCustom権限はオブジェクト。許可した2項目だけ再構築する。
  const custom = value?.Custom;
  if (custom && typeof custom.name === 'string' && Number.isInteger(custom.permission)
    && custom.permission >= 0 && custom.permission <= 65535) {
    return { Custom: { name: custom.name, permission: custom.permission } };
  }
  throw new PassError('The pass-cli JSON structure is unexpected.');
}

export class PassClient {
  constructor({ executable, sessionDir, runner = runCli, env = process.env, policy }) {
    if (!executable) throw new PassError('pass-cli was not found. Run proton-pass-mcp setup or set PASS_CLI_PATH.');
    if (!sessionDir) throw new PassError('Set PROTON_PASS_SESSION_DIR.');
    this.executable = executable;
    this.env = { ...env };
    // Windowsの環境変数名は大小文字を区別しない。指定セッションも一意にする。
    for (const key of Object.keys(this.env)) {
      if (['PROTON_PASS_PERSONAL_ACCESS_TOKEN', 'PROTON_PASS_AGENT_REASON', 'PROTON_PASS_SESSION_DIR', 'PROTON_PASS_ACCESS_POLICY'].includes(key.toUpperCase())) {
        delete this.env[key];
      }
    }
    this.env.PROTON_PASS_SESSION_DIR = sessionDir;
    this.runner = runner;
    this.policy = policy;
    this.queue = Promise.resolve();
  }

  exclusive(work) {
    const pending = this.queue.then(work);
    this.queue = pending.catch(() => {});
    return pending;
  }

  async info(signal) {
    checkCancellation(signal);
    await this.runner(this.executable, ['info'], this.env, signal);
    checkCancellation(signal);
    return { authenticated: true };
  }

  async command(args, { reason, signal, json = true } = {}) {
    checkCancellation(signal);
    this.policy?.assertActive();
    await this.info(signal);
    checkCancellation(signal);
    this.policy?.assertActive();
    const env = { ...this.env };
    if (reason) env.PROTON_PASS_AGENT_REASON = reason;
    const raw = await this.runner(this.executable, args, env, signal);
    const result = json ? decode(raw) : raw;
    checkCancellation(signal);
    this.policy?.assertActive();
    return result;
  }

  async vaults(signal) {
    const data = await this.command(['vault', 'list', '--output', 'json'], { signal });
    return { vaults: array(data?.vaults).map(v => strings(v, ['name', 'share_id']))
      .filter(v => !this.policy || this.policy.allowsShare(v.share_id)) };
  }

  async shares(signal) {
    // 共有アイテムも列挙するが、未知フィールドや本文は返さない。
    const data = await this.command(['share', 'list', '--output', 'json'], { signal });
    return { shares: array(data?.shares).map(s => {
      const value = strings(s, ['id', 'name', 'share_type']);
      if (!['Vault', 'Item'].includes(value.share_type)) throw new PassError('The pass-cli JSON structure is unexpected.');
      return { share_id: value.id, name: value.name, share_type: value.share_type, share_role: shareRole(s.share_role) };
    }).filter(s => !this.policy || this.policy.allowsShare(s.share_id)) };
  }

  async items({ share_id, type, state = 'active' }, signal) {
    checkCancellation(signal);
    this.policy?.assertShare(share_id);
    const args = ['item', 'list', `--share-id=${share_id}`, '--output', 'json'];
    if (type) args.push('--filter-type', type);
    if (state !== 'all') args.push('--filter-state', state);
    const data = await this.command(args, { signal });
    return array(data?.items).map(metadata)
      .filter(item => !this.policy || (item.share_id === share_id && this.policy.allowsItem(share_id, item.id)))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  async listItems(input, signal) {
    const items = await this.items(input, signal);
    const { offset = 0, limit = 100, query = '' } = input;
    const normalizedQuery = query.toLowerCase();
    const filtered = items.filter(i => i.title.toLowerCase().includes(normalizedQuery));
    return { items: filtered.slice(offset, offset + limit), total: filtered.length,
      next_offset: offset + limit < filtered.length ? offset + limit : null };
  }

  async searchNotes(input, signal) {
    if (this.policy) throw new PassError('Note body search is unavailable while an access policy is active. Use title search instead.');
    const started = Date.now();
    const { query, reason, cursor, page_size = 3 } = input;
    const items = await this.items({ ...input, type: 'note' }, signal);
    const fingerprint = createHash('sha256').update(JSON.stringify([
      input.share_id, input.state ?? 'active', query, items.map(i => [i.id, i.state]),
    ])).digest('hex');
    let offset = 0;
    if (cursor) {
      let saved;
      try { saved = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
      catch { throw new PassError('The search cursor is invalid.'); }
      if (saved?.fingerprint !== fingerprint || !Number.isInteger(saved.offset) || saved.offset < 0 || saved.offset > items.length) {
        throw new PassError('The search criteria or the target list changed. Search again without the cursor.');
      }
      offset = saved.offset;
    }
    const matches = [];
    const page = items.slice(offset, offset + page_size);
    let checked = 0;
    for (const item of page) {
      const data = await this.command(['item', 'view', `--share-id=${item.share_id}`,
        `--item-id=${item.id}`, '--output', 'json'], { reason, signal });
      const content = data.item?.content;
      if (typeof content?.note !== 'string' || typeof content.title !== 'string') {
        throw new PassError('The note JSON structure is unexpected.');
      }
      if (content.title.includes(query) || content.note.includes(query)) matches.push(item);
      checked++;
      if (Date.now() - started >= 15000) break;
    }
    const next = offset + checked;
    return { matches, checked, checked_total: next, total: items.length,
      complete: next >= items.length,
      next_cursor: next < items.length ? Buffer.from(JSON.stringify({ fingerprint, offset: next })).toString('base64url') : null };
  }

  async field({ share_id, item_id, field, reason }, signal) {
    checkCancellation(signal);
    this.policy?.consumeRead(share_id, item_id, field);
    const value = await this.command(['item', 'view', `--share-id=${share_id}`,
      `--item-id=${item_id}`, `--field=${field}`], { reason, signal, json: false });
    const result = { field, value: value.replace(/\r?\n$/, '') };
    checkCancellation(signal);
    this.policy?.assertActive();
    return result;
  }
}
