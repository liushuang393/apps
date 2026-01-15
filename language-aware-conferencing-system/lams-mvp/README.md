
# LAMS - 言語感知型会議システム

<p align="center">
  <strong>Language-Aware Meeting System</strong><br>
  社内多言語コミュニケーションを革新する会議システム
</p>

---

## 🎯 概要

LAMSは**翻訳ツールではありません**。社内の多言語会議における認知負荷を軽減し、言語の壁を意識させないコミュニケーション体験を提供するシステムです。

### ✨ 主な特長

| 特長 | 説明 |
|------|------|
| **ユーザー主導の体験** | 各参加者が「原声」か「翻訳音声」を自由に選択 |
| **認知負荷ゼロ設計** | デフォルトは原声モード。翻訳による違和感なし |
| **字幕と音声の一致** | 聴いている音声と同じ言語の字幕のみ表示 |
| **低遅延保証** | 1200ms以下の遅延目標、超過時は自動で字幕フォールバック |
| **プライバシー重視** | 社内利用に特化、外部流出リスクを最小化 |

### 🌍 対応言語

- 🇯🇵 日本語 (ja)
- 🇺🇸 英語 (en)
- 🇨🇳 中国語 (zh)
- 🇻🇳 ベトナム語 (vi)

---

## 📋 機能一覧

### コア機能

```
┌─────────────────────────────────────────────────────────┐
│                    会議室機能                            │
├─────────────────────────────────────────────────────────┤
│ ✅ 会議室の作成・参加・退出                              │
│ ✅ WebRTC ベースのリアルタイム音声通信                   │
│ ✅ 参加者一覧表示                                        │
│ ✅ アクティブスピーカー検出                              │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  個人設定機能                            │
├─────────────────────────────────────────────────────────┤
│ ✅ 音声モード切替（原声 / 翻訳）                         │
│ ✅ 字幕表示ON/OFF                                        │
│ ✅ 翻訳先言語の選択                                      │
│ ✅ 設定のリアルタイム反映                                │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                会議ポリシー機能                          │
├─────────────────────────────────────────────────────────┤
│ ✅ 許可言語の制限                                        │
│ ✅ デフォルト音声モードの設定                            │
│ ✅ モード切替の許可/禁止                                 │
└─────────────────────────────────────────────────────────┘
```

### AI処理機能

| 機能 | 説明 |
|------|------|
| 音声認識 (ASR) | リアルタイム音声→テキスト変換 |
| テキスト翻訳 | 4言語間の高精度翻訳 |
| 音声合成 (TTS) | 翻訳テキスト→音声変換（オプション） |
| QoS監視 | 遅延・ジッター監視と自動品質調整 |

---

## 🚀 使用手順

### 1. ユーザー登録・ログイン

```
1. アプリにアクセス
2. メールアドレス、表示名、母語を入力して登録
3. ログイン後、会議室一覧画面へ
```

### 2. 会議への参加

```
1. 会議室一覧から参加したい会議を選択
2. または「新規作成」で会議室を作成
3. 自動的に音声接続が開始
```

### 3. 個人設定の変更

```
┌─────────────────────────────────┐
│ 🎧 音声設定                     │
│ ┌───────────┬───────────┐      │
│ │  原声     │  翻訳     │      │
│ └───────────┴───────────┘      │
│                                 │
│ 📝 字幕: [ON] / OFF             │
│                                 │
│ 🌐 翻訳先: [日本語 ▼]           │
└─────────────────────────────────┘
```

**設定の効果:**

| 設定 | 聴こえる音声 | 表示される字幕 |
|------|-------------|---------------|
| 原声 + 字幕ON | 話者の原音声 | 話者の言語の字幕 |
| 翻訳 + 字幕ON | 翻訳された音声 | 翻訳された字幕 |
| 原声 + 字幕OFF | 話者の原音声 | なし |
| 翻訳 + 字幕OFF | 翻訳された音声 | なし |

---

## 🔧 開発者向けドキュメント

### システムアーキテクチャ

