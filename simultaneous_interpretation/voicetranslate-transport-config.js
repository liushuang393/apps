/**
 * トランスポート決定表モジュール（会話の実現方式を1箇所に集約）
 *
 * 目的:
 *   「どの実行環境 × どのセッション種別か」で決まるリアルタイム transport の種類判定と、
 *   翻訳セッション設定(session.update / client_secret)の構築を本ファイルに集約する。
 *
 * 背景（判定散在の根本原因）:
 *   従来は sendMessage / isRealtimeTransportReady / usesWebRtcTransport 等が
 *   platform.isElectron を個別に参照して transport を分岐しており、判定が散在していた。
 *   また session 設定(noise_reduction 等)が createSession / mintTranslationClientSecret で
 *   別々に構築され、WebRTC 経路にしか noise_reduction が入らない不整合があった。
 *
 * 設計原則:
 *   - DOM/アプリ状態に依存しない純関数のみ（Jest で決定表をそのまま検証できる）。
 *   - transport 種類はセッション種別(isRealtimeTranslationSession)から派生させ、置き換えない
 *     （セッション種別は append 命名・grouped skip 等も駆動する別軸のため）。
 */

/**
 * transport 種類の定数（実在する3経路）
 * @type {Readonly<Record<string, string>>}
 */
const TRANSPORT_KINDS = Object.freeze({
    ELECTRON_IPC: 'electron-ipc',
    BROWSER_WEBRTC: 'browser-webrtc',
    BROWSER_WS: 'browser-ws'
});

/**
 * transport 種類を導出する（決定表）。
 *
 *   - Electron: main プロセス経由の IPC（Authorization ヘッダで接続）。
 *   - 非Electron × 翻訳セッション: WebRTC + 短命 client secret
 *     （ブラウザは翻訳EPへ APIキー直 WebSocket 不可のため公式に WebRTC 必須）。
 *   - 非Electron × 非翻訳セッション: ブラウザ WebSocket。
 *
 * @param {Object} input
 * @param {boolean} input.isElectron - Electron 環境か
 * @param {boolean} input.isTranslationSession - /realtime/translations セッションか
 * @returns {string} TRANSPORT_KINDS のいずれか
 */
function selectTransportKind({ isElectron, isTranslationSession }) {
    if (isElectron) {
        return TRANSPORT_KINDS.ELECTRON_IPC;
    }
    if (isTranslationSession) {
        return TRANSPORT_KINDS.BROWSER_WEBRTC;
    }
    return TRANSPORT_KINDS.BROWSER_WS;
}

/**
 * 翻訳セッション設定(session オブジェクトの内側)を構築する。
 *
 * WS/Electron は { type:'session.update', session: <本戻り値> } として送り、
 * WebRTC は client_secret 発行 body の { session: { model, ...<本戻り値> } } に展開する。
 * noise_reduction は呼び出し側が渡したときのみ含める（判定はここに持たせない）:
 *   - WebRTC(client_secret)経路は従来どおり near_field を渡す（発行 body では実績あり）。
 *   - null は既存の去噪を明示的に無効化するため送信する。
 *   - undefined（引数省略）の場合だけフィールド自体を省略する。
 *
 * @param {Object} input
 * @param {string} input.targetLang - 出力言語（例 'ja'）
 * @param {Object} input.transcription - 入力転写設定（例 { model }）
 * @param {?{type:string}} [input.noiseReduction] - 去噪設定（渡したときのみ session に含める）
 * @returns {Readonly<Object>} 凍結済み session 設定本体
 */
function buildTranslationSessionConfig({ targetLang, transcription, noiseReduction }) {
    const input = { transcription };
    if (noiseReduction !== undefined) {
        input.noise_reduction = noiseReduction;
    }
    return Object.freeze({
        audio: {
            input,
            output: { language: targetLang || 'ja' }
        }
    });
}

/**
 * transport 種別ごとの能力記述子（capability descriptor）を構築する。
 *
 * 目的:
 *   行為コード（sendMessage / isRealtimeTransportReady / 送信ガード / 再生ガード /
 *   優雅クローズガード / マイク接続）が isElectron・usesWebRtcTransport を各所で再導出せず、
 *   ここが返すデータ項目を読むだけにする（「この階層では if 判定を書かない」＝散在分岐の排除）。
 *   セッション開始時に1度だけ選び app 生命に渡ってキャッシュする（純データのため再購読等の副作用は無い）。
 *
 * @param {Object} input
 * @param {boolean} input.isElectron - Electron 環境か
 * @param {boolean} input.isTranslationSession - /realtime/translations セッションか
 * @returns {Readonly<{kind:string, audioInput:('pcm-event'|'media-track'), playsRemoteAudioTrack:boolean, supportsGracefulClose:boolean}>}
 *   - kind: TRANSPORT_KINDS のいずれか
 *   - audioInput: 'media-track'(WebRTC はマイク音声をトラック送信・PCM append しない) / 'pcm-event'(WS・IPC)
 *   - playsRemoteAudioTrack: true(WebRTC は翻訳音声をリモートトラックで再生・PCM 再生すると二重) / false
 *   - supportsGracefulClose: true(WS ベース翻訳セッションのみ session.close→session.closed 手順) / false(WebRTC・非翻訳)
 */
function buildTransportDescriptor({ isElectron, isTranslationSession }) {
    const kind = selectTransportKind({ isElectron, isTranslationSession });
    const isWebRtc = kind === TRANSPORT_KINDS.BROWSER_WEBRTC;
    return Object.freeze({
        kind,
        audioInput: isWebRtc ? 'media-track' : 'pcm-event',
        playsRemoteAudioTrack: isWebRtc,
        supportsGracefulClose: isTranslationSession && !isWebRtc
    });
}

// エクスポート（ブラウザ: グローバル / Node(Jest): module.exports の両対応）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TRANSPORT_KINDS,
        selectTransportKind,
        buildTranslationSessionConfig,
        buildTransportDescriptor
    };
}
