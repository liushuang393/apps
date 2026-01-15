/**
 * 音声コントロールパネル（シンプル版）
 * マイクON/OFF制御のみ。デバイス選択はヘッダーに移動済み
 */

interface AudioControlPanelProps {
  /** マイクON状態 */
  isMicOn: boolean;
  /** マイクトグルハンドラ */
  onMicToggle: () => void;
  /** 音量レベル (0-100) */
  volumeLevel: number;
  /** 発話中フラグ */
  isSpeaking: boolean;
  /** エラーメッセージ */
  error: string | null;
}

/**
 * 音声コントロールパネルコンポーネント（シンプル版）
 */
export function AudioControlPanel({
  isMicOn,
  onMicToggle,
  volumeLevel,
  isSpeaking,
  error,
}: AudioControlPanelProps) {
  return (
    <div className="audio-control-inline">
      {error && <div className="error">{error}</div>}

      {/* マイクボタン + 音量インジケーター */}
      <div className="setting-group">
        <label className="setting-label">マイク状態</label>
        <div className="mic-control-row">
          <button
            className={`mic-button ${isMicOn ? 'on' : 'off'}`}
            onClick={onMicToggle}
            title={isMicOn ? 'マイクをOFFにする' : 'マイクをONにする'}
          >
            {isMicOn ? '🎤 ON' : '🔇 OFF'}
          </button>
          <div className="volume-indicator">
            <div className="volume-bar" style={{ width: `${volumeLevel}%` }} />
          </div>
          {isSpeaking && <span className="speaking-badge">発話中</span>}
        </div>
      </div>
    </div>
  );
}

