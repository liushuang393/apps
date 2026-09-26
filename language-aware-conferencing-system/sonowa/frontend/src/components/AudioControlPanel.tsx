/**
 * 音声コントロールパネル（シンプル版）
 * マイクON/OFF制御のみ。デバイス選択はヘッダーに移動済み
 *
 * ★パフォーマンス最適化★
 * - React.memo でコンポーネントをメモ化
 * - props が変わらない限り再レンダリングしない
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/** セキュアコンテキストエラーかどうか判定 */
const isSecureContextError = (err: string | null): boolean =>
  !!err && (err.includes('HTTPS') || err.includes('localhost') || err.includes('IP'));

/** 現在のホストURLを取得 */
const getCurrentOrigin = (): string => globalThis.location.origin;

interface AudioControlPanelProps {
  /** マイクON状態 */
  readonly isMicOn: boolean;
  /** マイクトグルハンドラ */
  readonly onMicToggle: () => void;
  /** 音量レベル (0-100) */
  readonly volumeLevel: number;
  /** 発話中フラグ */
  readonly isSpeaking: boolean;
  /** エラーメッセージ */
  readonly error: string | null;
}

/**
 * HTTPS/localhostエラー時の簡潔な設定案内
 */
function SecureContextErrorHint() {
  const { t } = useTranslation();
  const origin = getCurrentOrigin();
  const isEdge = navigator.userAgent.includes('Edg');

  return (
    <div className="secure-context-error">
      <p className="error-title">{t('audioControl.secureTitle')}</p>
      <div className="error-steps">
        <p>
          <strong>1.</strong> {t('audioControl.step1')}{' '}
          <code>{isEdge ? 'edge' : 'chrome'}://flags/#unsafely-treat-insecure-origin-as-secure</code>
        </p>
        <p>
          <strong>2.</strong> {t('audioControl.step2')} <code>{origin}</code>
        </p>
        <p>
          <strong>3.</strong> {t('audioControl.step3')}
        </p>
      </div>
    </div>
  );
}

/**
 * 音声コントロールパネルコンポーネント（シンプル版）内部実装
 */
function AudioControlPanelInner({
  isMicOn,
  onMicToggle,
  volumeLevel,
  isSpeaking,
  error,
}: AudioControlPanelProps) {
  const { t } = useTranslation();
  const showSecureHint = isSecureContextError(error);

  return (
    <div className="audio-control-inline">
      {/* マイクボタン + 音量インジケーター */}
      <div className="setting-group">
        <span className="setting-label">{t('audioControl.micStatus')}</span>
        <div className="mic-control-row">
          <button
            className={`mic-button ${isMicOn ? 'on' : 'off'}`}
            onClick={onMicToggle}
            title={isMicOn ? t('audioControl.turnOff') : t('audioControl.turnOn')}
            disabled={showSecureHint}
          >
            {isMicOn ? '🎤 ON' : '🔇 OFF'}
          </button>
          <div className="volume-indicator">
            <div className="volume-bar" style={{ width: `${volumeLevel}%` }} />
          </div>
          {isSpeaking && <span className="speaking-badge">{t('meeting.speaking')}</span>}
        </div>
      </div>

      {/* エラー表示（マイクボタンの下に配置） */}
      {showSecureHint ? (
        <SecureContextErrorHint />
      ) : (
        error && <div className="error-simple">{error}</div>
      )}
    </div>
  );
}

/**
 * ★パフォーマンス最適化: React.memo でメモ化★
 * props が変わらない限り再レンダリングしない
 */
export const AudioControlPanel = memo(AudioControlPanelInner);

