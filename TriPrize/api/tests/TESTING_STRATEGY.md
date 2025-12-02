# テスト戦略説明

## データベーステストのアプローチ

### 1. 単体テスト（Unit Tests） - `tests/unit/`

**特徴：**
- ✅ **データベースをモック化** - `jest.mock('../../../src/config/database.config')`
- ✅ **高速実行** - 実際のDB接続なし
- ✅ **ビジネスロジックのテスト** - サービス層のロジックを検証
- ✅ **独立性** - 他のテストに影響しない

**例：**
```typescript
// tests/unit/services/user.service.test.ts
jest.mock('../../../src/config/database.config');
// pool.query をモックして、期待される結果を返す
(pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockUser] });
```

**理由：**
- 単体テストは「サービスが正しいSQLを実行するか」「エラーハンドリングが正しいか」をテスト
- 実際のDB接続は不要（統合テストでカバー）

---

### 2. 統合テスト（Integration Tests） - `tests/integration/`

**特徴：**
- ✅ **実際のDocker PostgreSQLに接続** - `setup.ts` で `database.config` をモックしない
- ✅ **データクリーンアップ** - `beforeAll`/`afterAll` でテストデータを削除
- ✅ **エンドツーエンドテスト** - API → Service → Database の完全なフローをテスト
- ✅ **反復実行可能** - 各テストが独自のデータを作成・削除

**データクリーンアップパターン：**

#### パターン1: 名前パターンで識別
```typescript
beforeAll(async () => {
  // テスト前に既存データを削除
  await pool.query("DELETE FROM users WHERE email LIKE '%purchase-test%'");
  await pool.query("DELETE FROM campaigns WHERE name LIKE '%Purchase Flow%'");
});

afterAll(async () => {
  // テスト後にデータを削除
  await pool.query("DELETE FROM users WHERE email LIKE '%purchase-test%'");
});
```

#### パターン2: テストIDで識別（推奨）
```typescript
const testId = `test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

beforeEach(async () => {
  // テストデータを作成（testIdを使用）
  const userId = await createTestUser(testId);
});

afterEach(async () => {
  // テストデータを削除
  await cleanupTestData(testId);
});
```

**現在の実装状況：**

| テストファイル | クリーンアップ | 状態 |
|--------------|--------------|------|
| `purchase-flow.test.ts` | ✅ beforeAll/afterAll | OK |
| `lottery-flow.test.ts` | ✅ beforeAll/afterAll | OK |
| `payment-e2e-comprehensive.test.ts` | ✅ beforeAll/afterAll/beforeEach/afterEach | OK |
| `payment-webhook.test.ts` | ⚠️ 要確認 | 要確認 |
| `purchase-validation.test.ts` | ⚠️ 要確認 | 要確認 |
| `auth-flow.test.ts` | ⚠️ 要確認 | 要確認 |

---

## テストデータ管理のベストプラクティス

### ✅ 推奨される方法

1. **一意のテストIDを使用**
   ```typescript
   const testId = generateTestId(); // "test-1234567890-abc123"
   const userId = `${testId}-user`;
   const campaignId = `${testId}-campaign`;
   ```

2. **テストヘルパーを使用**
   ```typescript
   import { createTestUser, cleanupTestData } from '../helpers/test-data.helper';
   
   beforeEach(async () => {
     testId = generateTestId();
     userId = await createTestUser(testId);
   });
   
   afterEach(async () => {
     await cleanupTestData(testId);
   });
   ```

3. **外部キー制約を考慮した削除順序**
   ```typescript
   // 子テーブル → 親テーブルの順序で削除
   DELETE FROM lottery_results WHERE ...
   DELETE FROM purchase_items WHERE ...
   DELETE FROM payment_transactions WHERE ...
   DELETE FROM purchases WHERE ...
   DELETE FROM positions WHERE ...
   DELETE FROM campaigns WHERE ...
   DELETE FROM users WHERE ...
   ```

### ❌ 避けるべき方法

1. **固定IDの使用**
   ```typescript
   // ❌ 悪い例
   const userId = 'test-user-123'; // 他のテストと衝突する可能性
   ```

2. **クリーンアップなし**
   ```typescript
   // ❌ 悪い例
   it('should create user', async () => {
     await createUser(...); // 削除しない → データが残る
   });
   ```

3. **他のテストのデータに依存**
   ```typescript
   // ❌ 悪い例
   it('should update user', async () => {
     const user = await getUserById('existing-user-id'); // 他のテストのデータに依存
   });
   ```

---

## 現在の課題と改善提案

### 課題1: 統合テストのクリーンアップが不完全

**問題：**
- 一部の統合テストで `afterEach` がない
- テストが失敗した場合、データが残る可能性がある

**解決策：**
- すべての統合テストに `afterEach` を追加
- `try-finally` で確実にクリーンアップ

### 課題2: テストデータの命名規則が統一されていない

**問題：**
- 一部は `%purchase-test%`、一部は `%Payment E2E%`
- 命名規則が統一されていない

**解決策：**
- `test-data.helper.ts` の `generateTestId()` を使用
- すべてのテストで一貫した命名規則を採用

### 課題3: 単体テストがDB操作をテストしない

**現状：**
- 単体テストはすべてDBをモック化
- 実際のSQL実行やトランザクションをテストしない

**これは意図的な設計：**
- ✅ 単体テスト = ビジネスロジックのテスト
- ✅ 統合テスト = DB操作のテスト
- ✅ この分離は正しいアプローチ

---

## まとめ

### 単体テスト
- **目的**: ビジネスロジックの検証
- **DB**: モック化（高速、独立）
- **クリーンアップ**: 不要（モックなので）

### 統合テスト
- **目的**: エンドツーエンドの動作確認
- **DB**: 実際のDocker PostgreSQL
- **クリーンアップ**: **必須**（beforeAll/afterAll/beforeEach/afterEach）

### 次のステップ
1. ✅ すべての統合テストにクリーンアップロジックを追加
2. ✅ `test-data.helper.ts` を使用して統一的なデータ管理
3. ✅ テストが反復実行可能であることを確認
