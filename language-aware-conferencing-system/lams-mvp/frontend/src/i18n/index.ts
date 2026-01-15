/**
 * i18n 国際化設定
 * 日本語・英語・中国語・ベトナム語をサポート
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import ja from './locales/ja.json';
import en from './locales/en.json';
import zh from './locales/zh.json';
import vi from './locales/vi.json';

/** 対応言語 */
export const SUPPORTED_LANGUAGES = ['ja', 'en', 'zh', 'vi'] as const;
export type UILanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** 言語表示名（各言語での表示） */
export const LANGUAGE_DISPLAY_NAMES: Record<UILanguage, string> = {
  ja: '日本語',
  en: 'English',
  zh: '中文',
  vi: 'Tiếng Việt',
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ja: { translation: ja },
      en: { translation: en },
      zh: { translation: zh },
      vi: { translation: vi },
    },
    fallbackLng: 'ja',
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;

