/**
 * UI 言語に追従する言語名ヘルパー
 *
 * Intl.DisplayNames で言語名を生成する。ja の出力は LANGUAGE_NAMES と同一。
 * Intl が使えない環境では LANGUAGE_NAMES（日本語）にフォールバックする。
 */
import type { AllLanguageCode } from '../types';
import { ALL_LANGUAGE_CODES, LANGUAGE_NAMES } from './languages';

/** 表示用コード表記のうち ISO コードの大文字と異なるもの（既存の JP/CN/VN 表記を維持） */
const CODE_LABEL_OVERRIDES: Partial<Record<AllLanguageCode, string>> = {
  ja: 'JP',
  zh: 'CN',
  vi: 'VN',
};

/** UI 言語ごとの Intl.DisplayNames キャッシュ（生成失敗時はキャッシュしない） */
const displayNamesCache = new Map<string, Intl.DisplayNames>();

/** 対応言語コードか判定する */
function isKnownCode(code: string): code is AllLanguageCode {
  return (ALL_LANGUAGE_CODES as string[]).includes(code);
}

/**
 * 言語名を UI 言語で返す
 * 入力: code（言語コード）, uiLang（UI 言語。i18n.language を渡す）
 * 出力: 例 languageName('en', 'en') → 'English'、ja なら '英語'
 * 注意: 未対応コードはコードそのまま返す。Intl 例外時は日本語名を返す
 */
export function languageName(code: string, uiLang: string): string {
  if (!isKnownCode(code)) return code;
  try {
    let names = displayNamesCache.get(uiLang);
    if (!names) {
      names = new Intl.DisplayNames([uiLang], { type: 'language' });
      displayNamesCache.set(uiLang, names);
    }
    return names.of(code) ?? LANGUAGE_NAMES[code];
  } catch {
    return LANGUAGE_NAMES[code];
  }
}

/**
 * コード付き言語名を UI 言語で返す（設定画面用）
 * 入力: code, uiLang
 * 出力: ja → '英語（EN）'（全角括弧）、他 → 'English (EN)'（半角括弧）
 * 注意: 未対応コードはコードそのまま返す。Intl 例外時は日本語表記になる
 */
export function languageNameWithCode(code: string, uiLang: string): string {
  if (!isKnownCode(code)) return code;
  const name = languageName(code, uiLang);
  const label = CODE_LABEL_OVERRIDES[code] ?? code.toUpperCase();
  // Intl 失敗で日本語名に落ちた場合も全角括弧に揃える
  return uiLang === 'ja' || name === LANGUAGE_NAMES[code] ? `${name}（${label}）` : `${name} (${label})`;
}