```
┌────────────────────────────────────────────────────────────────┐
│                        クライアント層                          │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  React + TypeScript + Zustand                            │ │
│  │  ・PreferencePanel: 個人設定UI                           │ │
│  │  ・SubtitleDisplay: 字幕表示                             │ │
│  │  ・useWebSocket: リアルタイム通信                        │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket / REST API
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                        APIゲートウェイ                         │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Nginx (リバースプロキシ)                                │ │
│  │  ・静的ファイル配信                                      │ │
│  │  ・WebSocket プロキシ                                    │ │
│  │  ・ロードバランシング                                    │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                      アプリケーション層                        │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  FastAPI (Python 非同期フレームワーク)                   │ │
│  │  ┌────────────┬────────────┬────────────┬─────────────┐ │ │
│  │  │   Auth     │   Rooms    │ WebSocket  │ AI Pipeline │ │ │
│  │  │  認証処理   │  会議室管理 │ リアルタイム│  翻訳処理   │ │ │
│  │  └────────────┴────────────┴────────────┴─────────────┘ │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────────┐
│    PostgreSQL    │ │    Redis     │ │    AI Provider       │
│  ・ユーザー情報   │ │ ・セッション  │ │ ・Gemini 2.5 Flash   │
│  ・会議室情報     │ │ ・参加者状態  │ │ ・OpenAI Realtime    │
│  ・永続化データ   │ │ ・翻訳キャッシュ│ │ ・ASR/翻訳/TTS       │
└──────────────────┘ └──────────────┘ └──────────────────────┘
```

### 技術スタック詳細

#### フロントエンド

| 技術 | 役割 | 選定理由 |
|------|------|----------|
| **React 18** | UIフレームワーク | コンポーネント指向、豊富なエコシステム |
| **TypeScript** | 型安全性 | 静的型付けによるバグ防止、IDE支援 |
| **Zustand** | 状態管理 | 軽量、シンプルAPI、React 18対応 |
| **Vite** | ビルドツール | 高速HMR、ESM native |
| **React Router** | ルーティング | SPA標準、宣言的ルート定義 |

#### バックエンド

| 技術 | 役割 | 選定理由 |
|------|------|----------|
| **FastAPI** | Webフレームワーク | 非同期対応、自動APIドキュメント、型ヒント |
| **SQLAlchemy 2.0** | ORM | 非同期対応、型安全、マイグレーション |
| **Pydantic** | バリデーション | 高速、型ベース、Settings管理 |
| **python-jose** | JWT認証 | 標準的なトークン認証 |
| **asyncio** | 非同期処理 | I/O待機時間の最適化 |

#### インフラストラクチャ

| 技術 | 役割 | 選定理由 |
|------|------|----------|
| **PostgreSQL** | メインDB | 信頼性、JSON対応、スケーラビリティ |
| **Redis** | キャッシュ/状態管理 | 低遅延、Pub/Sub対応、セッション管理 |
| **Nginx** | リバースプロキシ | WebSocket対応、高性能、設定柔軟性 |
| **Docker** | コンテナ化 | 環境統一、デプロイ容易性 |

#### AIプロバイダー

| プロバイダー | 特徴 | ユースケース |
|-------------|------|-------------|
| **Gemini 2.5 Flash** | Native Audio対応、低遅延 | 推奨（デフォルト） |
| **OpenAI Realtime** | Whisper + GPT-4、高精度 | 精度重視の場合 |

---

### ローカル環境構築

#### 必要要件

```bash
# 必須
- Docker & Docker Compose
- Node.js 20+
- Python 3.10+

# オプション（ローカル開発用）
- PostgreSQL 16+
- Redis 7+
```

#### 環境変数設定

```bash
# .env ファイルを作成
cp .env.example .env

# 必須項目を編集
DATABASE_URL=postgresql://lams:lams_secret_2024@localhost:5432/lams
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=your-secret-key-change-in-production

# AIプロバイダー設定（いずれか一方）
AI_PROVIDER=gemini                    # または openai_realtime
GEMINI_API_KEY=your-gemini-api-key
# OPENAI_API_KEY=your-openai-api-key
```

####起動方式１ Docker での起動（推奨）

```bash
# プロジェクトディレクトリに移動
cd lams-mvp

# コンテナをビルド・起動
docker compose up --build


# バックグラウンド実行
docker compose up -d --build
# 局域网访问
HOST_IP=192.168.210.2 docker-compose up -d --build frontend backend

# ログ確認
docker compose logs -f backend
```

#### ローカル開発環境

前提：Condaのインストールが必要です。

