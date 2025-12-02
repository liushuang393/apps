/**
 * テストを名前の降順で順次実行するスクリプト
 * 目的: ユーザーの要求に従い、テストファイルを名前で降順ソートし、後ろから順に実行
 * I/O: テスト結果をコンソールに出力
 * 注意点: 各テストを個別に実行し、エラーがあれば停止
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// テストファイルを取得して降順ソート
function getTestFiles() {
  const testDir = path.join(__dirname, 'tests');
  const files = [];
  
  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        files.push(fullPath);
      }
    }
  }
  
  walkDir(testDir);
  
  // ファイル名で降順ソート
  return files.sort((a, b) => {
    const nameA = path.basename(a);
    const nameB = path.basename(b);
    return nameB.localeCompare(nameA);
  });
}

// テストを実行
function runTest(testFile) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`実行中: ${testFile}`);
    console.log('='.repeat(80));
    
    const jest = spawn('npx', ['jest', testFile, '--no-coverage', '--verbose'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true
    });
    
    jest.on('close', (code) => {
      if (code === 0) {
        console.log(`✓ 成功: ${testFile}`);
        resolve();
      } else {
        console.error(`✗ 失敗: ${testFile} (終了コード: ${code})`);
        reject(new Error(`Test failed with exit code ${code}`));
      }
    });
    
    jest.on('error', (err) => {
      console.error(`エラー: ${testFile}`, err);
      reject(err);
    });
  });
}

// メイン処理
async function main() {
  const testFiles = getTestFiles();
  
  console.log(`\n見つかったテストファイル数: ${testFiles.length}`);
  console.log('実行順序（名前の降順）:');
  testFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file}`);
  });
  
  console.log('\nテストを開始します...\n');
  
  for (let i = 0; i < testFiles.length; i++) {
    const testFile = testFiles[i];
    try {
      await runTest(testFile);
    } catch (error) {
      console.error(`\nテストが失敗しました: ${testFile}`);
      console.error('エラー:', error.message);
      console.error('\n次のテストに進むには Enter キーを押してください...');
      process.exit(1);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('すべてのテストが完了しました！');
  console.log('='.repeat(80));
}

main().catch(console.error);
