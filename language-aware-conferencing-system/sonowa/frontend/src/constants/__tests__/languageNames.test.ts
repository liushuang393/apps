/**
 * 言語名ヘルパーのテスト
 *
 * ja は既存定数と完全一致（表示回帰なし）、他言語は Intl.DisplayNames の名称になることを確認する。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { languageName, languageNameWithCode } from '../languageNames';
import { ALL_LANGUAGE_CODES, LANGUAGE_NAMES, LANGUAGE_NAMES_WITH_CODE } from '../languages';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('languageName', () => {
  it('ja は LANGUAGE_NAMES と全 10 言語一致する', () => {
    for (const code of ALL_LANGUAGE_CODES) {
      expect(languageName(code, 'ja')).toBe(LANGUAGE_NAMES[code]);
    }
  });

  it('en / zh / vi は Intl の言語名を返す', () => {
    expect(languageName('en', 'en')).toBe('English');
    expect(languageName('ja', 'en')).toBe('Japanese');
    expect(languageName('en', 'zh')).toBe('英语');
    expect(languageName('en', 'vi')).toBe('Tiếng Anh');
  });

  it('未知コードはコードそのまま返す', () => {
    expect(languageName('xx', 'en')).toBe('xx');
    expect(languageName('', 'ja')).toBe('');
  });

  it('Intl.DisplayNames が例外を投げたら LANGUAGE_NAMES にフォールバックする', () => {
    vi.stubGlobal('Intl', {
      ...Intl,
      DisplayNames: class {
        constructor() {
          throw new RangeError('unsupported');
        }
      },
    });
    // キャッシュ未使用の UI 言語で検証する
    expect(languageName('en', 'ko')).toBe(LANGUAGE_NAMES.en);
    expect(languageNameWithCode('en', 'ko')).toBe(LANGUAGE_NAMES_WITH_CODE.en);
  });
});

describe('languageNameWithCode', () => {
  it('ja は LANGUAGE_NAMES_WITH_CODE と全 10 言語一致する', () => {
    for (const code of ALL_LANGUAGE_CODES) {
      expect(languageNameWithCode(code, 'ja')).toBe(LANGUAGE_NAMES_WITH_CODE[code]);
    }
  });

  it('他言語は半角括弧でコードを付ける', () => {
    expect(languageNameWithCode('en', 'en')).toBe('English (EN)');
    expect(languageNameWithCode('zh', 'en')).toBe('Chinese (CN)');
    expect(languageNameWithCode('vi', 'vi')).toBe('Tiếng Việt (VN)');
  });

  it('未知コードはコードそのまま返す', () => {
    expect(languageNameWithCode('xx', 'en')).toBe('xx');
  });
});
