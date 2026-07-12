/**
 * キャプチャプロファイル決定表モジュール
 *
 * 目的:
 *   「どのプラットフォーム × どの入力モード × どの実効デバイスか」の判定を
 *   本ファイルの決定表1箇所に完全集約する。半二重ゲート・VADプリセット・
 *   TTS抑止・無音フォールバック先は、必ずこの決定表を参照して決める。
 *
 * 背景（漏識別の根本原因）:
 *   従来は sendAudioData / updateVADSensitivity 等が state.audioSourceType
 *   （UI上の選択値）や outputDeviceId を個別に参照して判定しており、
 *   フォールバックで実効デバイスが変わっても判定が追随せず、
 *   「TTS再生中の相手発話を破棄」「静かなマイクにシステム用しきい値」等の
 *   モード判定の混在バグを生んでいた。
 *
 * 設計原則:
 *   - 入力は絶対に落とさない（同時通訳セッションでは半二重禁止）。エコー/回灌は
 *     getUserMedia の AEC＋ネイティブレート採集と出力側（TTS抑止）で断つ。
 *   - duplex はキャプチャ経路のトポロジー × セッション種別で決まる。
 *     同時通訳（realtimeSession=true）の物理マイクは全二重（TTS再生中も採集を止めない。
 *     半二重化すると再生中の発話を丸ごと取りこぼす＝致命的な文落ちになるため）。
 *   - DOM/アプリ状態に依存しない純関数のみ（Jest で決定表をそのまま検証できる）。
 */

/**
 * プロファイルID定数（実在する6モード）
 * @type {Readonly<Record<string, string>>}
 */
const CAPTURE_PROFILE_IDS = Object.freeze({
    ELECTRON_MIC: 'electron-mic',
    ELECTRON_VIRTUAL_CARD: 'electron-virtual-card',
    ELECTRON_LOOPBACK: 'electron-loopback',
    ELECTRON_MIC_FALLBACK: 'electron-mic-fallback',
    BROWSER_MIC: 'browser-mic',
    BROWSER_TAB: 'browser-tab'
});

/** 入力モードの取り得る値 */
const VALID_SOURCE_TYPES = Object.freeze(['microphone', 'system']);
/** フォールバック段の取り得る値（null = マイクモード/段未確定） */
const VALID_FALLBACK_STAGES = Object.freeze(['virtual-card', 'loopback', 'microphone', null]);

/**
 * プロファイルIDを導出する（決定表の行選択）。
 *
 * マイクモードは常にマイク行（フォールバック対象外＝段は無視）。
 * 非Electron の system はタブ音声共有（getDisplayMedia）で段の概念が無い。
 *
 * @param {Object} input
 * @param {boolean} input.isElectron - Electron 環境か
 * @param {string} input.audioSourceType - 'microphone' | 'system'（UI選択値）
 * @param {string|null} input.fallbackStage - 実効デバイス段（_captureFallbackStage）
 * @returns {string} CAPTURE_PROFILE_IDS のいずれか
 * @throws {Error} 列挙値そのものが不正な場合
 */
function deriveCaptureProfileId({ isElectron, audioSourceType, fallbackStage }) {
    if (!VALID_SOURCE_TYPES.includes(audioSourceType)) {
        throw new Error(`不正な audioSourceType: ${String(audioSourceType)}`);
    }
    if (!VALID_FALLBACK_STAGES.includes(fallbackStage ?? null)) {
        throw new Error(`不正な fallbackStage: ${String(fallbackStage)}`);
    }

    if (audioSourceType === 'microphone') {
        return isElectron ? CAPTURE_PROFILE_IDS.ELECTRON_MIC : CAPTURE_PROFILE_IDS.BROWSER_MIC;
    }

    // system モード
    if (!isElectron) {
        return CAPTURE_PROFILE_IDS.BROWSER_TAB;
    }
    if (fallbackStage === 'loopback') {
        return CAPTURE_PROFILE_IDS.ELECTRON_LOOPBACK;
    }
    if (fallbackStage === 'microphone') {
        return CAPTURE_PROFILE_IDS.ELECTRON_MIC_FALLBACK;
    }
    // 'virtual-card' または段未確定（開始直後）は仮想カード行として扱う
    return CAPTURE_PROFILE_IDS.ELECTRON_VIRTUAL_CARD;
}

