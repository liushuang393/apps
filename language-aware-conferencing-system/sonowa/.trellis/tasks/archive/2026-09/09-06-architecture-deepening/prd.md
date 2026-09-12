# PRD: Architecture deepening

## Goal

アーキテクチャレビューで確定した deepening を、承認済みチケット粒度（1–10）で実装する。字幕・翻訳音声・読む主線・参加者設定の locality / leverage を上げ、二重 seam を解消する。

## Acceptance criteria

1. 配信は `TransportAdapter`（`publish_audio` / `send_data`）一本。composition root の配線が orchestrator / processor で同一。
2. 旧 `OutputSink.deliver_*` 経由の本番経路が無い。`OutputSinkTransportAdapter` は不要なら削除、またはテスト用に限定。
3. 読む主線 MT が HTTP routes 外の TextTranslationEngine（名称は実装で確定）に集約され、REST と reading が同一 interface。
4. 用語 QoS 記録が ContextVar 非依存でも明示引数で動く。
5. フロント字幕 ingress が `decodeLiveEvent` を使う。hook 内の浅い parse を削除。
6. 参加者設定変更が store + LiveKit attributes を単一書き込みで同期する。
7. orchestrator の未使用 `_subtitle_message` / `_deliver_*_group` を削除し、テストは生きている経路を見る。
8. 発話収束（fork / barge-in）が UtteranceConvergence（名称は実装で確定）に切り出され、既存挙動を回帰テストで維持。
9. `./scripts/check.sh`（または backend pytest + frontend type-check）が緑。

## Actors

- 会議参加者（字幕・翻訳音声・設定）
- 管理者（観測・QoS）
- メンテナ / AI agent（変更の locality）

## Out of scope

- ASR pass-through stage 削除のみ
- AudioControlPanel 削除のみ
- issue tracker（docs/agents）セットアップ
- 親 monorepo（softroad 等）の変更
