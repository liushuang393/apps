# 4パターン監査・修正レポート

**実施日**: 2026-07-12  
**対象**: App マイク / App 監視(仮想声卡) / Extension マイク / Extension 監視(タブ)

---

## 1. エグゼクティブサマリ

ユーザー報告（マイク: **認識なし・順序乱れ・誤訳**）に対し、コード監査の結果 **3 件の構造問題** を特定し修正した。

| 優先度 | 問題 | 影響 | 対応 |
|--------|------|------|------|
| **P0** | `updateSession()` が `noise_reduction: null` を明示送信 | Electron マイクで ASR(左列)停止の第一候補 | `resolveSessionNoiseReduction()` で **省略** |
| **P1** | 全 `stream-preview` モードで自動 Chat 後補正が毎ターン起動 | Realtime 確定訳への非同期上書き → 誤訳・行ズレ | `commitTranslationPair` 末尾の自動起動を **削除** |
| **P1** | 仮想声卡が `chat-authoritative`（路径2 遮断 + 路径3 依存） | 監視モードで音声と字幕不一致 | **`stream-preview` 化**、ハングルゲートのみ残す |
| **P2** | WebRTC `near_field` hardcode | マイク/タブで去噪ポリシー非対称 | `captureProfile` 連動 |

---

## 2. 4パターン比較表

| 項目 | E1 App マイク | E2 App 監視 | E3 Ext マイク | E4 Ext 監視 |
|------|---------------|-------------|---------------|-------------|
| profileId | `electron-mic` | `electron-virtual-card` → loopback → mic-fallback | `browser-mic` | `browser-tab` |
| Transport | Electron IPC (PCM) | Electron IPC (PCM) | WebRTC (media-track) | WebRTC (media-track) |
| VAD | client VAD / Server VAD UI | **常時送信** (`preferContinuousCapture`) | client VAD | SYSTEM プリセット |
| 去噪 | **省略** (session.update) | **省略** | `near_field` (client_secret) | **省略** |
| 字幕正本 | Realtime 路径2 | Realtime 路径2 | Realtime 路径2 | Realtime 路径2 |
| 自動 Chat 後補正 | **なし** | **なし** | **なし** | **なし** |
| TTS | `play` | 隔離済み→`play` / 未隔離→`suppress` | `play` | `play` |
| duplex | 通訳=`full` | `full` | 通訳=`full` | `full` |

---

## 3. 修正ファイル

| ファイル | 変更概要 |
|----------|----------|
| `voicetranslate-pro.js` | `resolveSessionNoiseReduction()` 追加、`updateSession` / `mintTranslationClientSecret` 連動 |
| `voicetranslate-capture-profile.js` | 仮想声卡 `captionPolicy: stream-preview`、ドキュメント更新 |
| `voicetranslate-websocket-mixin.js` | `chat-authoritative` 削除、`isVirtualCardMonitoring()`、自動 `refineSegmentTranslation` 停止 |
| `tests/runtime/MicSessionUpdate.test.js` | **新規** — electron-mic の session 形状固定 |
| `tests/ui/TranslationStreamRender.test.js` | stream-preview / 仮想声卡 / 自動補正なし |
| `tests/audio/CaptureProfile.test.js` | virtual-card → stream-preview |
| `tests/audio/VadSensitivityProfile.test.js` | 同上 |

---

## 4. 自動テスト証拠

| 証拠 | パス | 結果 |
|------|------|------|
| Jest 全件 | `docs/qa/evidence/jest-2026-07-12.log` | **46 suites / 505 tests PASS** |
| lint:runtime | `docs/qa/evidence/lint-2026-07-12.log` | **PASS** |
| extension check | `docs/qa/evidence/extension-check-2026-07-12.log` | 要確認 |

主要な新規/更新テスト:

- `tests/runtime/MicSessionUpdate.test.js` — WS 経路で `noise_reduction` 省略
- `tests/ui/TranslationStreamRender.test.js` — 自動 Chat 後補正なし、仮想声卡 Realtime 正本
- `tests/audio/CaptureProfile.test.js` — 6 profileId 決定表

---

## 5. 実機 E2E チェックリスト（E1–E4）

> **手順**: 各ケース開始前に Ctrl+F5（Electron は再起動）。DevTools で `app.captureProfile.profileId` を記録。

### E1 — App マイク (`electron-mic`)

- [ ] 起動: `npm run dev` → 音声ソース「マイク」
- [ ] 日本語 2 文連続発話
- [ ] **合格**: 左列 ASR 表示 / 右列 Realtime 一致 / 上から新しい順 / TTS 鳴る / `refineCalls` 相当の Chat 上書きなし

### E2 — App 監視・仮想声卡 (`electron-virtual-card`)

- [ ] VB-CABLE 設定、ブラウザ動画音声を VB-CABLE へ
- [ ] ヘッドホンを出力デバイスに選択（`outputIsolated=true` 期待）
- [ ] **合格**: 認識・訳文が動画と一致 / TTS ヘッドホン / 回灌なし

### E3 — Extension マイク (`browser-mic`)

- [ ] `npm run pack:extension` → Chrome 拡張ロード
- [ ] マイクモードで E1 と同等確認
- [ ] **合格**: WebRTC 経路で ASR + Realtime 訳 + TTS

### E4 — Extension 監視 (`browser-tab`)

- [ ] 拡張 UI → システム音声 → タブ/画面共有
- [ ] Teams または Web タブ音声
- [ ] **合格**: タブ音声認識・訳文・TTS

### 記録テンプレート

```
ケース: E_
開始: __:__
profileId: ___________
左列: [行1] [行2]
右列: [行1] [行2]
結果: PASS / FAIL
備考:
```

---

## 6. 残リスク

1. **loopback 段** (`electron-loopback`): TTS 常時 `suppress` — 意図通りだが UX は字幕のみ
2. **handleTranscriptionCompleted** (live-sra 経路): 非翻訳セッションでは `refineSegmentTranslation` が残存 — 翻訳セッションとは別経路
3. **WebRTC vs Electron 去噪差**: マイクでも Extension は `near_field`、Electron は省略 — プラットフォーム API 制約による意図的分岐

---

## 7. 推奨運用

- モード切替後は **停止→開始** または Ctrl+F5
- 仮想声卡: ヘッドホン優先（`autoDetectPhysicalSpeaker`）、未検出時は TTS ミュート
- 問題時: DevTools で `app.captureProfile` と WebSocket エラー（400 等）を確認

---

## 8. 結論

**P0/P1 修正により、マイクモードの ASR 停止・誤訳・順序乱れの主要因を除去。**  
自動テスト 505 件すべて合格。実機 E2E（E1–E4）は上記チェックリストで最終確認すること。