/**
 * キャプチャプロファイル（決定表の1行）を構築する。
 *
 * 決定表:
 * | profileId             | 実効デバイス  | duplex                         | vadPreset  | captionPolicy       | ttsPolicy            | 無音フォールバック先 |
 * |-----------------------|--------------|--------------------------------|------------|---------------------|----------------------|--------------------|
 * | electron-mic          | microphone   | 通訳=full / 他=mic-protected     | MICROPHONE | stream-preview      | play                 | null（検証なし）     |
 * | electron-virtual-card | virtual-card | full                           | MICROPHONE | chat-authoritative  | 出力隔離済み→play     | loopback           |
 * | electron-loopback     | loopback     | full                           | SYSTEM     | stream-preview      | suppress             | microphone         |
 * | electron-mic-fallback | microphone   | 通訳=full / 他=mic-protected     | MICROPHONE | stream-preview      | play                 | null（警告のみ）     |
 * | browser-mic           | microphone   | 通訳=full / 他=mic-protected     | MICROPHONE | stream-preview      | play                 | null               |
 * | browser-tab           | tab          | full                           | SYSTEM     | stream-preview      | play                 | null（警告のみ）     |
 *
 * captionPolicy の意味:
 *   'stream-preview'     = 路径2(Realtime output_transcript)を右列に暫定表示し、路径3(Chat)で上書き。
 *   'chat-authoritative' = 仮想声卡監視専用。路径2は右列に載せない（音声訳ストリームの幻覚・行ズレを排除）。
 *                         右列の正本は左確定原文→路径3(Chat文本翻訳)のみ。AEC等のマイク制約は持ち込まない。
 *
 * preferContinuousCapture:
 *   true のときクライアントVADゲートをbypassして常時送信（翻訳EPは turn_detection 無しの連続ストリーム）。
 *   仮想声卡のみ true（マイク経路は従来どおり Server VAD UI / クライアントVAD）。
 *
 * duplex の意味:
 *   'full'          = 常時連続採集（TTS再生中も入力を落とさない）。
 *                     仮想カード/タブ共有はデジタル隔離経路で自分のTTSを含まない。
 *                     ループバックは ttsPolicy=suppress により回灌自体が発生しない。
 *                     同時通訳セッションの物理マイクも full（TTSがほぼ連続再生されるため、
 *                     半二重だと発話の大半を破棄してしまう。エコーは AEC で抑制する）。
 *                     mic-fallback（system→マイク降格）も通訳セッションでは full。
 *                     ここを半二重化すると「PCマイク監視」で訳音再生中の相手発話を落とす。
 *   'mic-protected' = 物理マイク（通訳セッション以外）。TTS再生中＋再生終了後
 *                     bufferWindow 内はスキップ（スピーカー→マイクのエコー再入力防止）。
 *
 * ttsPolicy の意味:
 *   'play'     = audioOutputMode 設定に従い翻訳音声を再生する。
 *   'suppress' = 回灌（訳音の再取り込み）を防ぐため翻訳音声を一時ミュートする。
 *                仮想声卡は物理出力へ隔離できない場合だけ suppress とする。
 *                ヘッドホン等へ setSinkId できる場合は play、ループバックは常時 suppress。
 *
 * noiseReduction:
 *   全プロファイル null。near_field / far_field はマイク距離用であり、
 *   仮想声卡のデジタル音声には適用しない。
 *
 * @param {Object} input
 * @param {boolean} input.isElectron - Electron 環境か
 * @param {string} input.audioSourceType - 'microphone' | 'system'
 * @param {string|null} input.fallbackStage - 実効デバイス段
 * @param {boolean} input.outputIsolated - 訳音出力を物理デバイスへ隔離済みか（setSinkId成功）
 * @param {boolean} input.realtimeSession - 同時通訳（Realtime翻訳）セッションか
 * @returns {Readonly<Object>} 凍結済みプロファイル
 */
