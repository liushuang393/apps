/**
 * backend API エラー detail の UI 言語への翻訳
 *
 * backend の detail は日本語固定（API 契約）。ja 辞書 apiError.* の値 = backend 原文とし、
 * 原文 → キーを逆引きして現在の UI 言語で i18n.t する。
 * 注意: 辞書と backend のずれは __tests__/apiErrorText.test.ts が検出する。
 */
import i18n from '../i18n';
import ja from '../i18n/locales/ja.json';

/** 補間変数（{{name}}）を捕捉するパターン */
const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g;

/** 原文 → キー（完全一致用） */
const EXACT = new Map<string, string>();
/** 補間付きテンプレート（正規表現・変数名・キー） */
const TEMPLATES: { re: RegExp; names: string[]; key: string }[] = [];

for (const [key, text] of Object.entries(ja.apiError as Record<string, string>)) {
  const names = Array.from(text.matchAll(PLACEHOLDER_RE), (m) => m[1]);
  if (names.length === 0) {
    EXACT.set(text, key);
    continue;
  }
  const body = text
    .split(PLACEHOLDER_RE)
    // split は捕捉グループを奇数位置に挟むため、偶数位置（固定文）だけエスケープする
    .map((part, i) => (i % 2 === 0 ? part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '([\\s\\S]*?)'))
    .join('');
  TEMPLATES.push({ re: new RegExp(`^${body}$`), names, key });
}

/**
 * detail を現在の UI 言語の文言にする
 * 入力: レスポンス JSON の detail（型不定）
 * 出力: 翻訳済み文字列。辞書にない文字列は原文、非文字列は apiError.generic
 * 注意: 呼び出し時点の言語で確定する（言語切替後の再翻訳はしない）
 */
export function translateApiDetail(detail: unknown): string {
  if (typeof detail !== 'string') return i18n.t('apiError.generic');
  const key = EXACT.get(detail);
  if (key) return i18n.t(`apiError.${key}`);
  for (const tpl of TEMPLATES) {
    const m = tpl.re.exec(detail);
    if (m) {
      const values = Object.fromEntries(tpl.names.map((name, i) => [name, m[i + 1]]));
      return i18n.t(`apiError.${tpl.key}`, values);
    }
  }
  return detail;
}
