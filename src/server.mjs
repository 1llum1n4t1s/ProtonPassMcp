#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PassClient, PassError, checkCancellation } from './pass.mjs';
import { reason, field, id } from './inputs.mjs';
import { parseAccessPolicy } from './access-policy.mjs';
import { resolveCliPath } from './setup.mjs';
import { FileHandoffStore } from './handoff-store.mjs';
import { t } from './i18n.mjs';

const disableSecretRead = process.env.PROTON_PASS_DISABLE_SECRET_READ ?? '0';
if (!['0', '1'].includes(disableSecretRead)) {
  process.stderr.write(`${t('server.invalidDisableSecretRead')}\n`);
  process.exit(1);
}

let policy;
try {
  policy = parseAccessPolicy(process.env.PROTON_PASS_ACCESS_POLICY);
} catch {
  process.stderr.write(`${t('server.invalidAccessPolicy')}\n`);
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
  process.stderr.write(`${t('server.invalidHandoffConfig')}\n`);
  process.exit(1);
}
const client = new PassClient({ executable: resolveCliPath(),
  sessionDir: process.env.PROTON_PASS_SESSION_DIR, policy });
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const server = new McpServer({ name: 'proton-pass', version }, {
  instructions: 'To enter a secret locally without showing it in the conversation (for example in Codex), use create_field_handoff and enter it with withFieldHandoff from the returned consumer_module_url. Never display the value, callback results, or raw exceptions. Right before entering, confirm the origin of the requested login target. Reclaim unused handoffs with release_field_handoff. read_field is a retrieval path that returns the value into the conversation.',
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
        catch { error = new PassError('The temporary file could not be reclaimed. Check the result of the expiry cleanup.'); }
      }
      return { isError: true, content: [{ type: 'text', text:
        error instanceof PassError ? error.message : 'The operation failed. Internal errors are hidden because they may contain secrets.' }] };
    }
  }));
}

register('session_status', 'Check the existing authenticated Proton Pass pass-cli session.', {}, (_, signal) => client.info(signal));
register('list_vaults', 'List the accessible Proton Pass vaults. Pass share_id to the other tools.', {}, (_, signal) => client.vaults(signal));
register('list_shares', 'List the shares allowed in Proton Pass.', {}, (_, signal) => client.shares(signal));
register('list_items', 'Search and list Proton Pass items by title. Bodies and passwords are never returned. Continue with next_offset if present.', {
  share_id: id, state, query: z.string().max(1000).default(''),
  type: z.enum(['note', 'login', 'alias', 'credit-card', 'identity', 'ssh-key', 'wifi', 'custom']).optional(),
  offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(100),
}, (input, signal) => client.listItems(input, signal));
register('search_notes', 'Search Proton Pass text notes by an exact substring of the title or body (for example notes imported from Keeper). Bodies are not returned; matching titles, IDs, and states are. Notes are checked 3 at a time. If complete=false, continue with the same criteria and next_cursor and collect the matches of every page. Run per vault. Unavailable while PROTON_PASS_ACCESS_POLICY is set; use title search with list_items instead.', {
  share_id: id, query: z.string().min(1).max(1000), reason, state,
  cursor: z.string().max(1024).optional(), page_size: z.number().int().min(1).max(3).default(3),
}, (input, signal) => client.searchNotes(input, signal));
register('create_field_handoff', 'Hand one Proton Pass field to a local input process such as Codex. The value is not returned to the conversation; a protected short-lived temporary file and consumer_module_url are returned. Using it with withFieldHandoff without displaying it deletes the file after use. For logins, confirm the origin of the target before entering, and never display the value or callback results. Reclaim unused handoffs with release_field_handoff.', {
  share_id: id, item_id: id, reason, field,
}, async (input, signal) => {
  policy?.assertActive();
  await handoffs.ready(signal);
  const result = await client.field(input, signal);
  return handoffs.create({ value: result.value, field: result.field, expiresAt: policy?.expiresAt }, signal);
}, { readOnly: false, cleanup: result => handoffs.release(result.handoff_id) });
register('release_field_handoff', 'Reclaim unused, failed, or expired temporary field files. References already deleted after use are also handled safely. Works regardless of Proton Pass authentication or the expiry of the access policy.', {
  handoff_id: z.string().regex(/^[a-f0-9]{32}$/),
}, input => handoffs.release(input.handoff_id), { readOnly: false, policyExempt: true });
if (disableSecretRead === '0') {
  register('read_field', 'Read one specified Proton Pass field in plain text. The value is passed to the AI and may be stored in the connected conversation history and work logs. This is not a browser-input feature that bypasses the AI. Use it only when the user explicitly asks to retrieve a secret value. When PROTON_PASS_ACCESS_POLICY is set, the allowed items and fields, read count, and expiry apply. Use list_items for title search.', {
    share_id: id, item_id: id, reason,
    field,
  }, (input, signal) => client.field(input, signal));
}

let shutdownPromise;
function shutdown() {
  shutdownPromise ??= (async () => {
    try { await handoffs.close(); }
    catch { process.stderr.write(`${t('server.handoffShutdownFailed')}\n`); process.exitCode = 1; }
    await server.close();
  })();
  return shutdownPromise;
}
process.stdin.once('end', () => { void shutdown().catch(() => { process.exitCode = 1; }); });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void shutdown().catch(() => { process.exitCode = 1; }).finally(() => process.exit(process.exitCode ?? 0)); });
}
await server.connect(new StdioServerTransport());