function buildCaptureProfile({
    isElectron,
    audioSourceType,
    fallbackStage,
    outputIsolated,
    realtimeSession
}) {
    const profileId = deriveCaptureProfileId({ isElectron, audioSourceType, fallbackStage });
    const isolated = Boolean(outputIsolated);
    const realtime = Boolean(realtimeSession);

    /** @type {Record<string, Object>} 決定表本体（profileId → 行） */
    const rows = {
        [CAPTURE_PROFILE_IDS.ELECTRON_MIC]: {
            effectiveDevice: 'microphone',
            duplex: realtime ? 'full' : 'mic-protected',
            vadPreset: 'MICROPHONE',
            captionPolicy: 'stream-preview',
            preferContinuousCapture: false,
            ttsPolicy: 'play',
            noiseReduction: null,
            silenceFallbackNext: null
        },
        [CAPTURE_PROFILE_IDS.ELECTRON_VIRTUAL_CARD]: {
            effectiveDevice: 'virtual-card',
            duplex: 'full',
            // 感度のみマイクを借りる（AEC/NS/AGC は captureConstraintsFor で OFF のまま）
            vadPreset: 'MICROPHONE',
            captionPolicy: 'chat-authoritative',
            preferContinuousCapture: true,
            // 物理ヘッドホン等へ隔離済みなら再生し、未隔離時だけ回灌防止でミュート。
            ttsPolicy: isolated ? 'play' : 'suppress',
            // 仮想声卡はデジタル入力。マイク距離用の去噪は音声認識を劣化させ得るため無効。
            noiseReduction: null,
            silenceFallbackNext: 'loopback'
        },
        [CAPTURE_PROFILE_IDS.ELECTRON_LOOPBACK]: {
            effectiveDevice: 'loopback',
            duplex: 'full',
            vadPreset: 'SYSTEM',
            captionPolicy: 'stream-preview',
            preferContinuousCapture: false,
            ttsPolicy: 'suppress',
            noiseReduction: null,
            silenceFallbackNext: 'microphone'
        },
        [CAPTURE_PROFILE_IDS.ELECTRON_MIC_FALLBACK]: {
            effectiveDevice: 'microphone',
            duplex: realtime ? 'full' : 'mic-protected',
            vadPreset: 'MICROPHONE',
            captionPolicy: 'stream-preview',
            preferContinuousCapture: false,
            ttsPolicy: 'play',
            noiseReduction: null,
            silenceFallbackNext: null
        },
        [CAPTURE_PROFILE_IDS.BROWSER_MIC]: {
            effectiveDevice: 'microphone',
            duplex: realtime ? 'full' : 'mic-protected',
            vadPreset: 'MICROPHONE',
            captionPolicy: 'stream-preview',
            preferContinuousCapture: false,
            ttsPolicy: 'play',
            noiseReduction: null,
            silenceFallbackNext: null
        },
        [CAPTURE_PROFILE_IDS.BROWSER_TAB]: {
            effectiveDevice: 'tab',
            duplex: 'full',
            vadPreset: 'SYSTEM',
            captionPolicy: 'stream-preview',
            preferContinuousCapture: false,
            ttsPolicy: 'play',
            noiseReduction: null,
            silenceFallbackNext: null
        }
    };

    return Object.freeze({
        profileId,
        platform: isElectron ? 'electron' : 'browser',
        inputMode: audioSourceType === 'microphone' ? 'microphone' : 'monitor',
        outputIsolated: isolated,
        ...rows[profileId]
    });
}

/**
 * 半二重ゲート判定（このフレームの送信をスキップすべきか）。
 *
 * 本関数はプロファイルの duplex のみを参照する（判定軸はプロファイル構築時に
 * 決定表へ集約済み。呼出側での再判定・追加条件は禁止）。
 *
 * @param {Object|null} profile - buildCaptureProfile の戻り値
 * @param {Object} ctx
 * @param {boolean} ctx.isPlayingAudio - 翻訳音声(TTS)を再生中か
 * @param {number|null} ctx.outputEndTime - 直近の再生終了時刻（ms epoch）。null=再生実績なし
 * @param {number} ctx.bufferWindowMs - 再生終了後にスキップを続ける時間（エコー末尾対策）
 * @param {number} ctx.now - 現在時刻（ms epoch）
 * @returns {boolean} true = このフレームを送信しない
 */
