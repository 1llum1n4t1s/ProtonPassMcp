#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PassClient, PassError, checkCancellation } from './pass.mjs';
import { reason, field, id } from './inputs.mjs';
import { parseAccessPolicy, INVALID_POLICY_MESSAGE } from './access-policy.mjs';
import { resolveCliPath } from './setup.mjs';
import { FileHandoffStore } from './handoff-store.mjs';

const disableSecretRead = process.env.PROTON_PASS_DISABLE_SECRET_READ ?? '0';
if (!['0', '1'].includes(disableSecretRead)) {
  process.stderr.write('PROTON_PASS_DISABLE_SECRET_READ は 0 または 1 を指定してください。\n');
  process.exit(1);
}

let policy;
try {
  policy = parseAccessPolicy(process.env.PROTON_PASS_ACCESS_POLICY);
} catch {
  process.stderr.write(`${INVALID_POLICY_MESSAGE}\n`);
  process.exit(1);
}
let handoffs;
try {
  const rawTtl = process.env.PROTON_PASS_HANDOFF_TTL_SECONDS;
  if (rawTtl !== undefined && !/^[1-9][0-9]{0,2}$/.test(rawTtl)) throw new Error();
  handoffs = new FileHandoffStore({ directory: process.env.PROTON_PASS_HANDOFF_DIR,
    ttlSeconds: rawTtl === undefined ? 60 : Number(rawTtl) });
  await handoffs.recover();
} catch {
  process.stderr.write('一時ファイルの設定が無効です。PROTON_PASS_HANDOFF_DIR と PROTON_PASS_HANDOFF_TTL_SECONDS を確認してください。\n');
  process.exit(1);
}
const client = new PassClient({ executable: resolveCliPath(),
  sessionDir: process.env.PROTON_PASS_SESSION_DIR, policy });
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const server = new McpServer({ name: 'proton-pass', version }, {
  instructions: 'Codexで秘密値を会話に出さずローカル入力する場合はcreate_field_handoffを使い、返されたconsumer_module_urlのwithFieldHandoffで入力する。値・callback結果・生例外を表示しない。入力直前に依頼されたログイン先のoriginを確認する。未使用時はrelease_field_handoffで回収する。read_fieldは値を会話へ返す取得経路である。',
});
const state = z.enum(['active', 'trashed', 'all']).default('active');

function register(name, description, schema, work, { readOnly = true, cleanup, policyExempt = false } = {}) {
  server.registerTool(name, { description, inputSchema: z.object(schema).strict(),
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: true } },
  async (input, extra) => client.exclusive(async () => {
    let result;
    try {
      checkCancellation(extra.signal);
      result = await work(input, extra.signal);
      checkCancellation(extra.signal);
      if (name !== 'session_status' && !policyExempt) policy?.assertActive();
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      if (result && cleanup) {
        try { await cleanup(result); }
        catch { error = new PassError('一時ファイルを回収できませんでした。期限回収の結果を確認してください。'); }
      }
      return { isError: true, content: [{ type: 'text', text:
        error instanceof PassError ? error.message : '処理に失敗しました。秘密値を含む可能性があるため内部エラーは表示しません。' }] };
    }
  }));
}

register('session_status', 'Proton Pass pass-cliの既存認証セッションを確認する。', {}, (_, signal) => client.info(signal));
register('list_vaults', 'Proton Passのアクセス可能な保管庫一覧。share_idを他のツールへ渡す。', {}, (_, signal) => client.vaults(signal));
register('list_shares', 'Proton Passで許可された共有の一覧を確認する。', {}, (_, signal) => client.shares(signal));
register('list_items', 'Proton Passのアイテムをタイトルで検索・一覧取得する。本文やパスワードは返さない。next_offsetがあれば続行する。', {
  share_id: id, state, query: z.string().max(1000).default(''),
  type: z.enum(['note', 'login', 'alias', 'credit-card', 'identity', 'ssh-key', 'wifi', 'custom']).optional(),
  offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(100),
}, (input, signal) => client.listItems(input, signal));
register('search_notes', 'Proton Passのテキストノートをタイトル・本文の完全な部分文字列で検索する（Keeperからインポート等）。本文は返さず一致タイトル・ID・状態を返す。1回3件ずつ照合する。complete=falseなら同じ条件とnext_cursorで続行し、全ページのmatchesを集める。保管庫ごとに実行。PROTON_PASS_ACCESS_POLICY設定中は使用不可。list_itemsのタイトル検索を使用する。', {
  share_id: id, query: z.string().min(1).max(1000), reason, state,
  cursor: z.string().max(1024).optional(), page_size: z.number().int().min(1).max(3).default(3),
}, (input, signal) => client.searchNotes(input, signal));
register('create_field_handoff', 'Codexなどのローカル入力処理へProton Passの1フィールドを渡す。値は会話へ返さず、保護された短時間の一時ファイルとconsumer_module_urlを返す。withFieldHandoffで表示せず使用すると使用後に削除される。ログインでは入力先のoriginを確認してから入力し、値やcallback結果を表示しない。未使用時はrelease_field_handoffで回収する。', {
  share_id: id, item_id: id, reason, field,
}, async (input, signal) => {
  policy?.assertActive();
  await handoffs.ready(signal);
  const result = await client.field(input, signal);
  return handoffs.create({ value: result.value, field: result.field, expiresAt: policy?.expiresAt }, signal);
}, { readOnly: false, cleanup: result => handoffs.release(result.handoff_id) });
register('release_field_handoff', '未使用・失敗・期限切れの一時フィールドファイルを回収する。既に使用後削除された参照も安全に回収できる。Proton Passの認証や取得許可の期限に関係なく実行できる。', {
  handoff_id: z.string().regex(/^[a-f0-9]{32}$/),
}, input => handoffs.release(input.handoff_id), { readOnly: false, policyExempt: true });
if (disableSecretRead === '0') {
  register('read_field', 'Proton Passの指定フィールド1つを平文で取得する。値はAIに渡り、接続先の会話履歴・作業ログに保存される可能性がある。AIを通さないブラウザ入力機能ではない。秘密値を取得する明示依頼でのみ使用する。PROTON_PASS_ACCESS_POLICY設定時は許可アイテム・フィールド、取得回数、有効期限に従う。タイトル検索はlist_itemsを使う。', {
    share_id: id, item_id: id, reason,
    field,
  }, (input, signal) => client.field(input, signal));
}

let shutdownPromise;
function shutdown() {
  shutdownPromise ??= (async () => {
    try { await handoffs.close(); }
    catch { process.stderr.write('一時ファイルの終了時回収に失敗しました。次回起動時の回収を確認してください。\n'); process.exitCode = 1; }
    await server.close();
  })();
  return shutdownPromise;
}
process.stdin.once('end', () => { void shutdown().catch(() => { process.exitCode = 1; }); });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void shutdown().catch(() => { process.exitCode = 1; }).finally(() => process.exit(process.exitCode ?? 0)); });
}
await server.connect(new StdioServerTransport());
