/**
 * 設定パネルコンポーネント
 * 音声モード、字幕、言語を一括管理（統合版）
 * デバイス選択はヘッダーへ移動済み
 */
import { useCallback, useState } from 'react';
import { useRoomStore } from '../store/roomStore';
import { AudioControlPanel } from './AudioControlPanel';
import type { AudioMode, SupportedLanguage, RoomPolicy } from '../types';

/** 言語表示名（統一形式：言語名（コード）） */
const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  ja: '日本語（JP）',
  en: '英語（EN）',
  zh: '中国語（CN）',
  vi: 'ベトナム語（VN）',
};

interface Props {
  onPreferenceChange: (pref: {
    audioMode?: string;
    subtitleEnabled?: boolean;
    targetLanguage?: string;
  }) => void;
  policy?: RoomPolicy | null;
  /** 音声コントロール関連props（シンプル版：デバイス選択はヘッダーへ移動済み） */
  audioProps?: {
    isMicOn: boolean;
    onMicToggle: () => void;
    volumeLevel: number;
    isSpeaking: boolean;
    error: string | null;
  };
}

export function PreferencePanel({ onPreferenceChange, policy: propPolicy, audioProps }: Props) {
  const { policy: storePolicy, myPreference, updateMyPreference } = useRoomStore();

  // propsまたはstoreからpolicyを取得
  const policy = propPolicy ?? storePolicy;

  /** 音声モード変更 */
  const handleAudioModeChange = useCallback(
    (mode: AudioMode) => {
      updateMyPreference({ audioMode: mode });
      onPreferenceChange({ audioMode: mode });
    },
    [updateMyPreference, onPreferenceChange]
  );

  /** 字幕表示トグル */
  const handleSubtitleToggle = useCallback(() => {
    const newValue = !myPreference?.subtitleEnabled;
    updateMyPreference({ subtitleEnabled: newValue });
    onPreferenceChange({ subtitleEnabled: newValue });
  }, [myPreference, updateMyPreference, onPreferenceChange]);

  /** 翻訳先言語変更 */
  const handleLanguageChange = useCallback(
    (lang: SupportedLanguage) => {
      updateMyPreference({ targetLanguage: lang });
      onPreferenceChange({ targetLanguage: lang });
    },
    [updateMyPreference, onPreferenceChange]
  );

  // 折りたたみ状態
  const [isExpanded, setIsExpanded] = useState(true);

  // myPreferenceがない場合はローディング表示
  if (!myPreference) {
    return (
      <div className="preference-panel collapsible-panel expanded">
        <button className="panel-header" disabled>
          <span className="panel-title">
            <span className="panel-icon">⚙️</span>
            設定
          </span>
        </button>
        <div className="panel-content">
          <p className="loading-message">接続中...</p>
        </div>
      </div>
    );
  }

  // policyがない場合でも基本設定は表示（デフォルトで有効化）
  const canSwitchMode = policy?.allowModeSwitch ?? true;
  const allowedLanguages = policy?.allowedLanguages ?? ['ja', 'en', 'zh', 'vi'];

  // 翻訳モードかどうか
  const isTranslatedMode = myPreference.audioMode === 'translated';
  // 選択中の言語の表示名
  const targetLangDisplay = LANGUAGE_NAMES[myPreference.targetLanguage] ?? myPreference.targetLanguage;

  return (
    <div className={`preference-panel collapsible-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        className="panel-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="panel-title">
          <span className="panel-icon">⚙️</span>
          設定
        </span>
        <span className={`chevron ${isExpanded ? 'up' : 'down'}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 4L6 8L10 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      <div className="panel-content">
        {/* 音声デバイス設定（audioPropsがあれば表示） */}
        {audioProps && (
          <AudioControlPanel
            isMicOn={audioProps.isMicOn}
            onMicToggle={audioProps.onMicToggle}
            volumeLevel={audioProps.volumeLevel}
            isSpeaking={audioProps.isSpeaking}
            error={audioProps.error}
          />
        )}

        {/* 音声モード選択 */}
        <div className="setting-group">
          <label className="setting-label">音声モード</label>
          <div className="radio-group">
            <label className="radio-item">
              <input
                type="radio"
                name="audioMode"
                value="original"
                checked={myPreference.audioMode === 'original'}
                onChange={() => handleAudioModeChange('original')}
                disabled={!canSwitchMode}
              />
              <span className="radio-text">原音</span>
            </label>
            <label className="radio-item">
              <input
                type="radio"
                name="audioMode"
                value="translated"
                checked={isTranslatedMode}
                onChange={() => handleAudioModeChange('translated')}
                disabled={!canSwitchMode}
              />
              <span className="radio-text">翻訳音声</span>
            </label>
          </div>
          {!canSwitchMode && (
            <p className="hint-text">※ 会議設定により切替が制限されています</p>
          )}
        </div>

        {/* 字幕表示 */}
        <div className="setting-group">
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={myPreference.subtitleEnabled}
              onChange={handleSubtitleToggle}
            />
            <span>📝 字幕を表示</span>
          </label>
        </div>

        {/* 翻訳先言語（翻訳モード時のみ活性化） */}
        <div className="setting-group">
          <label className="setting-label">翻訳先言語</label>
          <select
            value={myPreference.targetLanguage}
            onChange={(e) =>
              handleLanguageChange(e.target.value as SupportedLanguage)
            }
            disabled={!isTranslatedMode}
            className={!isTranslatedMode ? 'disabled' : ''}
          >
            {allowedLanguages.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_NAMES[lang as SupportedLanguage] ?? lang}
              </option>
            ))}
          </select>
          {!isTranslatedMode && (
            <p className="hint-text">※ 翻訳モード選択時に設定可能</p>
          )}
        </div>

        {/* 現在の設定表示 */}
        <div className="current-setting">
          <p>🎧 音声：{isTranslatedMode ? `${targetLangDisplay}音声` : '原音'}</p>
          <p>
            👁 字幕：
            {myPreference.subtitleEnabled
              ? isTranslatedMode
                ? `${targetLangDisplay}字幕`
                : '原文'
              : 'なし'}
          </p>
        </div>
      </div>
    </div>
  );
}
