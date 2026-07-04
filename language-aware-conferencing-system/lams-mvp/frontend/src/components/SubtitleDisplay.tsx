/**
 * 字幕表示コンポーネント
 * クライアント側翻訳対応版
 *
 * ★翻訳ロジック★
 * - 原声モード: 字幕は原文のまま表示（翻訳なし、普通の会議と同じ）
 * - 翻訳モード: 目標言語に翻訳（source_lang == target_lang なら原文）
 *
 * ★パフォーマンス最適化★
 * - Zustand セレクターで必要な状態のみ購読（不要な再レンダリング防止）
 * - React.memo でコンポーネントをメモ化
 * - useRef で処理済みIDを追跡（無限ループ防止）
 *
 * 目標: 母語で聞き、母語の字幕を見る
 */
import { useEffect, useRef, useState, memo } from 'react';
import { useRoomStore } from '../store/roomStore';
import { useAuthStore } from '../store/authStore';
import { useTranslation } from '../hooks/useTranslation';
import type { SubtitleData } from '../types';

/** 表示用字幕データ（翻訳テキスト含む） */
interface DisplaySubtitle extends SubtitleData {
  displayText: string;
  isTranslating: boolean;
}

/**
 * ★パフォーマンス最適化: Zustand セレクター★
 * 必要な状態のみを購読し、不要な再レンダリングを防止
 */
const selectSubtitles = (s: ReturnType<typeof useRoomStore.getState>) => s.subtitles;
const selectInterimSubtitles = (s: ReturnType<typeof useRoomStore.getState>) => s.interimSubtitles;
const selectMyPreference = (s: ReturnType<typeof useRoomStore.getState>) => s.myPreference;
const selectParticipants = (s: ReturnType<typeof useRoomStore.getState>) => s.participants;

function SubtitleDisplayInner() {
  // ★パフォーマンス最適化: 個別セレクターで購読★
  const subtitles = useRoomStore(selectSubtitles);
  const interimSubtitles = useRoomStore(selectInterimSubtitles);
  const myPreference = useRoomStore(selectMyPreference);
  const participants = useRoomStore(selectParticipants);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { translateText, getTranslationById, clearCache } = useTranslation();

  // 翻訳済み字幕のローカルstate
  const [displaySubtitles, setDisplaySubtitles] = useState<DisplaySubtitle[]>([]);

  // ユーザー設定
  const audioMode = myPreference?.audioMode || 'original';
  const targetLanguage = myPreference?.targetLanguage || myPreference?.nativeLanguage || 'ja';

  // 字幕または設定が変わったら、表示用テキストを再計算する。
  useEffect(() => {
    let cancelled = false;

    const buildDisplaySubtitle = async (sub: SubtitleData): Promise<DisplaySubtitle> => {
      if (audioMode === 'original') {
        return {
          ...sub,
          displayText: sub.originalText,
          isTranslating: false,
          isTranslated: false,
        };
      }

      if (sub.sourceLanguage === targetLanguage) {
        return {
          ...sub,
          displayText: sub.originalText,
          isTranslating: false,
          isTranslated: false,
        };
      }

      try {
        let translated = sub.targetLanguage === targetLanguage ? sub.translatedText ?? null : null;
        if (!translated && sub.id) {
          translated = await getTranslationById(sub.id, targetLanguage, true);
        }
        if (!translated) {
          translated = await translateText(
            sub.originalText,
            sub.sourceLanguage,
            targetLanguage
          );
        }
        const displayText = translated || sub.originalText;
        const isActuallyTranslated = displayText !== sub.originalText;
        return {
          ...sub,
          displayText,
          translatedText: isActuallyTranslated ? displayText : undefined,
          isTranslating: false,
          isTranslated: isActuallyTranslated,
        };
      } catch {
        return {
          ...sub,
          displayText: sub.originalText,
          isTranslating: false,
          isTranslated: false,
        };
      }
    };

    const processSubtitles = async () => {
      if (subtitles.length === 0) {
        if (!cancelled) {
          setDisplaySubtitles([]);
        }
        return;
      }
      const processed = await Promise.all(subtitles.map(buildDisplaySubtitle));
      if (!cancelled) {
        setDisplaySubtitles(processed.slice(-50));
      }
    };

    void processSubtitles();
    return () => {
      cancelled = true;
    };
  }, [subtitles, audioMode, targetLanguage, translateText, getTranslationById]);

  useEffect(() => {
    clearCache();
  }, [clearCache, targetLanguage]);

  // 新しい字幕が追加されたら自動スクロール
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displaySubtitles]);

  // 字幕無効の場合は最小表示
  if (!myPreference?.subtitleEnabled) {
    return (
      <div className="subtitle-display" style={{ opacity: 0.5 }}>
        <h4>📝 字幕</h4>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>
          字幕表示はオフです
        </p>
      </div>
    );
  }

  return (
    <div className="subtitle-display" ref={scrollRef}>
      <h4>📝 字幕・会議記録</h4>
      {displaySubtitles.length === 0 && interimSubtitles.size === 0 ? (
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>
          発言を待っています...
        </p>
      ) : (
        <>
          {displaySubtitles.map((sub, idx) => {
            const speaker = participants.get(sub.speakerId);
            const isMyMessage = sub.speakerId === currentUserId;
            // 話者が見つからない場合は「不明」と表示
            const displayName = speaker?.displayName || '不明';
            const subtitleKey = sub.id ?? `${sub.speakerId}-${idx}-${sub.originalText.slice(0, 10)}`;

            return (
              <div
                key={subtitleKey}
                className={`subtitle-item ${isMyMessage ? 'my-message' : ''}`}
              >
                <span className="speaker-name">
                  {displayName}
                  {isMyMessage && ' (自分)'}：
                </span>
                <span className="subtitle-text">
                  {sub.isTranslating ? '翻訳中...' : sub.displayText}
                </span>
                {sub.isTranslated && (
                  <span className="translated-badge">翻訳</span>
                )}
              </div>
            );
          })}
          {/* ★ストリーミング字幕（認識中） */}
          {Array.from(interimSubtitles.values()).map((interim) => {
            const speaker = participants.get(interim.speakerId);
            const displayName = speaker?.displayName || '不明';
            return (
              <div
                key={`interim-${interim.id}`}
                className="subtitle-item interim"
                style={{ opacity: 0.7, fontStyle: 'italic' }}
              >
                <span className="speaker-name">{displayName}：</span>
                <span className="subtitle-text">{interim.text}</span>
                <span className="interim-badge" style={{ marginLeft: '0.5rem', fontSize: '0.8em', color: '#888' }}>
                  認識中...
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * ★パフォーマンス最適化: React.memo でメモ化★
 * props が変わらない限り再レンダリングしない
 */
export const SubtitleDisplay = memo(SubtitleDisplayInner);
