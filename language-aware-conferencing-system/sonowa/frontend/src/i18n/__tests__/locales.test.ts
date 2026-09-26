/**
 * ロケールファイル整合性テスト
 * ja/en/zh/vi のキー集合一致・空文字なし・補間変数（{{var}}）一致を検証する。
 * 注意: 訳の品質は検証しない（構造のみ）。
 */
import { describe, expect, it } from 'vitest';
import ja from '../locales/ja.json';
import en from '../locales/en.json';
import zh from '../locales/zh.json';
import vi from '../locales/vi.json';

type LocaleTree = { [key: string]: string | LocaleTree };

const LOCALES: Record<string, LocaleTree> = { ja, en, zh, vi };

/** ネストした JSON を「a.b.c → 値」の平坦なマップへ変換する */
function flatten(tree: LocaleTree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, value);
    } else {
      for (const [k, v] of flatten(value, path)) out.set(k, v);
    }
  }
  return out;
}

/** 文字列中の補間変数名をソート済み配列で返す */
function placeholders(text: string): string[] {
  return Array.from(text.matchAll(/\{\{\s*(\w+)\s*\}\}/g), (m) => m[1]).sort();
}

const flat = Object.fromEntries(
  Object.entries(LOCALES).map(([lang, tree]) => [lang, flatten(tree)])
);
const jaKeys = [...flat.ja.keys()].sort();

describe('locales', () => {
  it.each(Object.keys(LOCALES))('%s のキー集合が ja と一致する', (lang) => {
    expect([...flat[lang].keys()].sort()).toEqual(jaKeys);
  });

  it.each(Object.keys(LOCALES))('%s に空文字の値がない', (lang) => {
    const empty = [...flat[lang]].filter(([, v]) => v.trim() === '').map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('補間変数がロケール間で一致する', () => {
    const mismatches: string[] = [];
    for (const key of jaKeys) {
      const expected = placeholders(flat.ja.get(key) ?? '');
      for (const lang of Object.keys(LOCALES)) {
        const actual = placeholders(flat[lang].get(key) ?? '');
        if (actual.join(',') !== expected.join(',')) mismatches.push(`${lang}:${key}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
