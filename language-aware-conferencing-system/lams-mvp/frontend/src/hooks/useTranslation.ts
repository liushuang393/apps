/**
 * 翻訳プロキシAPIフック
 * クライアント側でテキスト翻訳を実行（サーバー経由でOpenAI APIを呼び出し）
 *
 * 特徴:
 * - ローカルキャッシュで重複翻訳を防止
 * - 同一言語の場合は翻訳スキップ
 * - 非同期で翻訳を実行し、結果をコールバックで返す
 */
import { useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import type { SupportedLanguage } from '../types';

/** 翻訳APIレスポンス */
interface TranslateResponse {
  original_text: string;
  translated_text: string;
  source_language: string;
  target_language: string;
  cached: boolean;
}

/** キャッシュキー生成 */
function cacheKey(text: string, src: string, tgt: string): string {
  return `${src}:${tgt}:${text}`;
}

/** APIベースURL（環境変数から取得、なければ相対パス） */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * 翻訳フック
 * @returns translateText関数（非同期）
 */
export function useTranslation() {
  const token = useAuthStore((s) => s.token);
  // ローカルキャッシュ（Mapでメモリ内に保持）
  const cacheRef = useRef<Map<string, string>>(new Map());

  /**
   * テキストを翻訳
   * @param text 翻訳対象テキスト
   * @param sourceLanguage 元言語
   * @param targetLanguage 翻訳先言語
   * @returns 翻訳されたテキスト（同一言語の場合は原文）
   */
  const translateText = useCallback(
    async (
      text: string,
      sourceLanguage: SupportedLanguage,
      targetLanguage: SupportedLanguage
    ): Promise<string> => {
      // 同一言語なら翻訳不要
      if (sourceLanguage === targetLanguage) {
        return text;
      }

      // 空文字チェック
      if (!text.trim()) {
        return text;
      }

      // ローカルキャッシュチェック
      const key = cacheKey(text, sourceLanguage, targetLanguage);
      const cached = cacheRef.current.get(key);
      if (cached) {
        return cached;
      }

      // API呼び出し
      try {
        const response = await fetch(`${API_BASE_URL}/api/translate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            text,
            source_language: sourceLanguage,
            target_language: targetLanguage,
          }),
        });

        if (!response.ok) {
          console.error('[Translation] APIエラー:', response.status);
          return text; // フォールバック: 原文を返す
        }

        const data: TranslateResponse = await response.json();

        // ローカルキャッシュに保存
        cacheRef.current.set(key, data.translated_text);

        return data.translated_text;
      } catch (error) {
        console.error('[Translation] 翻訳エラー:', error);
        return text; // フォールバック: 原文を返す
      }
    },
    [token]
  );

  /**
   * キャッシュをクリア
   */
  const clearCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  return { translateText, clearCache };
}

