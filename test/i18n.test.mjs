import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_LANGUAGES, detectLanguage, loadDictionary, matchLanguage, t } from '../src/i18n.mjs';

const srcDir = new URL('../src/', import.meta.url);
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('全言語の辞書が英語と同じキー集合・プレースホルダーを持つ', () => {
  const english = loadDictionary('en');
  const keys = Object.keys(english).sort();
  assert.ok(keys.length > 0);
  for (const tag of SUPPORTED_LANGUAGES) {
    const dictionary = loadDictionary(tag);
    assert.deepEqual(Object.keys(dictionary).sort(), keys, `${tag}: キー集合`);
    for (const key of keys) {
      assert.equal(typeof dictionary[key], 'string', `${tag}:${key}`);
      assert.notEqual(dictionary[key].trim(), '', `${tag}:${key} が空`);
      assert.deepEqual(placeholders(dictionary[key]), placeholders(english[key]), `${tag}:${key} のプレースホルダー`);
    }
  }
  // 辞書ファイルは対応言語と過不足なく一致する。
  const files = readdirSync(new URL('locales/', srcDir)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort();
  assert.deepEqual(files, [...SUPPORTED_LANGUAGES].sort());
});

test('コードが参照するキーは英語辞書に存在し、辞書のキーは使われている', () => {
  const english = loadDictionary('en');
  const used = new Set();
  for (const name of readdirSync(srcDir).filter(file => file.endsWith('.mjs'))) {
    const source = readFileSync(new URL(name, srcDir), 'utf8');
    for (const match of source.matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(match[1]);
  }
  assert.ok(used.size > 0);
  for (const key of used) assert.ok(key in english, `辞書に無いキー: ${key}`);
  for (const key of Object.keys(english)) assert.ok(used.has(key), `未使用のキー: ${key}`);
});

test('言語タグを仕様どおりに照合する', () => {
  const cases = {
    ja: 'ja', 'ja-JP': 'ja', ja_JP: 'ja', 'ja_JP.UTF-8': 'ja', Japanese_Japan: 'ja', en: 'en', 'en-US': 'en',
    'zh-Hans': 'zh-CN', 'zh-CN': 'zh-CN', 'zh-SG': 'zh-CN', zh_CN: 'zh-CN', zh: 'zh-CN',
    'zh-Hant': 'zh-TW', 'zh-TW': 'zh-TW', 'zh-HK': 'zh-TW', 'zh-MO': 'zh-TW', 'zh-Hant-HK': 'zh-TW',
    pt: 'pt-BR', 'pt-BR': 'pt-BR', 'pt-PT': 'pt-BR', pt_PT: 'pt-BR', 'ko-KR': 'ko', 'es-MX': 'es', 'fr-CA': 'fr', 'de-AT': 'de',
    it: 'en', xx: 'en',
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(matchLanguage(input), expected, input);
  for (const input of ['', '  ', 'C', 'C.UTF-8', 'POSIX', undefined]) assert.equal(matchLanguage(input), null, String(input));
});

test('言語判定の優先順位と英語へのフォールバック', () => {
  const none = () => undefined;
  assert.equal(detectLanguage({ PROTON_PASS_MCP_LANGUAGE: 'ko', LC_ALL: 'de' }, none), 'ko');
  assert.equal(detectLanguage({ LC_ALL: 'fr_FR.UTF-8', LC_MESSAGES: 'de', LANG: 'es' }, none), 'fr');
  assert.equal(detectLanguage({ LC_ALL: 'C', LC_MESSAGES: 'de', LANG: 'es' }, none), 'de');
  assert.equal(detectLanguage({ LANG: 'POSIX' }, () => 'pt-BR'), 'pt-BR');
  assert.equal(detectLanguage({}, () => 'ja-JP'), 'ja');
  assert.equal(detectLanguage({}, none), 'en');
  assert.equal(detectLanguage({}, () => { throw new Error('unavailable'); }), 'en');
});

test('プレースホルダーを置換し、辞書に無いキーは英語・キー自身にする', () => {
  assert.equal(t('setup.sizeExceeded', { max: 5 }, 'ja'), 'ダウンロードサイズが上限（5 bytes）を超えています。');
  assert.equal(t('setup.sizeExceeded', {}, 'en'), 'The download size exceeds the limit ({max} bytes).');
  assert.equal(t('no.such.key', {}, 'ja'), 'no.such.key');
  // 未対応タグの辞書は空として扱い、英語へフォールバックする。
  assert.equal(t('cli.unknownError', {}, 'xx'), 'Unknown error');
});

test('READMEは全言語版が同じ構成で、固定版の文字列を含む', () => {
  const root = new URL('../', import.meta.url);
  const { name, version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const files = { en: 'README.md', ja: 'README.ja.md', 'zh-CN': 'README.zh-CN.md', 'zh-TW': 'README.zh-TW.md', ko: 'README.ko.md',
    es: 'README.es.md', fr: 'README.fr.md', de: 'README.de.md', 'pt-BR': 'README.pt-BR.md' };
  assert.deepEqual(Object.keys(files).sort(), [...SUPPORTED_LANGUAGES].sort());
  const count = (text, pattern) => (text.match(pattern) ?? []).length;
  const base = readFileSync(new URL(files.en, root), 'utf8');
  for (const [tag, file] of Object.entries(files)) {
    const text = readFileSync(new URL(file, root), 'utf8');
    // 先頭付近に9言語の切替行があり、他言語版へのリンクを全て含む。
    const head = text.split('\n').slice(0, 5).join('\n');
    for (const other of Object.values(files)) {
      if (other !== file) assert.ok(head.includes(`](${other})`), `${file}: 切替行に ${other} が無い`);
    }
    assert.ok(text.includes(`${name}@${version}`), `${file}: 固定版の文字列`);
    assert.equal(count(text, /^#{1,3} /gm), count(base, /^#{1,3} /gm), `${tag}: 見出し数`);
    assert.equal(count(text, /^```/gm), count(base, /^```/gm), `${tag}: コードブロック数`);
    assert.equal(count(text, /^\|/gm), count(base, /^\|/gm), `${tag}: 表の行数`);
    assert.equal(count(text, /proton-pass-mcp@latest/g), count(base, /proton-pass-mcp@latest/g), `${tag}: @latest の数`);
  }
});
