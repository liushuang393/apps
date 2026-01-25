/**
 * 言語関連の定数定義
 * システムで使用する全言語の情報を一元管理
 */
import type { AllLanguageCode } from '../types';

/**
 * 全対応言語の表示名マッピング（日本語表示）
 * OpenAI高精度対応10言語
 */
export const LANGUAGE_NAMES: Record<AllLanguageCode, string> = {
  en: '英語',
  ja: '日本語',
  zh: '中国語',
  ko: '韓国語',
  vi: 'ベトナム語',
  fr: 'フランス語',
  de: 'ドイツ語',
  ru: 'ロシア語',
  es: 'スペイン語',
  pt: 'ポルトガル語',
};

/**
 * 全対応言語の表示名マッピング（コード付き、設定画面用）
 */
export const LANGUAGE_NAMES_WITH_CODE: Record<AllLanguageCode, string> = {
  en: '英語（EN）',
  ja: '日本語（JP）',
  zh: '中国語（CN）',
  ko: '韓国語（KO）',
  vi: 'ベトナム語（VN）',
  fr: 'フランス語（FR）',
  de: 'ドイツ語（DE）',
  ru: 'ロシア語（RU）',
  es: 'スペイン語（ES）',
  pt: 'ポルトガル語（PT）',
};

/**
 * 全対応言語コードリスト
 */
export const ALL_LANGUAGE_CODES: AllLanguageCode[] = [
  'en',
  'ja',
  'zh',
  'ko',
  'vi',
  'fr',
  'de',
  'ru',
  'es',
  'pt',
];

/**
 * デフォルト有効言語（顧客設定前のデフォルト）
 */
export const DEFAULT_ENABLED_LANGUAGES: AllLanguageCode[] = ['ja', 'en', 'zh', 'vi'];

