# Changelog

このファイルには Sonowa の主な変更を記録する。

形式は [Keep a Changelog](https://keepachangelog.com/ja/1.0.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従う。

> 現時点でタグ付きリリースは存在しない。最初の正式リリースまでの変更はすべて
> `[Unreleased]` に記録する。

## [Unreleased]

### Added

- 用語集（Glossary）管理と、翻訳パイプラインへの前後処理としての適用
- 議事録の自動生成（GPT 優先・Gemini フォールバック）
- 離線重跑（記録済みパイプライン事件の高品質再処理と訓練訂正候補の生成）
- A/B テスト用の実験メトリクス収集
- 学習データ収集（ASR / 翻訳の訂正履歴、話者登録、TTS 同意、評価サンプル）
- 管理画面での AI パイプライン設定（方式1 `realtime_s2s` / 方式2 `quality_cascade`）
- ローカル GPU 実行オプション（faster-whisper / MADLAD-400 / VoxCPM2、8GB GPU 対応）
- partial（暫定）字幕と LLM による翻訳補正
- E2E テスト基盤（Playwright・A レーン / B レーン）
- Apache License 2.0 の明記と謝辞セクション

### Changed

- トランスポートを WebRTC（LiveKit）へ一本化
- 既定の AI プロバイダーを `gpt_realtime` に統一（`gpt4o_transcribe` は方式2の基準実装
  かつ全経路のフォールバック先として維持）
- ローカルスタックを OPUS-MT / Kokoro から MADLAD-400 / VoxCPM2 へ置き換え
  （各段 1 モデルで ja/en/zh/vi を処理）

### Removed

- WebSocket ベースのリアルタイム通信（`backend/app/websocket/handler.py`、
  `frontend/src/hooks/useWebSocket.ts`）— LiveKit へ移行済み

## 初期実装

- ユーザー認証（登録・ログイン・パスワード再設定）
- 会議室の作成・参加
- 音声モード切替（原声 / 翻訳音声）と字幕表示
- 会議記録
- 管理者機能（ユーザー管理・統計・言語設定）
- AI 処理パイプライン（ASR・翻訳・TTS）と QoS 監視
- Docker 環境、静的解析スクリプト（`scripts/check.sh`）

---

## 変更履歴の記載ルール

### カテゴリ

- `Added`: 新機能
- `Changed`: 既存機能の変更
- `Deprecated`: 非推奨化された機能
- `Removed`: 削除された機能
- `Fixed`: バグ修正
- `Security`: セキュリティ関連の変更

### 記載例

```markdown
## [1.0.0] - 2026-02-01

### Added
- 会議室ポリシー機能を追加（許可言語の制限）

### Fixed
- 字幕の同期ずれを修正

### Security
- JWT トークンの有効期限を短縮（24時間 → 1時間）
```
