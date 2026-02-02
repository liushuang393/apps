# データベース接続ホスト名の選択ガイド

## 概要

Windows ホスト上で実行されるアプリケーション（Node.js API、Java アプリなど）から Docker コンテナ内の PostgreSQL に接続する際のホスト名選択について説明します。

---

## ✅ 結論：どちらでも動作します

**`localhost` / `127.0.0.1` と `host.docker.internal` の両方で接続可能です。**

ただし、環境によって推奨が異なります。

---

## 接続方法の比較

### 1. `localhost` または `127.0.0.1`

**動作原理：**
- Docker Compose のポートマッピング `"5432:5432"` により、ホストの `localhost:5432` がコンテナの `5432` に直接マッピングされる
- 標準的なポートフォワーディング方式

**メリット：**
- ✅ 標準的で理解しやすい
- ✅ すべての環境で動作する（Linux、macOS、Windows）
- ✅ 設定がシンプル

**デメリット：**
- ⚠️ Windows の一部の DB クライアントツールで IPv6/IPv4 の解決問題が発生する可能性がある

**使用例：**
```env
# Node.js (.env)
DATABASE_URL=postgresql://triprize:triprize_password@localhost:5432/triprize
# または
DATABASE_URL=postgresql://triprize:triprize_password@127.0.0.1:5432/triprize
```

```java
// Java (application.properties)
spring.datasource.url=jdbc:postgresql://localhost:5432/triprize
# または
spring.datasource.url=jdbc:postgresql://127.0.0.1:5432/triprize
```

---

### 2. `host.docker.internal`

**動作原理：**
- Docker Desktop が提供する特殊な DNS 名
- **本来の用途**: コンテナ内からホストマシンにアクセスするため
- **Windows の場合**: ホストからコンテナへのアクセスでも動作する

**メリット：**
- ✅ Windows の DB クライアントツールで確実に動作する
- ✅ ネットワーク設定の問題を回避できる
- ✅ Docker Desktop の推奨方法

**デメリット：**
- ⚠️ Docker Desktop 専用（Linux の Docker Engine では動作しない）
- ⚠️ やや特殊な設定

**使用例：**
```env
# Node.js (.env)
DATABASE_URL=postgresql://triprize:triprize_password@host.docker.internal:5432/triprize
```

```java
// Java (application.properties)
spring.datasource.url=jdbc:postgresql://host.docker.internal:5432/triprize
```

---

## 各アプリケーションタイプでの推奨

### Node.js API（Windows ホスト上で実行）

**両方とも動作します：**

```env
# オプション1: localhost（標準的、推奨）
DATABASE_URL=postgresql://triprize:triprize_password@localhost:5432/triprize

# オプション2: 127.0.0.1（より明示的）
DATABASE_URL=postgresql://triprize:triprize_password@127.0.0.1:5432/triprize

# オプション3: host.docker.internal（問題がある場合の代替）
DATABASE_URL=postgresql://triprize:triprize_password@host.docker.internal:5432/triprize
```

**推奨：** `localhost` または `127.0.0.1`（標準的で問題がなければ）

---

### Java アプリケーション（Windows ホスト上で実行）

**⚠️ 実際のテスト結果：`localhost` では接続できない、`host.docker.internal` で接続成功**

```properties
# application.properties

# ❌ localhost - 接続失敗（Windows 上の Spring Boot では動作しない）
# spring.datasource.url=jdbc:postgresql://localhost:5432/triprize

# ✅ 推奨: host.docker.internal（確実に動作）
spring.datasource.url=jdbc:postgresql://host.docker.internal:5432/triprize
spring.datasource.username=triprize
spring.datasource.password=triprize_password

# ✅ 代替: 127.0.0.1（動作する可能性がある）
# spring.datasource.url=jdbc:postgresql://127.0.0.1:5432/triprize
```

**推奨：** `host.docker.internal`（Windows 上の Spring Boot では `localhost` が動作しないため）

---

### DB クライアントツール（DBeaver、pgAdmin、TablePlus など）

**`host.docker.internal` を推奨：**

- **ホスト**: `host.docker.internal` または `127.0.0.1`
- **ポート**: `5432`
- **データベース**: `triprize`
- **ユーザー**: `triprize`
- **パスワード**: `triprize_password`

