import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
export class PassError extends Error {}

export function checkCancellation(signal) {
  if (signal?.aborted) throw new PassError('呼び出しをキャンセルしました。');
}

// 生のCLIエラーには秘密が含まれ得るため、分類したメッセージだけ返す。
export async function runCli(executable, args, env, signal) {
  try {
    const { stdout } = await execute(executable, args, {
      env, signal, windowsHide: true, shell: false,
      timeout: args[0] === 'info' ? 5000 : 20000, maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    });
    return stdout;
  } catch (error) {
    if (error.name === 'AbortError') throw new PassError('呼び出しをキャンセルしました。');
    if (error.code === 'ENOENT') throw new PassError('PASS_CLI_PATH の実行ファイルが見つかりません。');
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new PassError('pass-cli の出力が上限（8 MiB）を超えました。');
    if (error.killed) throw new PassError('pass-cli がタイムアウトしました。再試行してください。');
    const stderr = error.stderr ?? '';
    // CLIの具体的な診断だけを分類する。パスやURL中のsession等では判定しない。
    if (/Your session has been invalidated and you have been logged out automatically\./i.test(stderr)) {
      throw new PassError('Proton Passセッションが無効化され、CLIにより自動ログアウトされました。同じ PROTON_PASS_SESSION_DIR で再認証してください。');
    }
    if (/Command is not logout there is no session/i.test(stderr)) {
      throw new PassError('指定された保存先に有効なProton Passセッションがありません。同じ PROTON_PASS_SESSION_DIR で認証状態を確認してください。失効理由はCLIから取得できません。');
    }
    if (/This operation requires an authenticated client/i.test(stderr)) {
      throw new PassError('Proton Passの認証が必要です。同じ PROTON_PASS_SESSION_DIR で再認証してください。');
    }
    throw new PassError('pass-cli が失敗しました。対象ID・フィールド名・接続とアクセス権を確認してください。');
  }
}

function decode(text) {
  try { return JSON.parse(text); }
  catch { throw new PassError('pass-cli が有効なJSONを返しませんでした。'); }
}

function array(value) {
  if (!Array.isArray(value)) throw new PassError('pass-cliのJSON構造が想定と異なります。');
  return value;
}

function metadata(item) {
  if (!item || !['id', 'share_id', 'title', 'state', 'item_type'].every(key => typeof item[key] === 'string')) {
    throw new PassError('pass-cliのJSON構造が想定と異なります。');
  }
  return { id: item.id, share_id: item.share_id, title: item.title,
    state: item.state, item_type: item.item_type };
}

function strings(value, keys) {
  if (!value || !keys.every(key => typeof value[key] === 'string')) {
    throw new PassError('pass-cliのJSON構造が想定と異なります。');
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
  throw new PassError('pass-cliのJSON構造が想定と異なります。');
}

export class PassClient {
  constructor({ executable, sessionDir, runner = runCli, env = process.env }) {
    if (!executable || !sessionDir) throw new PassError('PASS_CLI_PATH と PROTON_PASS_SESSION_DIR を設定してください。');
    this.executable = executable;
    this.env = { ...env };
    // Windowsの環境変数名は大小文字を区別しない。指定セッションも一意にする。
    for (const key of Object.keys(this.env)) {
      if (['PROTON_PASS_PERSONAL_ACCESS_TOKEN', 'PROTON_PASS_AGENT_REASON', 'PROTON_PASS_SESSION_DIR'].includes(key.toUpperCase())) {
        delete this.env[key];
      }
    }
    this.env.PROTON_PASS_SESSION_DIR = sessionDir;
    this.runner = runner;
    this.queue = Promise.resolve();
  }

  exclusive(work) {
    const pending = this.queue.then(work);
    this.queue = pending.catch(() => {});
    return pending;
  }

  async info(signal) {
    await this.runner(this.executable, ['info'], this.env, signal);
    return { authenticated: true };
  }

  async command(args, { reason, signal, json = true } = {}) {
    await this.info(signal);
    const env = { ...this.env };
    if (reason) env.PROTON_PASS_AGENT_REASON = reason;
    const raw = await this.runner(this.executable, args, env, signal);
    return json ? decode(raw) : raw;
  }

  async vaults(signal) {
    const data = await this.command(['vault', 'list', '--output', 'json'], { signal });
    return { vaults: array(data?.vaults).map(v => strings(v, ['name', 'share_id'])) };
  }

  async shares(signal) {
    // 共有アイテムも列挙するが、未知フィールドや本文は返さない。
    const data = await this.command(['share', 'list', '--output', 'json'], { signal });
    return { shares: array(data?.shares).map(s => {
      const value = strings(s, ['id', 'name', 'share_type']);
      if (!['Vault', 'Item'].includes(value.share_type)) throw new PassError('pass-cliのJSON構造が想定と異なります。');
      return { share_id: value.id, name: value.name, share_type: value.share_type, share_role: shareRole(s.share_role) };
    }) };
  }

  async items({ share_id, type, state = 'active' }, signal) {
    const args = ['item', 'list', '--share-id', share_id, '--output', 'json'];
    if (type) args.push('--filter-type', type);
    if (state !== 'all') args.push('--filter-state', state);
    const data = await this.command(args, { signal });
    return array(data?.items).map(metadata).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  async listItems(input, signal) {
    const items = await this.items(input, signal);
    const { offset = 0, limit = 100, query = '' } = input;
    const filtered = items.filter(i => i.title.toLowerCase().includes(query.toLowerCase()));
    return { items: filtered.slice(offset, offset + limit), total: filtered.length,
      next_offset: offset + limit < filtered.length ? offset + limit : null };
  }

  async searchNotes(input, signal) {
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
      catch { throw new PassError('検索カーソルが無効です。'); }
      if (saved?.fingerprint !== fingerprint || !Number.isInteger(saved.offset) || saved.offset < 0 || saved.offset > items.length) {
        throw new PassError('検索条件または対象一覧が変わりました。カーソルを省略して再検索してください。');
      }
      offset = saved.offset;
    }
    const matches = [];
    const page = items.slice(offset, offset + page_size);
    let checked = 0;
    for (const item of page) {
      const data = await this.command(['item', 'view', '--share-id', item.share_id,
        '--item-id', item.id, '--output', 'json'], { reason, signal });
      const content = data.item?.content;
      if (typeof content?.note !== 'string' || typeof content.title !== 'string') {
        throw new PassError('ノートのJSON構造が想定と異なります。');
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
    const value = await this.command(['item', 'view', '--share-id', share_id,
      '--item-id', item_id, `--field=${field}`], { reason, signal, json: false });
    return { field, value: value.replace(/\r?\n$/, '') };
  }
}
