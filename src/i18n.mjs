// 人が読む文言（CLI の出力・ヘルプ・標準エラーへの案内）を9言語で返す。
// MCP ツールの説明や AI に返す応答・エラーは英語に統一しており、ここでは扱わない。
import { readFileSync } from 'node:fs';

export const SUPPORTED_LANGUAGES = ['ja', 'en', 'zh-CN', 'zh-TW', 'ko', 'es', 'fr', 'de', 'pt-BR'];
const LANGUAGE_ENV = 'PROTON_PASS_MCP_LANGUAGE';

/**
 * ロケール文字列を対応言語のタグへ照合する。
 * 空・C・POSIX（C.UTF-8 を含む）は判定材料にならないため null を返す。
 * 未対応の言語は 'en' とする。
 */
export function matchLanguage(value) {
  if (typeof value !== 'string') return null;
  const base = value.trim().split(/[.@]/)[0].replaceAll('_', '-').toLowerCase();
  if (base === '' || base === 'c' || base === 'posix') return null;
  const parts = base.split('-');
  const primary = parts[0];
  if (primary === 'japanese') return 'ja';
  if (primary === 'zh') {
    // 文字種（Hans/Hant）を優先し、無ければ地域で判定する。地域も無ければ簡体字。
    if (parts.includes('hant') || parts.some(part => ['tw', 'hk', 'mo'].includes(part))) return 'zh-TW';
    return 'zh-CN';
  }
  if (primary === 'pt') return 'pt-BR';
  return SUPPORTED_LANGUAGES.find(tag => tag.toLowerCase() === primary) ?? 'en';
}

/** PROTON_PASS_MCP_LANGUAGE → LC_ALL → LC_MESSAGES → LANG → OS の表示言語 → 英語の順で決める。 */
export function detectLanguage(env = process.env, osLocale = defaultOsLocale) {
  for (const name of [LANGUAGE_ENV, 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const language = matchLanguage(env[name]);
    if (language) return language;
  }
  let locale;
  try { locale = osLocale(); } catch { locale = undefined; }
  return matchLanguage(locale) ?? 'en';
}

function defaultOsLocale() {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

const cache = new Map();

/** 言語タグの辞書を読み込む。読めない場合は空の辞書（英語へフォールバック）。 */
export function loadDictionary(tag) {
  if (!cache.has(tag)) {
    let dictionary = {};
    try { dictionary = JSON.parse(readFileSync(new URL(`./locales/${tag}.json`, import.meta.url), 'utf8')); }
    catch { /* 辞書が無い・壊れている場合も落とさず英語で表示する。 */ }
    cache.set(tag, dictionary);
  }
  return cache.get(tag);
}

/** キーの文言を現在の言語で返す。辞書に無ければ英語、英語にも無ければキー自身。{name} を置換する。 */
export function t(key, params = {}, language = detectLanguage()) {
  const template = loadDictionary(language)[key] ?? loadDictionary('en')[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}
