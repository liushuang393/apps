# LAMS 開発規則 / Development Rules

**Language-Aware Meeting System (LAMS) プロジェクト開発規範**

---

## 📋 目次

1. [基本原則](#基本原則)
2. [コーディング規約](#コーディング規約)
3. [静的解析・品質管理](#静的解析品質管理)
4. [禁止事項](#禁止事項)
5. [Git運用規則](#git運用規則)
6. [セキュリティ規則](#セキュリティ規則)
7. [テスト規則](#テスト規則)
8. [ドキュメント規則](#ドキュメント規則)

---

## 基本原則

### A. 文字コード規則（必須）

**全ファイル編集前にエンコーディングを必ず確認**

| ファイル種別 | エンコーディング | 備考 |
|------------|----------------|------|
| ソースコード（.py, .ts, .tsx, .js） | **UTF-8（BOMなし）** | 必須 |
| 設定ファイル（.json, .yaml, .toml） | **UTF-8（BOMなし）** | 必須 |
| ドキュメント（.md） | **UTF-8（BOM付き可）** | 推奨 |
| シェルスクリプト（.sh） | **UTF-8（BOMなし）** | 必須 |

### B. コメント規則

1. **正式な日本語コメント**を必ず記載
   - 関数・クラス：目的、入出力、注意点を記載
   - 複雑なロジック：処理の意図を説明
   - 不明点は「不明」と明示、推測禁止

2. **コメント例（Python）**
   ```python
   def translate_text(text: str, source_lang: str, target_lang: str) -> str:
       """
       テキストを指定言語に翻訳する
       
       Args:
           text: 翻訳対象テキスト
           source_lang: 元言語コード（例: 'ja', 'en'）
           target_lang: 翻訳先言語コード
       
       Returns:
           翻訳されたテキスト
       
       Raises:
           ValueError: 未対応の言語コードの場合
       
       Note:
           - 空文字列の場合は空文字列を返す
           - キャッシュを使用して重複翻訳を回避
       """
   ```

3. **コメント例（TypeScript）**
   ```typescript
   /**
    * WebSocket接続を確立し、会議室に参加する
    * 
    * @param roomId - 会議室ID
    * @param token - JWT認証トークン
    * @returns WebSocket接続インスタンス
    * @throws {Error} 接続失敗時
    * 
    * @remarks
    * - 自動再接続機能を含む
    * - 接続失敗時は3回までリトライ
    */
   function connectToRoom(roomId: string, token: string): WebSocket {
   ```

### C. 品質基準

- **デモレベル禁止**：成果物は実行可能で専門的な品質必須
- **不明点の扱い**：不明な仕様は「不明」と明示し、推測で実装しない
- **レビュー前提**：全てのコードは静的解析を通過すること

---

## コーディング規約

### フロントエンド（TypeScript/React）

#### 1. TypeScript設定

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

#### 2. 禁止事項

- ❌ `any` 型の使用禁止（やむを得ない場合は `unknown` を使用）
- ❌ `@ts-ignore` / `@ts-expect-error` の使用禁止
- ❌ `console.log` の使用禁止（開発時は削除すること）
- ❌ マジックナンバーの使用禁止（定数化必須）

#### 3. 推奨事項

- ✅ 関数コンポーネントを使用
- ✅ カスタムフックで状態ロジックを分離
- ✅ Propsは `interface` で定義
- ✅ エラーハンドリングを必ず実装

#### 4. コード例

```typescript
// ❌ 悪い例
function UserCard(props: any) {
  console.log(props);
  return <div>{props.name}</div>;
}

// ✅ 良い例
interface UserCardProps {
  userId: string;
  displayName: string;
  nativeLanguage: string;
}

function UserCard({ userId, displayName, nativeLanguage }: UserCardProps): JSX.Element {
  return (
    <div className="user-card">
      <h3>{displayName}</h3>
      <span>{nativeLanguage}</span>
    </div>
  );
}
```

### バックエンド（Python/FastAPI）

#### 1. Ruff設定（pyproject.toml）

```toml
[tool.ruff]
target-version = "py310"
line-length = 88

[tool.ruff.lint]
select = ["E", "W", "F", "I", "B", "C4", "UP", "ARG", "SIM"]
ignore = ["E501", "B008", "B904"]
```

#### 2. 禁止事項

- ❌ `print()` の使用禁止（ロギングを使用）
- ❌ `System.out.println` の使用禁止
- ❌ マジックナンバーの使用禁止（定数化必須）
- ❌ 秘密情報のハードコード禁止（環境変数を使用）
- ❌ 型ヒントなしの関数定義禁止

#### 3. 推奨事項

- ✅ 型ヒントを必ず記載（引数、戻り値）
- ✅ Pydanticモデルでバリデーション
- ✅ 非同期処理は `async/await` を使用
- ✅ エラーは適切な例外クラスで送出

#### 4. コード例

```python
# ❌ 悪い例
def get_user(id):
    print(f"Getting user {id}")
    return db.query(User).filter(User.id == id).first()

# ✅ 良い例
import logging
from typing import Optional

logger = logging.getLogger(__name__)

async def get_user(user_id: str) -> Optional[User]:
    """
    ユーザーIDからユーザー情報を取得

    Args:
        user_id: ユーザーID

    Returns:
        ユーザー情報、存在しない場合はNone
    """
    logger.info(f"Fetching user: {user_id}")
    async with get_db_session() as session:
        result = await session.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()
```

---

## 静的解析・品質管理

### 実行方法

```bash
cd lams-mvp

# 全チェック（エラー表示のみ）
./scripts/check.sh

# 全チェック + 自動修正
./scripts/check.sh --fix

# バックエンドのみ
./scripts/check.sh --backend

# フロントエンドのみ
./scripts/check.sh --frontend
```

### 品質基準（必須）

#### フロントエンド

| ツール | 基準 | 備考 |
|--------|------|------|
| **ESLint** | 0 エラー | 警告も可能な限り解消 |
| **TypeScript** | `tsc --noEmit` = 0 エラー | 型エラーは必ず修正 |

#### バックエンド

| ツール | 基準 | 備考 |
|--------|------|------|
| **Ruff Lint** | 0 エラー | `--fix` で自動修正可能 |
| **Ruff Format** | フォーマット済み | Black互換 |
| **Python構文** | `py_compile` 成功 | 構文エラーなし |

### コミット前チェック（必須）

```bash
# コミット前に必ず実行
./scripts/check.sh

# エラーがある場合は自動修正を試行
./scripts/check.sh --fix

# 修正できないエラーは手動で対応
```

---

## 禁止事項

### 1. セキュリティ関連

- ❌ APIキー・パスワードのハードコード禁止
- ❌ 秘密情報のGitコミット禁止
- ❌ SQLインジェクション脆弱性のあるコード禁止
- ❌ XSS脆弱性のあるコード禁止

### 2. コード品質

- ❌ デバッグ用コードの残存禁止（`console.log`, `print`）
- ❌ 未使用のインポート・変数の残存禁止
- ❌ コメントアウトされたコードの残存禁止
- ❌ TODOコメントの放置禁止（Issueを作成）

### 3. 依存関係管理

- ❌ `package.json` / `pyproject.toml` の手動編集禁止
  - ✅ 代わりに `npm install` / `pip install` を使用
- ❌ バージョン指定なしの依存追加禁止
- ❌ 未使用の依存関係の残存禁止

### 4. Git運用

- ❌ `main` ブランチへの直接コミット禁止
- ❌ コミットメッセージなしのコミット禁止
- ❌ 大量のファイルを1コミットにまとめる禁止
- ❌ レビューなしのマージ禁止

---

## Git運用規則

### ブランチ戦略

```
main (本番環境)
  ├── develop (開発環境)
  │    ├── feature/user-auth (機能開発)
  │    ├── feature/websocket-optimization (機能開発)
  │    └── bugfix/subtitle-sync (バグ修正)
  └── hotfix/security-patch (緊急修正)
```

### ブランチ命名規則

| 種類 | プレフィックス | 例 |
|------|--------------|-----|
| 機能開発 | `feature/` | `feature/add-room-policy` |
| バグ修正 | `bugfix/` | `bugfix/fix-websocket-reconnect` |
| 緊急修正 | `hotfix/` | `hotfix/security-update` |
| リファクタリング | `refactor/` | `refactor/optimize-ai-pipeline` |
| ドキュメント | `docs/` | `docs/update-api-spec` |

### コミットメッセージ規則

```
<type>(<scope>): <subject>

<body>

<footer>
```

#### Type（必須）

- `feat`: 新機能
- `fix`: バグ修正
- `docs`: ドキュメント変更
- `style`: コードフォーマット（機能変更なし）
- `refactor`: リファクタリング
- `test`: テスト追加・修正
- `chore`: ビルド・設定変更

#### 例

```
feat(websocket): 自動再接続機能を追加

WebSocket切断時に3回まで自動再接続を試行する機能を実装。
指数バックオフアルゴリズムを使用して再接続間隔を調整。

Closes #123
```

### プルリクエスト規則

#### テンプレート

```markdown
## 概要
<!-- 変更内容の簡潔な説明 -->

## 変更内容
- [ ] 機能A を追加
- [ ] バグB を修正
- [ ] ドキュメントC を更新

## テスト
- [ ] 単体テスト追加
- [ ] 手動テスト実施
- [ ] 静的解析通過（`./scripts/check.sh`）

## 関連Issue
Closes #123

## スクリーンショット（UI変更の場合）
<!-- 変更前後のスクリーンショット -->

## レビュー観点
<!-- レビュアーに特に確認してほしい点 -->
```

#### マージ条件

- ✅ 静的解析エラー 0
- ✅ テスト通過
- ✅ 最低1名のレビュー承認
- ✅ コンフリクト解消済み

---

## セキュリティ規則

### 1. 環境変数管理

#### 秘密情報の扱い

```bash
# ❌ 悪い例：ハードコード
GEMINI_API_KEY = "AIzaSyC..."

# ✅ 良い例：環境変数
import os
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY is not set")
```

#### secrets.json の使用

```json
{
  "gemini_api_key": "your-api-key-here",
  "openai_api_key": "your-openai-key-here"
}
```

**重要**: `secrets.json` は `.gitignore` に追加済み

### 2. 認証・認可

- JWT トークンは環境変数で管理
- パスワードは bcrypt でハッシュ化
- RBAC（Role-Based Access Control）を使用
  - `admin`: 全権限
  - `moderator`: 会議管理権限
  - `user`: 基本権限

### 3. CORS設定

```python
# backend/app/config.py
cors_origins: list[str] = ["http://localhost:5173"]

# 本番環境では明示的に許可するオリジンのみ設定
```

### 4. 入力バリデーション

- Pydantic モデルで全入力を検証
- SQLインジェクション対策（SQLAlchemy ORM使用）
- XSS対策（React自動エスケープ）

---

## テスト規則

### テスト戦略

| レイヤー | ツール | カバレッジ目標 |
|---------|--------|--------------|
| フロントエンド単体 | Jest + React Testing Library | 70%以上 |
| バックエンド単体 | pytest | 80%以上 |
| E2Eテスト | Playwright | 主要フロー100% |

### テストファイル配置

```
backend/
  ├── app/
  │   └── auth/
  │       └── routes.py
  └── tests/
      └── test_auth_routes.py

frontend/
  ├── src/
  │   └── components/
  │       └── UserCard.tsx
  └── __tests__/
      └── UserCard.test.tsx
```

### テスト命名規則

```python
# backend/tests/test_auth_routes.py
def test_register_success():
    """正常系: ユーザー登録が成功する"""
    pass

def test_register_duplicate_email():
    """異常系: 重複メールアドレスでエラー"""
    pass
```

```typescript
// frontend/__tests__/UserCard.test.tsx
describe('UserCard', () => {
  it('ユーザー名を正しく表示する', () => {
    // テストコード
  });

  it('母語アイコンを表示する', () => {
    // テストコード
  });
});
```

### テスト実行

```bash
# バックエンド
cd backend
pytest

# フロントエンド
cd frontend
npm test

# E2Eテスト
cd lams-mvp
npx playwright test
```

---

## ドキュメント規則

### 1. README.md

- プロジェクト概要
- セットアップ手順
- 使用方法
- トラブルシューティング

### 2. API ドキュメント

- FastAPI自動生成（Swagger UI）
- アクセス: `http://localhost:8000/docs`

### 3. コードコメント

- 複雑なロジックには必ずコメント
- 日本語で記載
- Why（なぜ）を説明（What（何を）はコードで分かる）

### 4. 変更履歴

- 重要な変更は CHANGELOG.md に記載
- バージョン番号は Semantic Versioning に従う

---

## 拒否テンプレート

品質規則を満たさない場合、以下のテンプレートで作業を中止します。

```
品質規則を満たさないため作業を中止します。

以下の情報を提示してください:
- 実行環境（OS、Node.js/Pythonバージョン）
- 適用すべきルール・規約
- 依存ライブラリのバージョン
- 実行手順

静的解析エラー:
- ESLint: X件
- TypeScript: Y件
- Ruff: Z件

修正後、再度レビューを依頼してください。
```

---

## チェックリスト

### コミット前

- [ ] `./scripts/check.sh` を実行し、エラー0を確認
- [ ] デバッグコード（`console.log`, `print`）を削除
- [ ] 未使用のインポート・変数を削除
- [ ] コメントアウトされたコードを削除
- [ ] 適切なコミットメッセージを記載

### プルリクエスト作成前

- [ ] 静的解析エラー 0
- [ ] テスト追加・更新
- [ ] ドキュメント更新（必要に応じて）
- [ ] セルフレビュー実施
- [ ] コンフリクト解消

### レビュー時

- [ ] コードの可読性
- [ ] セキュリティ脆弱性の有無
- [ ] パフォーマンスへの影響
- [ ] テストの妥当性
- [ ] ドキュメントの正確性

---

## 参考資料

- [TypeScript公式ドキュメント](https://www.typescriptlang.org/docs/)
- [React公式ドキュメント](https://react.dev/)
- [FastAPI公式ドキュメント](https://fastapi.tiangolo.com/)
- [Ruff公式ドキュメント](https://docs.astral.sh/ruff/)
- [Conventional Commits](https://www.conventionalcommits.org/)

---

<p align="center">
  <sub>品質を守り、チームで成長する</sub>
</p>

