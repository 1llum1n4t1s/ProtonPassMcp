import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { id, field } from './inputs.mjs';
import { PassError } from './pass.mjs';

export const INVALID_POLICY_MESSAGE = 'PROTON_PASS_ACCESS_POLICY が無効です。ローカルのアクセス設定を確認してください。';

// Date.parseだけでは2月30日等が正規化されるため、暦と時差も検証する。
function validExpiry(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]
    && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59
    && (zone === 'Z' || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4)) <= 59))
    && Number.isFinite(Date.parse(value));
}

const schema = z.object({
  allowed_items: z.array(z.object({
    share_id: id, item_id: id,
    fields: z.array(field).min(1).max(32).refine(values => new Set(values).size === values.length),
  }).strict()).max(1000).refine(items => new Set(items.map(item => JSON.stringify([item.share_id, item.item_id]))).size === items.length),
  max_reads_per_minute: z.number().int().min(1).max(1000).default(10),
  expires_at: z.string().max(64).refine(validExpiry).optional(),
}).strict();

export function parseAccessPolicy(raw) {
  if (raw === undefined) return undefined;
  let parsed;
  try {
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 64 * 1024) throw new Error();
    parsed = schema.parse(JSON.parse(raw));
  } catch {
    throw new PassError(INVALID_POLICY_MESSAGE);
  }
  const allowed = new Map();
  for (const item of parsed.allowed_items) {
    if (!allowed.has(item.share_id)) allowed.set(item.share_id, new Map());
    allowed.get(item.share_id).set(item.item_id, new Set(item.fields));
  }
  const expiresAt = parsed.expires_at === undefined ? undefined : Date.parse(parsed.expires_at);
  const reads = [];
  function assertActive() {
    if (expiresAt !== undefined && Date.now() >= expiresAt) {
      throw new PassError('アクセス設定の有効期限が切れています。');
    }
  }
  // 許可集合や読み取り履歴への変更用参照は外へ渡さない。
  return Object.freeze({
    expiresAt,
    assertActive,
    allowsShare: shareId => allowed.has(shareId),
    allowsItem: (shareId, itemId) => allowed.get(shareId)?.has(itemId) === true,
    assertShare(shareId) {
      assertActive();
      if (!allowed.has(shareId)) throw new PassError('アクセス設定で許可されていない保管庫です。');
    },
    consumeRead(shareId, itemId, fieldName) {
      assertActive();
      if (!allowed.get(shareId)?.get(itemId)?.has(fieldName)) {
        throw new PassError('アクセス設定で許可されていないアイテムまたはフィールドです。');
      }
      const now = performance.now();
      while (reads.length && now - reads[0] >= 60000) reads.shift();
      if (reads.length >= parsed.max_reads_per_minute) {
        throw new PassError('アクセス設定の1分間の取得上限に達しました。');
      }
      reads.push(now);
    },
  });
}
