# Docker ネットワーク接続の説明

## 問題: localhost と host.docker.internal の違い

### 状況

- **ローカルDBクライアントツール**（DBeaver、pgAdmin、TablePlus など）で `localhost` に接続 → **失敗**
- **`host.docker.internal` に接続** → **成功**
- **API サーバー（Node.js）** は `localhost` で接続できる

---

## なぜこの違いが発生するのか？

### Docker Desktop for Windows のネットワーク構造

```
┌─────────────────────────────────────────┐
│  Windows ホスト                         │
│                                         │
│  ┌─────────────────┐  ┌──────────────┐ │
│  │ DB クライアント │  │ Node.js API  │ │
│  │ (DBeaver等)     │  │ (npm run dev)│ │
│  └────────┬────────┘  └──────┬───────┘ │
│           │                   │         │
│           │                   │         │
│  ┌────────▼───────────────────▼───────┐ │
│  │  Docker Desktop (WSL2/Hyper-V)     │ │
│  │                                    │ │
│  │  ┌──────────────────────────────┐  │ │
│  │  │ PostgreSQL コンテナ          │  │ │
│  │  │ Port: 5432                  │  │ │
│  │  └──────────────────────────────┘  │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 1. `localhost` が失敗する理由

**Windows 上の DB クライアントツールの場合：**

- 一部の DB クライアントツールは、`localhost` を IPv6 (`::1`) として解決しようとする
- Docker Desktop のポートマッピングは IPv4 (`127.0.0.1`) にバインドされている可能性がある
- または、Windows ファイアウォールやネットワーク設定の問題

**解決策：**
- `127.0.0.1` を明示的に使用（`localhost` の代わりに）
- または `host.docker.internal` を使用

---

### 2. `host.docker.internal` が成功する理由

**`host.docker.internal` とは：**

- Docker Desktop が提供する特殊な DNS 名
- **本来の用途**: コンテナ内からホストマシンにアクセスするため
- **Windows の場合**: 逆方向（ホストからコンテナ）でも動作することがある

**なぜ動作するか：**

- Docker Desktop が内部で `host.docker.internal` を適切にルーティングしている
- ネットワーク設定によっては、`localhost` より確実に動作する

---

### 3. Node.js API が `localhost` で接続できる理由

**Node.js が実行される場所：**

- `npm run dev` は **Windows ホスト上で直接実行**される（Docker コンテナ内ではない）
- `docker-compose.yml` のポートマッピング `"5432:5432"` により、ホストの `localhost:5432` がコンテナの `5432` にマッピングされる
- Node.js の `pg` ライブラリは IPv4 (`127.0.0.1`) を優先的に使用するため、正常に接続できる

---

## 接続文字列の違い

### 現在の設定

**`api/.env` (開発環境):**
```env
DATABASE_URL=postgresql://triprize:triprize_password@localhost:5432/triprize
```

**Docker Compose (コンテナ内の API):**
```yaml
DATABASE_URL: postgresql://triprize:${DB_PASSWORD}@postgres:5432/triprize
```
※ コンテナ内ではサービス名 `postgres` を使用

---

## 推奨される接続方法

### 1. Windows ホスト上で実行するアプリケーション（Node.js API、テストスクリプト）

**`api/.env`:**
```env
# オプション1: localhost (通常は動作する)
DATABASE_URL=postgresql://triprize:triprize_password@localhost:5432/triprize

# オプション2: 127.0.0.1 (より確実)
DATABASE_URL=postgresql://triprize:triprize_password@127.0.0.1:5432/triprize

# オプション3: host.docker.internal (DBクライアントツール用)
DATABASE_URL=postgresql://triprize:triprize_password@host.docker.internal:5432/triprize
```

### 2. DB クライアントツール（DBeaver、pgAdmin、TablePlus など）

**推奨設定：**
- **ホスト**: `host.docker.internal` または `127.0.0.1`
- **ポート**: `5432`
- **データベース**: `triprize`
- **ユーザー**: `triprize`
- **パスワード**: `triprize_password` (または `.env` の `DB_PASSWORD`)

---

## トラブルシューティング

### 問題1: `localhost` で接続できない

**確認事項：**
1. Docker コンテナが起動しているか
   ```bash
   docker-compose ps
   ```

2. ポートが正しくマッピングされているか
   ```bash
   docker port triprize-postgres
   # 出力: 5432/tcp -> 0.0.0.0:5432
   ```

3. Windows ファイアウォールがブロックしていないか

**解決策：**
- `127.0.0.1` または `host.docker.internal` を使用

---

### 問題2: `host.docker.internal` が解決できない

**確認事項：**
```bash
# PowerShell で確認
ping host.docker.internal
```

**解決策：**
- `127.0.0.1` を使用
- または、Docker Desktop の設定を確認

---

### 問題3: ポートが使用中

**確認事項：**
```bash
# PowerShell
netstat -ano | findstr :5432
```

**解決策：**
- 他の PostgreSQL インスタンスが起動していないか確認
- または、`docker-compose.yml` でポートを変更（例: `"5433:5432"`）

---

## まとめ

| 実行場所 | 推奨ホスト名 | 理由 |
|---------|------------|------|
| **Windows ホスト上の Node.js** | `localhost` または `127.0.0.1` | ポートマッピングにより直接アクセス可能 |
| **DB クライアントツール** | `host.docker.internal` または `127.0.0.1` | ネットワーク設定により確実に動作 |
| **Docker コンテナ内のアプリ** | `postgres` (サービス名) | Docker 内部ネットワークを使用 |

---

## 現在のプロジェクトでの推奨設定

### 開発環境（Windows ホスト）

**`api/.env`:**
```env
# Node.js API 用（localhost で動作する）
DATABASE_URL=postgresql://triprize:triprize_password@localhost:5432/triprize
```

**DB クライアントツール用:**
- ホスト: `host.docker.internal` または `127.0.0.1`
- ポート: `5432`
- データベース: `triprize`
- ユーザー: `triprize`
- パスワード: `triprize_password`

この設定により、両方の環境で正常に動作します。