function shouldSkipCapture(profile, { isPlayingAudio, outputEndTime, bufferWindowMs, now }) {
    // プロファイル未構築時は保守的にマイク保護と同じ挙動（従来既定）にフォールバック
    if (profile && profile.duplex === 'full') {
        // デジタル隔離済み経路 → 自分の訳音再生中も対方の発話を落とさない（全二重）
        return false;
    }
    if (isPlayingAudio) {
        return true;
    }
    // 物理マイク: 再生終了後もバッファウィンドウ内はスキップ（スピーカー→マイク伝播遅延）
    const timeSincePlaybackEnd = outputEndTime ? now - outputEndTime : Infinity;
    return timeSincePlaybackEnd < bufferWindowMs;
}

/**
 * 実効デバイス種別ごとの getUserMedia 音声制約（EC/NS/AGC）を返す（2行の決定表）。
 *
 *   - microphone → 全ON。翻訳音声が同一マシンのスピーカーから出るため、AEC 無しだと
 *     マイクが訳音を拾い直して認識が崩れる（同時通訳アプリの標準対策）。
 *   - それ以外（virtual-card / loopback / tab）→ 全OFF。デジタルのクリーン音源に
 *     マイク用の AEC/NS/AGC をかけると歪み・減衰で認識が劣化する（監視モードの認識強化）。
 *
 * sampleRate は決して設定しない（ネイティブレートで採集し、送信直前の resampleMicTo24k で
 * 一度だけ24kへ変換する。固定すると共有 AudioContext との間で二重リサンプルが起きる）。
 *
 * @param {'microphone'|'virtual-card'|'loopback'|'tab'} effectiveDevice 実効デバイス種別
 * @returns {{echoCancellation: boolean, noiseSuppression: boolean, autoGainControl: boolean}}
 */
function captureConstraintsFor(effectiveDevice) {
    const isMicrophone = effectiveDevice === 'microphone';
    return {
        echoCancellation: isMicrophone,
        noiseSuppression: isMicrophone,
        autoGainControl: isMicrophone
    };
}

/**
 * 採集の入口戦略を決める決定表（routeAudioCapture のディスパッチ根拠）。
 *
 * 行為コード(routeAudioCapture)にモード if を書かず、本関数の戻り値でハンドラを引く
 * （判定はこの決定表1箇所に集約）。
 *   - 'microphone':       マイク固定（フォールバック対象外）。
 *   - 'monitor-fallback': Electron のシステム監視（仮想カード→ループバック→マイクの自動段）。
 *   - 'monitor-display':  ブラウザのシステム監視（getDisplayMedia のタブ音声共有・段なし）。
 *
 * @param {Object} input
 * @param {boolean} input.isElectron - Electron 環境か
 * @param {string} input.audioSourceType - 'microphone' | 'system'
 * @returns {'microphone'|'monitor-fallback'|'monitor-display'}
 */
function captureEntryFor({ isElectron, audioSourceType }) {
    if (audioSourceType !== 'system') {
        return 'microphone';
    }
    return isElectron ? 'monitor-fallback' : 'monitor-display';
}

/**
 * 会議アプリのウィンドウ名判定パターン（監視ソースの優先選択で使用）。
 * ※ 下拉のアイコン表示(detectMeetingApps 側)は表示専用の別リスト(Slack を含まない)を
 *   使い続ける。ここへ寄せると cosmetic な表示が変わるため統合しない。
 * @type {RegExp}
 */
const MEETING_APP_PATTERN = /Teams|Zoom|Meet|Skype|Discord|Slack|Webex/i;

// エクスポート（ブラウザ: グローバル / Node(Jest): module.exports の両対応）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CAPTURE_PROFILE_IDS,
        deriveCaptureProfileId,
        buildCaptureProfile,
        shouldSkipCapture,
        captureConstraintsFor,
        captureEntryFor,
        MEETING_APP_PATTERN
    };
}
