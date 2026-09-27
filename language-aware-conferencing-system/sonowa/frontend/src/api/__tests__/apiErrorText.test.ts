/**
 * translateApiDetail のテスト
 *
 * 目的: backend の日本語 detail を UI 言語へ翻訳すること、未知文言は原文のまま返すこと、
 *       backend の detail 文字列と ja 辞書（apiError.*）のずれを検出すること（R3）。
 * 注意: backend の .py は import.meta.glob(?raw) で読む（@types/node 不要）。
 *       抽出対象は `detail="..."` / `detail=f"..."` / 括弧内の隣接文字列連結 / 末尾の `+ 式`。
 *       `detail=str(e)` 等の変数渡しは対象外（原文表示のまま）。
 *       ai-pipeline の warnings は `warnings.append("...")`（隣接連結・f-string 可）を抽出し
 *       （effective_config.py のみ）ja 辞書 pipelineWarning.* と照合する。変数渡しの append は検出して失敗させる。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import ja from '../../i18n/locales/ja.json';
import { translateApiDetail, translatePipelineWarning } from '../apiErrorText';

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
      let text = joinPieces(m[1]);
      if (m[2]) text += SLOT;
      found.set(text, path);
    }
  }
  return found;
}

/** ai-pipeline warnings の生成元（collect_availability_warnings）。orchestrator 等の dict 警告は対象外 */
const WARNING_SOURCE_SUFFIX = 'ai_pipeline/effective_config.py';
/** `warnings.append(` の出現（リテラル以外の引数も数える） */
const WARNING_CALL_RE = /\bwarnings\.append\(/g;
/** `warnings.append(` に続く文字列リテラル群（隣接連結を許容） */
const WARNING_RE = /\bwarnings\.append\(\s*((?:f?"(?:[^"\\\n]|\\.)*"\s*)+)\)/g;

/** 文字列リテラル群を連結し、f-string の補間を SLOT にする */
function joinPieces(literals: string): string {
  let text = '';
  for (const p of literals.matchAll(PIECE_RE)) {
    text += p[1] ? p[2].replace(/\{[^{}]*\}/g, SLOT) : p[2];
  }
  return text;
}

/** backend から ai-pipeline warning テンプレートと、リテラルでない append の件数を抽出する */
function extractBackendWarnings(): { found: Map<string, string>; nonLiteral: string[] } {
  const found = new Map<string, string>();
  const nonLiteral: string[] = [];
  for (const [path, src] of Object.entries(BACKEND_SOURCES)) {
    if (!path.endsWith(WARNING_SOURCE_SUFFIX)) continue;
    const calls = [...src.matchAll(WARNING_CALL_RE)].length;
    const literals = [...src.matchAll(WARNING_RE)];
    for (const m of literals) found.set(joinPieces(m[1]), path);
    if (calls !== literals.length) nonLiteral.push(`${path}: ${calls - literals.length}`);
  }
  return { found, nonLiteral };
}

/** ja 辞書の名前空間を比較用テンプレート集合にする */
function toTemplates(entries: Record<string, string>): Set<string> {
  return new Set(Object.values(entries).map((v) => v.replace(/\{\{\s*\w+\s*\}\}/g, SLOT)));
}

const jaApiError = ja.apiError as Record<string, string>;
const jaTemplates = toTemplates(jaApiError);
const jaWarningTemplates = toTemplates(ja.pipelineWarning as Record<string, string>);

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

describe('translatePipelineWarning', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ja');
  });

  it('英語 UI では backend warning を英訳し、補間値を保つ', async () => {
    await i18n.changeLanguage('en');
    expect(translatePipelineWarning('OPENAI_API_KEY が未設定です。')).toBe(
      i18n.t('pipelineWarning.openaiKeyMissing')
    );
    const out = translatePipelineWarning(
      'local TTS（Qwen3-TTS）のランタイムが未導入です。翻訳音声は出力せず字幕のみとなります。'
    );
    expect(out).toContain('Qwen3-TTS');
    expect(out).not.toMatch(/[ぁ-んァ-ン]/);
  });

  it('未知の warning は原文のまま返す', async () => {
    await i18n.changeLanguage('en');
    expect(translatePipelineWarning('未知の警告です')).toBe('未知の警告です');
  });
});

describe('backend ai-pipeline warnings と ja 辞書の整合（R3）', () => {
  const { found, nonLiteral } = extractBackendWarnings();

  it('backend の warnings を抽出できている', () => {
    expect(Object.keys(BACKEND_SOURCES).some((p) => p.endsWith(WARNING_SOURCE_SUFFIX))).toBe(true);
    expect(found.size).toBeGreaterThan(0);
  });

  it('warnings.append はすべて文字列リテラル（辞書照合できる形）', () => {
    expect(nonLiteral).toEqual([]);
  });

  it('全 warning に ja 辞書 pipelineWarning.* のエントリがある', () => {
    const missing = [...found].filter(([t]) => !jaWarningTemplates.has(t)).map(([t, p]) => `${p}: ${t}`);
    expect(missing).toEqual([]);
  });
});