**理由：** 一部のツールで `localhost` が IPv6 として解決され、接続に失敗する場合があるため

---

## 実際のテスト結果

### Node.js API でのテスト

```bash
# localhost でテスト
DATABASE_URL=postgresql://triprize:triprize_password@localhost:5432/triprize
npm run dev
# ✅ 接続成功

# host.docker.internal でテスト
DATABASE_URL=postgresql://triprize:triprize_password@host.docker.internal:5432/triprize
npm run dev
# ✅ 接続成功
```

### Java アプリケーションでのテスト

```properties
# localhost でテスト
spring.datasource.url=jdbc:postgresql://localhost:5432/triprize
# ❌ 接続失敗（Windows 上の Spring Boot では動作しない）

# host.docker.internal でテスト
spring.datasource.url=jdbc:postgresql://host.docker.internal:5432/triprize
# ✅ 接続成功

# 127.0.0.1 でテスト
spring.datasource.url=jdbc:postgresql://127.0.0.1:5432/triprize
# ⚠️ 動作する可能性があるが、host.docker.internal を推奨
```

---

## トラブルシューティング

### 問題1: `localhost` で接続できない（Node.js/Java）

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

**解決策：**
- `127.0.0.1` を試す（IPv4 を明示的に指定）
- または `host.docker.internal` を使用

---

### 問題2: `host.docker.internal` が解決できない

**確認事項：**
```bash
# PowerShell
ping host.docker.internal
```

**解決策：**
- `127.0.0.1` を使用
- Docker Desktop が起動していることを確認

---

### 問題3: 接続タイムアウト

**確認事項：**
1. ファイアウォールがブロックしていないか
2. ポートが他のアプリケーションで使用されていないか
   ```bash
   netstat -ano | findstr :5432
   ```

**解決策：**
- ファイアウォールの設定を確認
- 他の PostgreSQL インスタンスを停止

---

## まとめ表

| アプリケーションタイプ | `localhost` | `127.0.0.1` | `host.docker.internal` | 推奨 |
|---------------------|------------|------------|---------------------|------|
| **Node.js API** | ✅ 動作 | ✅ 動作 | ✅ 動作 | `localhost` または `127.0.0.1` |
| **Java アプリ (Spring Boot)** | ❌ 動作しない | ⚠️ 未確認 | ✅ 動作 | **`host.docker.internal`** |
| **DB クライアント** | ⚠️ 場合により失敗 | ✅ 動作 | ✅ 動作 | `host.docker.internal` または `127.0.0.1` |

---

## 推奨設定

### 開発環境（Windows）

**Node.js API (`api/.env`):**
```env
# 標準的な設定（推奨）
DATABASE_URL=postgresql://triprize:triprize_password@localhost:5432/triprize

# 問題がある場合の代替
# DATABASE_URL=postgresql://triprize:triprize_password@127.0.0.1:5432/triprize
# DATABASE_URL=postgresql://triprize:triprize_password@host.docker.internal:5432/triprize
```

**Java アプリ (`application.properties`):**
```properties
# ⚠️ Windows 上の Spring Boot では localhost が動作しない
# spring.datasource.url=jdbc:postgresql://localhost:5432/triprize

# ✅ 推奨設定（確実に動作）
spring.datasource.url=jdbc:postgresql://host.docker.internal:5432/triprize
spring.datasource.username=triprize
spring.datasource.password=triprize_password

# 代替（動作する可能性がある）
# spring.datasource.url=jdbc:postgresql://127.0.0.1:5432/triprize
```

**DB クライアントツール:**
- ホスト: `host.docker.internal` または `127.0.0.1`
- ポート: `5432`

---

## 結論

**実際のテスト結果に基づく推奨：**

- **Node.js API**: `localhost` または `127.0.0.1` で動作 ✅
- **Java アプリ (Spring Boot)**: `localhost` では**動作しない** ❌、`host.docker.internal` で動作 ✅
- **DB クライアントツール**: `host.docker.internal` または `127.0.0.1` を推奨 ✅

**Windows 上の Spring Boot アプリケーションでは、`host.docker.internal` を使用することを強く推奨します。**
