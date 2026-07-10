# VAD 最適化 - 現行実装の仕様

> ⚠️ **旧版に関する注意（2026-07 改訂）**
> 本書の旧版は `getTurnDetectionConfig()` / `updateSessionConfig()` による
> `turn_detection`（threshold 0.3/0.5/0.7、prefix_padding_ms: 300、silence_duration_ms: 1500）の
> 調整方法を説明していたが、**この仕組みは廃止済み**。
> 現在の翻訳エンドポイント（`/v1/realtime/translations`）は `session.update` での
> `turn_detection` 指定を受け付けず、`getTurnDetectionConfig()` はコードに存在しない
> （`updateSessionConfig()` は互換のための no-op、`voicetranslate-pro.js` 参照）。
> 旧版の手順で「VADを調整」しても動作には一切影響しない。

## 現行アーキテクチャの全体像

発話の区切り検出は次の3層で行われ、**どの層が効くかは設定と環境で決まる**。

| 層 | 実体 | 効く条件 |
|---|---|---|
| サーバー側ターン検出 | OpenAI translations エンドポイント（semantic_vad） | 既定。「自動音声検出」トグルON（既定ON）で全フレームをストリーム送信し、区切りはサーバーに委ねる |
| クライアントVAD | `VoiceActivityDetector`（`voicetranslate-utils.js`） | 「自動音声検出」トグルを**OFF**にした場合のみ |
| 文グルーピング | `CONFIG.TRANSLATION`（`voicetranslate-utils.js`） | テキスト翻訳（Path2）の送信単位を決める |

さらにブラウザ/拡張機能のマイクモードは WebRTC メディアトラック送信のため、
クライアント側の VAD・リサンプル・PCM送信チェーンは**送信に関与しない**
（クライアントVAD が実際に送信を制御するのは Electron の PCM 送信経路のみ）。

## 1. サーバーVAD（既定・推奨）

- 「自動音声検出」トグル（`vadEnabled`、既定ON）が有効な間、音声は無加工で連続送信され、
  ターン検出はサーバー側で行われる。クライアントの VAD 感度設定は**この経路には影響しない**。
- ブラウザ/拡張の WebRTC 経路では `noise_reduction: { type: 'near_field' }` を
  client_secret 発行時に指定（`voicetranslate-pro.js` の `mintTranslationClientSecret`）。

## 2. クライアントVAD（トグルOFF時のみ）

実体: `VoiceActivityDetector`（`voicetranslate-utils.js`）

- RMS エネルギー + 直近10フレームの移動平均
- 起動後30フレームでノイズフロア（平均+標準偏差）を較正し、実効しきい値 = `max(threshold, noiseFloor×2)`
- 感度プリセット（`CONFIG.VAD`、`voicetranslate-utils.js`）:

| プリセット | マイク threshold / debounce | システム threshold / debounce |
|---|---|---|
| LOW | 0.008 / 600ms | 0.015 / 700ms |
| MEDIUM（既定） | 0.004 / 500ms | 0.01 / 600ms |
| HIGH | 0.002 / 300ms | 0.006 / 400ms |

- どちらの列を使うかは capture-profile 決定表の `vadPreset`
  （`voicetranslate-capture-profile.js`）が決める。UI選択値からの再判定は禁止。

### 短句保護・取りこぼし防止（クライアントVAD経路）

| 定数 | 値 | 場所 | 役割 |
|---|---|---|---|
| `minSpeechDuration` | 300ms | `voicetranslate-pro.js` | これ未満の発話は silence-confirm 後に再判定（短い単語の保護） |
| `silenceConfirmDelay` | 200ms | `voicetranslate-pro.js` | 無音確定までの猶予 |
| `MIN_QUEUE_DURATION` | 500ms | `voicetranslate-websocket-mixin.js` | これ未満のセグメントは破棄せず次セグメントと結合 |
| `REALTIME_MIN_COMMIT_AUDIO_MS` | 100ms | `voicetranslate-websocket-mixin.js` | これ未満は commit せず clear（サーバーの buffer too small エラー回避） |

録音開始から**全フレームを連続バッファリング**するため、VAD 立ち上がり遅延による
語頭切れは発生しない設計（コミット時にバッファ全体を連結）。

## 3. 文グルーピング（テキスト翻訳の送信単位）

`CONFIG.TRANSLATION`（`voicetranslate-utils.js`）:

- `TURN_MODE: 'grouped'` / `VAD_TYPE: 'semantic_vad'` / `SEMANTIC_EAGERNESS: 'medium'`
- `MIN_COMPLETE_SENTENCES: 1`、`MAX_SENTENCES: 1`（1文ずつ即時翻訳）
- `POST_SENTENCE_HOLD_MS: 150`（文完結後の追加発話待ち）
- `MAX_BUFFER_MS: 2500`(無限待機防止の上限)

Electron では `.env` の `TRANSLATION_*` で上書き可能。ブラウザ/拡張はこの既定値が効く。

## テスト方法

- 決定表・送信ゲートの単体テスト: `npx jest tests/audio/CaptureProfile.test.js tests/audio/SendAudioDataDuplexGate.test.js`
- 手動確認: 「自動音声検出」をOFFにして VAD 感度 Low/Medium/High を切り替え、
  短い単語（「はい」等）が取りこぼされないこと、無音でセグメントが送信されないことを確認。
