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
const selectInterimBySpeaker = (s: ReturnType<typeof useRoomStore.getState>) => s.interimBySpeaker;
const selectMyPreference = (s: ReturnType<typeof useRoomStore.getState>) => s.myPreference;
const selectParticipants = (s: ReturnType<typeof useRoomStore.getState>) => s.participants;

function SubtitleDisplayInner() {
  // ★パフォーマンス最適化: 個別セレクターで購読★
  const subtitles = useRoomStore(selectSubtitles);
  const interimSubtitles = useRoomStore(selectInterimSubtitles);
  const interimBySpeaker = useRoomStore(selectInterimBySpeaker);
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

  // 新しい字幕・暫定字幕が追加されたら自動スクロール
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displaySubtitles, interimBySpeaker]);

  // ★暫定字幕（partial）の話者ごとの最新行。原文のみを低遅延で表示する
  const partialSubtitles = Object.values(interimBySpeaker);

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
      {displaySubtitles.length === 0 &&
      interimSubtitles.size === 0 &&
      partialSubtitles.length === 0 ? (
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
            // React key は (id, 言語) 複合で安定化（改善点 D1: 同一 id でも言語別に
            // 別要素として扱い、キー衝突を避ける）。id 欠落時は従来フォールバック。
            const subtitleKey = sub.id
              ? `${sub.id}:${sub.targetLanguage ?? ''}`
              : `${sub.speakerId}-${idx}-${sub.originalText.slice(0, 10)}`;

            // 全主線失敗の縮退字幕（原文のみ）。前端でも翻訳できなかった場合のみ印を出す。
            const isDegraded = Boolean(sub.degraded) && !sub.isTranslated;
            return (
              <div
                key={subtitleKey}
                className={`subtitle-item ${isMyMessage ? 'my-message' : ''} ${isDegraded ? 'degraded' : ''}`}
                // 使用モデルID を可観測用にツールチップ表示（A/B・回放の手掛かり）。
                title={sub.modelId ? `model: ${sub.modelId}` : undefined}
              >
                <span className="speaker-name">
                  {displayName}
                  {isMyMessage && ' (自分)'}
                  {/* 話者分離ラベル（P4-A）: track 権威の名前を補う増強情報。
                      未有効時は null で非表示（後方互換）。 */}
                  {sub.speakerLabel && (
                    <span
                      className="speaker-label-tag"
                      style={{ marginLeft: '0.3rem', fontSize: '0.8em', color: '#9aa0b5' }}
                    >
                      〔{sub.speakerLabel}〕
                    </span>
                  )}
                  ：
                </span>
                <span className="subtitle-text">
                  {sub.isTranslating ? '翻訳中...' : sub.displayText}
                </span>
                {sub.isTranslated && (
                  <span className="translated-badge">翻訳</span>
                )}
                {isDegraded && (
                  <span
                    className="degraded-badge"
                    title="全主線が失敗したため原文のみ表示（翻訳不可）"
                    style={{
                      marginLeft: '0.5rem',
                      fontSize: '0.8em',
                      color: '#e0a020',
                    }}
                  >
                    ⚠ 原文
                  </span>
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
          {/* ★暫定字幕（partial）: 話者ごとに1行、原文のみを低遅延表示。
              確定字幕と区別するため斜体＋不透明度↓＋末尾"…"で示す */}
          {partialSubtitles.map((partial) => {
            const speaker = participants.get(partial.speakerId);
            const displayName = speaker?.displayName || '不明';
            const isMyMessage = partial.speakerId === currentUserId;
            return (
              <div
                key={`partial-${partial.speakerId}`}
                className={`subtitle-item interim-partial ${isMyMessage ? 'my-message' : ''}`}
                style={{ opacity: 0.55, fontStyle: 'italic' }}
              >
                <span className="speaker-name">
                  {displayName}
                  {isMyMessage && ' (自分)'}：
                </span>
                <span className="subtitle-text">{partial.originalText}…</span>
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
