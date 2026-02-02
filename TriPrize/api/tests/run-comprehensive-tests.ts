/**
 * 包括的テスト実行スクリプト
 * 目的: すべての包括的テストを実行し、カバレッジレポートを生成する
 * I/O: Jest テスト結果とカバレッジレポートを出力する
 * 注意点: テスト失敗時はエラーを報告し、コード修正を促す
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const testFiles = [
  'tests/unit/controllers/auth-flow-comprehensive.test.ts',
  'tests/unit/controllers/purchase-flow-comprehensive.test.ts',
  'tests/unit/controllers/lottery-flow-comprehensive.test.ts',
  'tests/unit/controllers/admin-management-comprehensive.test.ts',
];

console.log('=== 包括的テスト実行開始 ===\n');

// 各テストファイルの存在確認
for (const testFile of testFiles) {
  const fullPath = path.join(process.cwd(), testFile);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ テストファイルが見つかりません: ${testFile}`);
    process.exit(1);
  }
}

try {
  // Jest でテスト実行（カバレッジ付き）
  console.log('テスト実行中...\n');
  const result = execSync(
    'npx jest --coverage --no-watchman --testPathPattern="comprehensive"',
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      encoding: 'utf-8',
    }
  );

  console.log('\n=== テスト実行完了 ===');
  console.log('カバレッジレポート: coverage/lcov-report/index.html');
} catch (error) {
  console.error('\n❌ テスト実行エラー');
  console.error('テストを修正してから再実行してください。');
  process.exit(1);
}
