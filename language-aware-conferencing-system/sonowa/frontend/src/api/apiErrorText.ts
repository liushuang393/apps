/**
 * backend 由来の日本語固定文言（API エラー detail / ai-pipeline warnings）の UI 言語への翻訳
 *
 * backend の文言は日本語固定（API 契約）。ja 辞書（apiError.* / pipelineWarning.*）の値 = backend 原文とし、
 * 原文 → キーを逆引きして現在の UI 言語で i18n.t する。
 * 注意: 辞書と backend のずれは __tests__/apiErrorText.test.ts が検出する。
 */
import i18n from '../i18n';
import ja from '../i18n/locales/ja.json';

/** 補間変数（{{name}}）を捕捉するパターン */
const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g;

/** 原文 → キーの逆引き表（完全一致 + 補間付きテンプレート） */
interface ReverseDict {
  exact: Map<string, string>;
  templates: { re: RegExp; names: string[]; key: string }[];
}

/**
 * ja 辞書の名前空間から逆引き表を作る
 * 入力: ja 辞書の 1 名前空間（キー → 原文）
 * 出力: 逆引き表
 */
function buildReverseDict(entries: Record<string, string>): ReverseDict {
  const dict: ReverseDict = { exact: new Map(), templates: [] };
  for (const [key, text] of Object.entries(entries)) {
    const names = Array.from(text.matchAll(PLACEHOLDER_RE), (m) => m[1]);
    if (names.length === 0) {
      dict.exact.set(text, key);
      continue;
    }
    const body = text
      .split(PLACEHOLDER_RE)
      // split は捕捉グループを奇数位置に挟むため、偶数位置（固定文）だけエスケープする
      .map((part, i) => (i % 2 === 0 ? part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '([\\s\\S]*?)'))
      .join('');
    dict.templates.push({ re: new RegExp(`^${body}$`), names, key });
  }
  return dict;
}

/**
 * 原文を逆引きして現在の UI 言語で訳す
 * 入力: 名前空間 / 逆引き表 / 原文
 * 出力: 翻訳済み文字列。辞書にない文字列は原文のまま
 */
function translateBackendText(ns: string, dict: ReverseDict, text: string): string {
  const key = dict.exact.get(text);
  if (key) return i18n.t(`${ns}.${key}`);
  for (const tpl of dict.templates) {
    const m = tpl.re.exec(text);
    if (m) {
      const values = Object.fromEntries(tpl.names.map((name, i) => [name, m[i + 1]]));
      return i18n.t(`${ns}.${tpl.key}`, values);
    }
  }
  return text;
}

const API_ERROR_DICT = buildReverseDict(ja.apiError as Record<string, string>);
const PIPELINE_WARNING_DICT = buildReverseDict(ja.pipelineWarning as Record<string, string>);

/**
 * detail を現在の UI 言語の文言にする
 * 入力: レスポンス JSON の detail（型不定）
 * 出力: 翻訳済み文字列。辞書にない文字列は原文、非文字列は apiError.generic
 * 注意: 呼び出し時点の言語で確定する（言語切替後の再翻訳はしない）
 */
export function translateApiDetail(detail: unknown): string {
  if (typeof detail !== 'string') return i18n.t('apiError.generic');
  return translateBackendText('apiError', API_ERROR_DICT, detail);
}

/**
 * ai-pipeline 設定の warnings（backend collect_availability_warnings の日本語）を UI 言語にする
 * 入力: warning 原文
 * 出力: 翻訳済み文字列。辞書にない文字列は原文のまま
 * 注意: 描画時に呼ぶこと（言語切替に追従させるため）
 */
export function translatePipelineWarning(warning: string): string {
  return translateBackendText('pipelineWarning', PIPELINE_WARNING_DICT, warning);
}
