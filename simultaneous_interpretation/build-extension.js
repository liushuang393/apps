/**
 * Chrome拡張機能ビルドスクリプト
 * Chrome Web Storeにアップロードするためのzipファイルを作成します
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// 出力ディレクトリとファイル名
const OUTPUT_DIR = path.join(__dirname, 'build');
const OUTPUT_FILE = 'voicetranslate-pro-extension.zip';

// Chrome拡張機能に含めるファイルとフォルダ
const INCLUDE_FILES = [
  'manifest.json',
  'background.js',
  'config.js',
  'subscription.html',
  'success.html',
  'teams-realtime-translator.html',
  'voicetranslate-pro.js',
  'voicetranslate-audio-capture-strategy.js',
  'voicetranslate-audio-queue.js',
  'voicetranslate-path-processors.js',
  'voicetranslate-state-manager.js',
  'voicetranslate-ui-mixin.js',
  'voicetranslate-utils.js',
  'voicetranslate-websocket-mixin.js',
  'audio-processor-worklet.js',
  'echo-canceller-worklet.js',
  'teams-audio-diagnostic.js'
];

const INCLUDE_FOLDERS = [
  'icons',
  'ui'
];

// 除外するファイルパターン
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /\.env/,
  /dist/,
  /build/,
  /tests/,
  /src/,
  /electron/,
  /scripts/,
  /docs/,
  /api/,
  /\.ts$/,
  /\.map$/,
  /package.*\.json$/,
  /tsconfig.*\.json$/,
  /eslint\.config\.js$/,
  /jest\.config\.js$/,
  /\.md$/
];

/**
 * ファイルを除外すべきかチェック
 */
function shouldExclude(filePath) {
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath));
}

/**
 * ディレクトリを作成
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Chrome拡張機能をzipファイルにパッケージング
 */
async function buildExtension() {
  console.log('🚀 Chrome拡張機能のビルドを開始します...\n');

  // 出力ディレクトリを作成
  ensureDir(OUTPUT_DIR);

  const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);

  // 既存のzipファイルを削除
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
    console.log('✅ 既存のzipファイルを削除しました');
  }

  // zipファイルを作成
  const output = fs.createWriteStream(outputPath);
  const archive = archiver('zip', {
    zlib: { level: 9 } // 最大圧縮
  });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      const sizeInMB = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`\n✅ ビルド完了！`);
      console.log(`📦 ファイル: ${outputPath}`);
      console.log(`📊 サイズ: ${sizeInMB} MB`);
      console.log(`📁 合計バイト数: ${archive.pointer()} bytes\n`);
      resolve();
    });

    archive.on('error', (err) => {
      console.error('❌ エラーが発生しました:', err);
      reject(err);
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('⚠️  警告:', err);
      } else {
        reject(err);
      }
    });

    archive.pipe(output);

    // 個別ファイルを追加
    console.log('📄 ファイルを追加中...');
    INCLUDE_FILES.forEach(file => {
      const filePath = path.join(__dirname, file);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: file });
        console.log(`  ✓ ${file}`);
      } else {
        console.warn(`  ⚠️  ${file} が見つかりません`);
      }
    });

    // フォルダを追加
    console.log('\n📁 フォルダを追加中...');
    INCLUDE_FOLDERS.forEach(folder => {
      const folderPath = path.join(__dirname, folder);
      if (fs.existsSync(folderPath)) {
        archive.directory(folderPath, folder);
        console.log(`  ✓ ${folder}/`);
      } else {
        console.warn(`  ⚠️  ${folder}/ が見つかりません`);
      }
    });

    archive.finalize();
  });
}

// ビルド実行
buildExtension()
  .then(() => {
    console.log('🎉 Chrome拡張機能のビルドが完了しました！');
    console.log('\n📝 次のステップ:');
    console.log('1. Chrome Web Store Developer Dashboardにアクセス');
    console.log('   https://chrome.google.com/webstore/devconsole');
    console.log('2. 「新しいアイテム」をクリック');
    console.log(`3. build/${OUTPUT_FILE} をアップロード`);
    console.log('4. ストアの掲載情報を入力');
    console.log('5. 審査に提出\n');
  })
  .catch((err) => {
    console.error('❌ ビルドに失敗しました:', err);
    process.exit(1);
  });

