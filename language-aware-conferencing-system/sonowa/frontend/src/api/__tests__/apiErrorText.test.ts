/**
 * translateApiDetail のテスト
 *
 * 目的: backend の日本語 detail を UI 言語へ翻訳すること、未知文言は原文のまま返すこと、
 *       backend の detail 文字列と ja 辞書（apiError.*）のずれを検出すること（R3）。
 * 注意: backend の .py は import.meta.glob(?raw) で読む（@types/node 不要）。
 *       抽出対象は `detail="..."` / `detail=f"..."` / 括弧内の隣接文字列連結 / 末尾の `+ 式`。
 *       `detail=str(e)` 等の変数渡しは対象外（原文表示のまま）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import ja from '../../i18n/locales/ja.json';
import { translateApiDetail } from '../apiErrorText';

/** backend/app 配下の Python ソース（パス → 本文） */
const BACKEND_SOURCES = import.meta.glob('../../../../backend/app/**/*.py', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** 比較用に補間箇所を置き換える印 */
const SLOT = '\u0000';

/** `detail=` に続く文字列リテラル群（括弧・隣接連結・末尾 + を許容） */
const DETAIL_RE = /\bdetail=\(?\s*((?:f?"(?:[^"\\\n]|\\.)*"\s*)+)(\+)?/g;
/** 個々の文字列リテラル */
const PIECE_RE = /(f?)"((?:[^"\\\n]|\\.)*)"/g;

/** backend から detail テンプレート（補間は SLOT）を抽出する */
function extractBackendDetails(): Map<string, string> {
  const found = new Map<string, string>();
  for (const [path, src] of Object.entries(BACKEND_SOURCES)) {
    for (const m of src.matchAll(DETAIL_RE)) {
      let text = '';
      for (const p of m[1].matchAll(PIECE_RE)) {
        text += p[1] ? p[2].replace(/\{[^{}]*\}/g, SLOT) : p[2];
      }
      if (m[2]) text += SLOT;
      found.set(text, path);
    }
  }
  return found;
}

const jaApiError = ja.apiError as Record<string, string>;
const jaTemplates = new Set(
  Object.values(jaApiError).map((v) => v.replace(/\{\{\s*\w+\s*\}\}/g, SLOT))
);

describe('translateApiDetail', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ja');
  });
  afterEach(async () => {
    await i18n.changeLanguage('ja');
  });

  it('ja では backend 原文と同一の文字列を返す', () => {
    expect(translateApiDetail('会議室が見つかりません')).toBe('会議室が見つかりません');
    expect(translateApiDetail('未対応の言語: xx')).toBe('未対応の言語: xx');
  });

  it('英語 UI では完全一致の detail を英訳する', async () => {
    await i18n.changeLanguage('en');
    expect(translateApiDetail('会議室が見つかりません')).toBe(i18n.t('apiError.roomNotFound'));
    expect(translateApiDetail('会議室が見つかりません')).not.toMatch(/[ぁ-んァ-ン]/);
  });

  it('英語 UI では補間テンプレートに一致した値を埋め込んで訳す', async () => {
    await i18n.changeLanguage('en');
    const out = translateApiDetail('無効なロール: boss。有効なロール: [\'admin\', \'user\']');
    expect(out).toContain('boss');
    expect(out).toContain("['admin', 'user']");
    expect(out).not.toMatch(/[ぁ-んァ-ン]/);
  });

  it('未知の detail は原文のまま返す', async () => {
    await i18n.changeLanguage('en');
    expect(translateApiDetail('未知のフィールドです: [x]')).toBe('未知のフィールドです: [x]');
  });

  it('非文字列 detail は apiError.generic（ja = APIエラー）', async () => {
    expect(translateApiDetail([{ msg: 'x' }])).toBe('APIエラー');
    expect(translateApiDetail(undefined)).toBe('APIエラー');
    await i18n.changeLanguage('en');
    expect(translateApiDetail(null)).toBe(i18n.t('apiError.generic'));
  });
});

describe('backend detail と ja 辞書の整合（R3）', () => {
  const details = extractBackendDetails();

  it('backend ソースを読めている', () => {
    expect(Object.keys(BACKEND_SOURCES).length).toBeGreaterThan(0);
    expect(details.size).toBeGreaterThan(0);
  });

  it('全 literal / f-string detail に ja 辞書エントリがある', () => {
    const missing = [...details].filter(([t]) => !jaTemplates.has(t)).map(([t, p]) => `${p}: ${t}`);
    expect(missing).toEqual([]);
  });
});