```bash
# 1. Conda環境を作成（初回のみ）
conda create -n aienv python=3.10 -y
conda activate aienv

# 2. PostgreSQL と Redis を起動
cd lams-mvp
docker compose up postgres redis -d
docker compose ps  # 起動確認

# 3. バックエンド起動
cd backend
pip install .  # Python依存ライブラリをインストール
uvicorn app.main:app --reload --port 8000

# 4. フロントエンド（別ターミナル）
cd lams-mvp/frontend
npm install
npm run dev
または
npm run dev -- --host 0.0.0.0
```

### アクセスURL

| サービス | URL | 説明 |
|---------|-----|------|
| フロントエンド | http://localhost:5173 開発サーバー |
| バックエンドAPI | http://localhost:8000 | FastAPI |
| API ドキュメント | http://localhost:8000/docs | Swagger UI |
| 本番（Docker） | http://localhost | Nginx経由 |

---

### 📦 データベースマイグレーション

本プロジェクトは **Alembic** を使用してDBスキーマを管理しています。

#### マイグレーション適用

```bash
# 開発環境（Docker内で実行）
docker compose exec backend alembic upgrade head

# 本番環境（環境変数でDB接続先を指定）
DATABASE_URL=postgresql://user:pass@host:5432/dbname alembic upgrade head
```

#### マイグレーション作成（モデル変更後）

```bash
# モデル（backend/app/db/models.py）を変更後
docker compose exec backend alembic revision --autogenerate -m "変更内容の説明"

# 生成されたファイルを確認・編集
# backend/alembic/versions/xxxx_変更内容の説明.py
```

#### ロールバック

```bash
# 1つ前のバージョンに戻す
docker compose exec backend alembic downgrade -1

# 特定バージョンに戻す
docker compose exec backend alembic downgrade <revision_id>
```

#### 状態確認

```bash
# 現在のバージョン確認
docker compose exec backend alembic current

# マイグレーション履歴
docker compose exec backend alembic history
```

---
スクリプトを作成し、全ての静的解析エラーを修正しました。

### 📁 作成したファイル
ファイル	用途
scripts/check.sh	統合チェックスクリプト

📊 チェック項目
カテゴリ	ツール	内容
Backend	ruff check	Lint（E/W/F/I/B/C4等）
ruff format	フォーマット（Black互換）
py_compile	Python構文チェック
Frontend	ESLint	Lint + React Hooks ルール
tsc --noEmit	TypeScript型チェック

🎯 使い方
cd lams-mvp

# 全チェック（エラー表示のみ）
./scripts/check.sh

# 全チェック + 自動修正
./scripts/check.sh --fix

# フォーマットのみ
./scripts/check.sh --format

# バックエンドのみ
./scripts/check.sh --backend

# フロントエンドのみ
./scripts/check.sh --frontend

# ヘルプ
./scripts/check.sh --help

### ディレクトリ構成

```
lams-mvp/
├── backend/
│   ├── app/
│   │   ├── auth/           # 認証モジュール
│   │   │   ├── dependencies.py  # FastAPI依存性注入
│   │   │   ├── jwt_handler.py   # JWTトークン処理
│   │   │   └── routes.py        # 認証APIエンドポイント
│   │   ├── db/             # データベース
│   │   │   ├── database.py      # DB接続管理
│   │   │   └── models.py        # SQLAlchemyモデル
│   │   ├── rooms/          # 会議室管理
│   │   │   ├── manager.py       # Redis状態管理
│   │   │   └── routes.py        # 会議室APIエンドポイント
│   │   ├── ai_pipeline/    # AI処理
│   │   │   ├── pipeline.py      # メイン処理パイプライン
│   │   │   ├── providers.py     # AIプロバイダー抽象化
│   │   │   └── qos.py           # 品質監視コントローラー
│   │   ├── websocket/      # リアルタイム通信
│   │   │   └── handler.py       # WebSocketハンドラー
│   │   ├── config.py       # 設定管理
│   │   └── main.py         # アプリケーションエントリ
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/            # APIクライアント
│   │   ├── components/     # UIコンポーネント
│   │   ├── hooks/          # カスタムフック
│   │   ├── pages/          # ページコンポーネント
│   │   ├── store/          # Zustand状態管理
│   │   ├── types/          # TypeScript型定義
│   │   └── styles/         # CSS
│   ├── Dockerfile
│   └── package.json
├── nginx/
│   └── nginx.conf          # リバースプロキシ設定
├── docker compose.yml
└── README.md
```

