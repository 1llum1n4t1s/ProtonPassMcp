#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PassClient, PassError, checkCancellation } from './pass.mjs';
import { reason, field } from './inputs.mjs';

const client = new PassClient({ executable: process.env.PASS_CLI_PATH,
  sessionDir: process.env.PROTON_PASS_SESSION_DIR });
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const server = new McpServer({ name: 'proton-pass', version });
const id = z.string().min(1).max(512).regex(/^[A-Za-z0-9_+=-]+$/);
const state = z.enum(['active', 'trashed', 'all']).default('active');

function register(name, description, schema, work) {
  server.registerTool(name, { description, inputSchema: z.object(schema).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
  async (input, extra) => client.exclusive(async () => {
    try {
      checkCancellation(extra.signal);
      const result = await work(input, extra.signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
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
register('search_notes', 'Proton Passのテキストノートをタイトル・本文の完全な部分文字列で検索する（Keeperからインポート等）。本文は返さず一致タイトル・ID・状態を返す。1回3件ずつ照合する。complete=falseなら同じ条件とnext_cursorで続行し、全ページのmatchesを集める。保管庫ごとに実行。', {
  share_id: id, query: z.string().min(1).max(1000), reason, state,
  cursor: z.string().max(1024).optional(), page_size: z.number().int().min(1).max(3).default(3),
}, (input, signal) => client.searchNotes(input, signal));
register('read_field', 'ユーザーが取得を求めたProton Passの指定フィールド1つを取得する。値がツール結果に含まれるため、秘密値を必要とする明示依頼で使用する。検索はsearch_notesを使う。', {
  share_id: id, item_id: id, reason,
  field,
}, (input, signal) => client.field(input, signal));

await server.connect(new StdioServerTransport());
