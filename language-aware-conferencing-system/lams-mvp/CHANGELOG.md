# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- 開発規則ドキュメント（DEVELOPMENT_RULES.md）を追加
- プルリクエストテンプレートを追加
- Issueテンプレート（バグ報告・機能リクエスト）を追加
- CHANGELOG.md を追加

### Changed
- README.md に開発規則へのリンクを追加

## [0.1.0] - 2024-01-XX

### Added
- 初期リリース
- ユーザー認証機能（登録・ログイン）
- 会議室作成・参加機能
- WebSocket リアルタイム通信
- 音声モード切替（原声/翻訳）
- 字幕表示機能
- 会議記録機能
- 管理者機能（ユーザー管理・統計）
- AI処理パイプライン（ASR・翻訳・TTS）
- QoS監視・自動品質調整
- Docker環境構築
- 静的解析スクリプト（scripts/check.sh）

### Technical Stack
- Frontend: React 18 + TypeScript + Zustand + Vite
- Backend: FastAPI + SQLAlchemy 2.0 + Pydantic
- Database: PostgreSQL 16 + Redis 7
- AI: Gemini 2.5 Flash / OpenAI Realtime API
- Infrastructure: Docker + Nginx

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
## [1.0.0] - 2024-02-01

### Added
- 会議室ポリシー機能を追加（許可言語の制限）
- 音声品質の自動調整機能を追加

### Changed
- WebSocket再接続ロジックを改善（指数バックオフ）
- UI/UXを改善（ダークモード対応）

### Fixed
- 字幕の同期ずれを修正
- メモリリークを修正

### Security
- JWT トークンの有効期限を短縮（24時間 → 1時間）
- CORS設定を厳格化
```

---

[Unreleased]: https://github.com/your-org/lams/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/lams/releases/tag/v0.1.0