---

### 処理フロー詳細

#### 音声配信フロー

```
話者A（日本語で発言）
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                    サーバー処理                              │
│  1. 音声データ受信                                          │
│  2. ASR: 音声 → テキスト（日本語）                          │
│  3. 参加者ごとに設定を確認                                  │
│     ┌──────────────────────────────────────────────────┐   │
│     │ 参加者B: audio_mode=original, subtitle=on        │   │
│     │ → 原声 + 日本語字幕を送信                        │   │
│     ├──────────────────────────────────────────────────┤   │
│     │ 参加者C: audio_mode=translated, target=en        │   │
│     │ → 翻訳音声 + 英語字幕を送信                      │   │
│     ├──────────────────────────────────────────────────┤   │
│     │ 参加者D: audio_mode=original, subtitle=off       │   │
│     │ → 原声のみ送信                                   │   │
│     └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### QoS劣化時のフォールバック

```
通常時（遅延 < 1200ms）
┌─────────────────────┐
│  翻訳音声 + 字幕     │
└─────────────────────┘

軽度劣化（1200ms < 遅延 < 1800ms）
┌─────────────────────┐
│  翻訳音声 + 字幕     │
│  ⚠️ 遅延警告表示    │
└─────────────────────┘

中度劣化（1800ms < 遅延 < 2400ms）
┌─────────────────────┐
│  原声 + 翻訳字幕     │  ← 音声を原声にフォールバック
│  ⚠️ 字幕モード通知   │
└─────────────────────┘

重度劣化（遅延 > 2400ms）
┌─────────────────────┐
│  原声 + 翻訳字幕     │
│  🔴 品質低下警告    │
└─────────────────────┘
```

---

### API エンドポイント一覧

#### 認証 API

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/auth/register` | ユーザー登録 |
| POST | `/api/auth/login` | ログイン |
| GET | `/api/auth/me` | 現在のユーザー取得 |

#### 会議室 API

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/rooms` | 会議室一覧 |
| POST | `/api/rooms` | 会議室作成 |
| GET | `/api/rooms/{id}` | 会議室詳細 |

#### WebSocket

| パス | 説明 |
|------|------|
| `/ws/room/{room_id}?token={jwt}` | 会議室接続 |

**WebSocket メッセージタイプ:**

```typescript
// クライアント → サーバー
{ type: "preference_change", audio_mode: "translated", subtitle_enabled: true }
{ type: "speaking_start" }
{ type: "speaking_end" }

// サーバー → クライアント
{ type: "room_state", participants: [...], policy: {...} }
{ type: "user_joined", user_id: "...", display_name: "..." }
{ type: "user_left", user_id: "..." }
{ type: "subtitle", text: "...", language: "ja", is_translated: false }
{ type: "qos_warning", level: "moderate", message: "..." }
```

---

## 🌐 LAN内公開設定（Windows + WSL + Docker環境）

WSL2 + Docker環境で開発サーバーを社内LANに公開する方法です。

### ネットワーク構成図

```
┌─────────────────────────────────────────────────────────────────┐
│  社内LAN（例: 192.168.210.0/24）                                 │
│                                                                   │
│  ┌─────────────────┐      ┌─────────────────────────────────┐   │
│  │ 他のPC          │      │ 開発PC（Windows）                │   │
│  │ 192.168.210.x   │ ──── │ 192.168.210.2                    │   │
│  │                 │      │   │                              │   │
│  │ ブラウザで      │      │   │ ポート転送                   │   │
│  │ アクセス        │      │   ▼                              │   │
│  └─────────────────┘      │ ┌─────────────────────────────┐ │   │
│                           │ │ WSL2（172.19.x.x）           │ │   │
│                           │ │   │                          │ │   │
│                           │ │   ▼                          │ │   │
│                           │ │ ┌─────────────────────────┐ │ │   │
│                           │ │ │ Docker Containers       │ │ │   │
│                           │ │ │ ├─ frontend:5173        │ │ │   │
│                           │ │ │ ├─ backend:8000         │ │ │   │
│                           │ │ │ ├─ postgres:5432        │ │ │   │
│                           │ │ │ └─ redis:6379           │ │ │   │
│                           │ │ └─────────────────────────┘ │ │   │
│                           │ └─────────────────────────────┘ │   │
│                           └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### IPアドレスの種類

