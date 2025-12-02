# テストカバレッジレポート

## テスト実行コマンド

### すべてのテストを実行（カバレッジ付き）
```bash
cd api
npm test
```

### 包括的テストのみ実行
```bash
cd api
npm run test:comprehensive
```

## カバレッジレポートの確認

テスト実行後、以下のファイルでカバレッジレポートを確認できます:

- **HTMLレポート**: `coverage/lcov-report/index.html`
- **テキストレポート**: コンソール出力
- **LCOVレポート**: `coverage/lcov.info`

## カバレッジ目標

- **Statements**: 80%以上
- **Branches**: 75%以上
- **Functions**: 80%以上
- **Lines**: 80%以上

## テスト対象ファイル

### コントローラー
- `src/controllers/user.controller.ts` - 認証・ユーザー管理
- `src/controllers/purchase.controller.ts` - 購入機能
- `src/controllers/lottery.controller.ts` - 抽選機能
- `src/controllers/campaign.controller.ts` - キャンペーン管理

### サービス
- `src/services/user.service.ts` - ユーザーサービス
- `src/services/purchase.service.ts` - 購入サービス
- `src/services/lottery.service.ts` - 抽選サービス
- `src/services/campaign.service.ts` - キャンペーンサービス

## カバレッジレポートの見方

1. **Statements（文）**: 実行されたコード文の割合
2. **Branches（分岐）**: 実行された分岐の割合（if/else、switch等）
3. **Functions（関数）**: 実行された関数の割合
4. **Lines（行）**: 実行されたコード行の割合

## カバレッジが低い場合の対処

1. テストファイルを確認
2. 未カバーのコードを特定
3. 追加のテストケースを作成
4. 再実行してカバレッジを確認

## 注意事項

- カバレッジレポートは `coverage/` ディレクトリに生成されます
- `.gitignore` に `coverage/` が含まれているため、Gitにはコミットされません
- CI/CD環境では、カバレッジレポートをアーティファクトとして保存することを推奨します
