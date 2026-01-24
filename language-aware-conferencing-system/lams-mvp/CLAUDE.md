# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

LAMS（Language-Aware Meeting System）は、多言語会議向けのリアルタイム音声翻訳・字幕システム。参加者は「原声」か「翻訳音声」を自由に選択でき、聴いている音声と同じ言語の字幕が表示される。

- **対応言語**: 日本語 (ja), 英語 (en), 中国語 (zh), ベトナム語 (vi)
- **遅延目標**: ≤1200ms（超過時は字幕のみにフォールバック）
- **AIプロバイダー**: Gemini 2.5 Flash（推奨）, OpenAI Realtime

## 開発コマンド

### 静的解析・リント（コミット前必須）

```bash
./scripts/check.sh           # 全チェック
./scripts/check.sh --fix     # 自動修正付き
./scripts/check.sh --backend # バックエンドのみ
./scripts/check.sh --frontend # フロントエンドのみ
```

### バックエンド（Python/FastAPI）

```bash
cd backend
pip install .                                    # 依存関係インストール
uvicorn app.main:app --reload --port 8000        # 開発サーバー起動
alembic upgrade head                             # マイグレーション適用
alembic revision --autogenerate -m "説明"        # マイグレーション作成
pytest                                           # テスト実行
ruff check app/ --fix && ruff format app/        # リント+フォーマット
```

### フロントエンド（React/TypeScript）

```bash
cd frontend
npm install                  # 依存関係インストール
npm run dev                  # 開発サーバー起動（port 5173）
npm run build                # プロダクションビルド
npm run lint                 # ESLint
npm run type-check           # TypeScript型チェック
```

### Docker

```bash
docker compose up --build                              # 全サービス起動
docker compose up postgres redis -d                    # DB/Cache のみ起動
HOST_IP=192.168.x.x docker compose up -d --build       # LAN公開用
docker compose exec backend alembic upgrade head       # コンテナ内でマイグレーション
```

## アーキテクチャ

```
frontend/           React 18 + TypeScript + Zustand + Vite
  src/
    components/     UI: AudioControlPanel, PreferencePanel, SubtitleDisplay
    hooks/          useWebSocket, useAudioCapture, useAudioDevices
    pages/          ページコンポーネント（9ファイル）
    store/          authStore, roomStore（Zustand）

backend/            FastAPI + SQLAlchemy 2.0 + Redis
  app/
    auth/           JWT認証、RBAC（admin/moderator/user）
    rooms/          会議室CRUD、Redis状態管理
    admin/          ユーザー管理、統計API
    ai_pipeline/    AIプロバイダー抽象化、QoS監視
    websocket/      リアルタイム通信（handler.py）
    db/             SQLAlchemy モデル（User, Room, Subtitle）
  alembic/          DBマイグレーション
```

### 主要APIエンドポイント

| パス | 説明 |
|------|------|
| `POST /api/auth/register`, `/login` | 認証 |
| `GET/POST /api/rooms` | 会議室一覧・作成 |
| `GET /api/rooms/{id}/transcript` | 会議記録取得 |
| `GET/PATCH /api/admin/users/{id}` | ユーザー管理（要admin） |
| `WS /ws/room/{room_id}?token={jwt}` | リアルタイム接続 |

## コーディング規則

### 共通

- **ファイルサイズ**: 500行推奨、1000行絶対上限
- **コメント**: 日本語で記載、関数は目的・入出力・注意点を記載
- **禁止**: `console.log`/`print`、マジックナンバー、秘密情報のハードコード

### TypeScript

- `strict: true`、`any`禁止（`unknown`使用）
- Propsは`interface`で定義
- 関数コンポーネント + カスタムフックでロジック分離

### Python

- 型ヒント必須（引数・戻り値）
- Pydanticでバリデーション
- `logging`モジュール使用（`print`禁止）
- Ruff: `E`, `W`, `F`, `I`, `B`, `C4`, `UP`, `ARG`, `SIM`

## Git運用

- **ブランチ**: `feature/`, `bugfix/`, `hotfix/`, `refactor/`, `docs/`
- **コミット**: Conventional Commits形式（`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`）
- **コミット前**: `./scripts/check.sh` でエラー0を確認

## 環境変数（.env）

```bash
DATABASE_URL=postgresql://lams:lams_secret_2024@localhost:5432/lams
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=your-secret-key
AI_PROVIDER=gemini                    # gemini または openai_realtime
GEMINI_API_KEY=your-key
HOST_IP=192.168.x.x                   # LAN公開時のみ
```

## アクセスURL

| サービス | URL |
|---------|-----|
| フロントエンド | http://localhost:5173 |
| バックエンドAPI | http://localhost:8000 |
| APIドキュメント | http://localhost:8000/docs |