| 種類 | 例 | 用途 |
|------|-----|------|
| **Windows LAN IP** | `192.168.210.2` | 社内の他PCからアクセスする際に使用 |
| **WSL内部IP** | `172.19.197.130` | Windows↔WSL間の通信（外部からはアクセス不可） |
| **Docker内部IP** | `172.19.0.x` | コンテナ間通信のみ |

### セットアップ手順

#### 1. WindowsのLAN IPアドレスを確認

Windows PowerShellで実行：

```powershell
ipconfig
```

「イーサネット アダプター」または「Wi-Fi」の `IPv4 アドレス`（例：`192.168.210.2`）を確認します。

#### 2. WSLのIPアドレスを確認

Windows PowerShellまたはWSLで実行：

```bash
wsl hostname -I
```

WSLのIPアドレス（例：`172.19.197.130`）を確認します。

#### 3. ポート転送の設定（初回のみ）

**Windows PowerShell（管理者権限）** で実行：

```powershell
# WSLのIPを取得
$wslIp = (wsl hostname -I).Trim().Split(' ')[0]
Write-Host "WSL IP: $wslIp"

# フロントエンド（5173）のポート転送
netsh interface portproxy add v4tov4 listenport=5173 listenaddress=0.0.0.0 connectport=5173 connectaddress=$wslIp

# バックエンド（8000）のポート転送
netsh interface portproxy add v4tov4 listenport=8000 listenaddress=0.0.0.0 connectport=8000 connectaddress=$wslIp

# 設定確認
netsh interface portproxy show all
```

#### 4. Windowsファイアウォールの設定（初回のみ）

**Windows PowerShell（管理者権限）** で実行：

```powershell
New-NetFirewallRule -DisplayName "LAMS Frontend 5173" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "LAMS Backend 8000" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
```

#### 5. Docker Composeの起動

**重要**: `HOST_IP` には **WindowsのLAN IP**（社内からアクセスするIP）を指定します。

WSLで実行：

```bash
# WindowsのLAN IPを指定して起動
HOST_IP=192.168.210.2 docker compose up -d --build frontend backend

# または全サービス起動
HOST_IP=192.168.210.2 docker compose up -d --build
```

### アクセス方法

| アクセス元 | フロントエンド | バックエンドAPI |
|-----------|---------------|----------------|
| 開発PC（localhost） | http://localhost:5173 | http://localhost:8000 |
| 社内の他PC | http://192.168.210.2:5173 | http://192.168.210.2:8000 |

---

### 🔧 トラブルシューティング

#### 問題1: 社内の他PCからアクセスできない

**確認手順:**

```powershell
# 1. ポート転送が設定されているか確認
netsh interface portproxy show all

# 2. WSLのIPが変わっていないか確認
wsl hostname -I

# 3. ファイアウォールルールが有効か確認
Get-NetFirewallRule -DisplayName "LAMS*" | Select-Object DisplayName, Enabled
```

**解決方法:**

```powershell
# ポート転送をリセット
netsh interface portproxy reset

# 新しいWSL IPで再設定
$wslIp = (wsl hostname -I).Trim().Split(' ')[0]
netsh interface portproxy add v4tov4 listenport=5173 listenaddress=0.0.0.0 connectport=5173 connectaddress=$wslIp
netsh interface portproxy add v4tov4 listenport=8000 listenaddress=0.0.0.0 connectport=8000 connectaddress=$wslIp
```

#### 問題2: ログインはできるがWebSocket接続が切断される

**原因**: フロントエンドの環境変数（`VITE_API_URL`, `VITE_WS_URL`）が正しく設定されていない

**確認手順:**

```bash
# フロントエンドの環境変数を確認
docker logs lams-mvp-frontend-1 2>&1 | grep "Vite Config"

# 期待される出力:
# [Vite Config] API URL: http://192.168.210.2:8000
# [Vite Config] WS URL: ws://192.168.210.2:8000
```

**解決方法:**

```bash
# HOST_IPを指定してフロントエンドを再起動
HOST_IP=192.168.210.2 docker compose up -d --build frontend
```

#### 問題3: APIリクエストが 5173 ポートに送られる

**原因**: `VITE_API_URL` が設定されていないため、相対パス `/api` が使用されている

**確認方法**: ブラウザの開発者ツール(F12) → Network → APIリクエストのURLを確認

**解決方法**: 上記「問題2」と同じ

#### 問題4: マイクが使用できない（音声デバイスエラー）

**原因**: ブラウザのセキュリティ制限。`getUserMedia` APIはHTTPSまたはlocalhostでのみ動作します。

**解決方法（Chrome）:**

1. アドレスバーに入力:
   ```
   chrome://flags/#unsafely-treat-insecure-origin-as-secure
   ```

2. 「Insecure origins treated as secure」に以下を追加:
   ```
   http://192.168.210.2:5173
   ```

3. 右側のドロップダウンで「Enabled」を選択

4. 画面下部の「Relaunch」をクリックしてChromeを再起動

5. `http://192.168.210.2:5173` に再アクセス

**注意**: 会議に参加する全員が自分のブラウザでこの設定を行う必要があります。

**解決方法（Edge）:**

1. アドレスバーに入力:
   ```
   edge://flags/#unsafely-treat-insecure-origin-as-secure
   ```

2. 以降はChromeと同じ手順

#### 問題5: WSL再起動後にアクセスできなくなった

**原因**: WSLのIPアドレスは再起動で変わることがあります

**解決方法:**

```powershell
# Windows PowerShell（管理者権限）で実行

# 1. 現在のWSL IPを確認
$wslIp = (wsl hostname -I).Trim().Split(' ')[0]
Write-Host "新しいWSL IP: $wslIp"

# 2. ポート転送をリセットして再設定
netsh interface portproxy reset
netsh interface portproxy add v4tov4 listenport=5173 listenaddress=0.0.0.0 connectport=5173 connectaddress=$wslIp
netsh interface portproxy add v4tov4 listenport=8000 listenaddress=0.0.0.0 connectport=8000 connectaddress=$wslIp

# 3. 設定確認
netsh interface portproxy show all
```

その後、WSLでDockerを再起動:

```bash
HOST_IP=192.168.210.2 docker compose up -d --build frontend backend
```

---

## 🙏 謝辞

本プロジェクトは以下のオープンソースプロジェクトを使用しています。

### バックエンド

| ライブラリ | ライセンス | 用途 |
|-----------|-----------|------|
| [FastAPI](https://fastapi.tiangolo.com/) | MIT | Webフレームワーク |
| [SQLAlchemy](https://www.sqlalchemy.org/) | MIT | ORM |
| [Pydantic](https://docs.pydantic.dev/) | MIT | データバリデーション |
| [python-jose](https://github.com/mpdavis/python-jose) | MIT | JWT処理 |
| [redis-py](https://github.com/redis/redis-py) | MIT | Redisクライアント |
| [asyncpg](https://github.com/MagicStack/asyncpg) | Apache 2.0 | PostgreSQL非同期ドライバ |
| [uvicorn](https://www.uvicorn.org/) | BSD | ASGIサーバー |

### フロントエンド

| ライブラリ | ライセンス | 用途 |
|-----------|-----------|------|
| [React](https://react.dev/) | MIT | UIフレームワーク |
| [Zustand](https://github.com/pmndrs/zustand) | MIT | 状態管理 |
| [React Router](https://reactrouter.com/) | MIT | ルーティング |
| [Vite](https://vitejs.dev/) | MIT | ビルドツール |
| [TypeScript](https://www.typescriptlang.org/) | Apache 2.0 | 型システム |

### インフラ

| ソフトウェア | ライセンス | 用途 |
|-------------|-----------|------|
| [PostgreSQL](https://www.postgresql.org/) | PostgreSQL License | データベース |
| [Redis](https://redis.io/) | BSD | キャッシュ・状態管理 |
| [Nginx](https://nginx.org/) | BSD | リバースプロキシ |
| [Docker](https://www.docker.com/) | Apache 2.0 | コンテナ化 |

### AI サービス

| サービス | 提供元 | 用途 |
|---------|--------|------|
| [Gemini API](https://ai.google.dev/) | Google | 音声認識・翻訳・音声合成 |
| [OpenAI API](https://openai.com/) | OpenAI | Whisper ASR・GPT翻訳 |

---

## 📄 ライセンス

MIT License

---

## 📞 サポート

問題やご質問がございましたら、Issue を作成してください。

---

<p align="center">
  <sub>Built with ❤️ for better cross-language communication</sub>
</p>

