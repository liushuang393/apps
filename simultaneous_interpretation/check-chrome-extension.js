#!/usr/bin/env node
/**
 * Chrome Extension コード品質チェックツール
 *
 * 目的:
 *   Chrome Extension開発時の一般的なエラーを自動検出
 *   - Service Workerでのwindow/document使用
 *   - manifest.jsonの設定ミス
 *   - CSP違反
 *
 * 使用方法:
 *   node check-chrome-extension.js
 */

const fs = require('fs');
const path = require('path');

// チェック結果
const errors = [];
const warnings = [];
const info = [];

/**
 * ファイル内容をチェック
 */
function checkFileContent(filePath, content) {
    const fileName = path.basename(filePath);
    const lines = content.split('\n');

    // Service Worker関連ファイルのチェック
    if (fileName === 'background.js' || fileName === 'config.js') {
        lines.forEach((line, index) => {
            const lineNum = index + 1;

            // window使用チェック（変数名としてのwindowは除外）
            if (/\bwindow\b/.test(line) &&
                !/typeof window/.test(line) &&
                !/\/\//.test(line) &&
                !/const window/.test(line) &&
                !/let window/.test(line) &&
                !/var window/.test(line) &&
                !/(window\s*=|window:)/.test(line)) {
                errors.push({
                    file: filePath,
                    line: lineNum,
                    message: `❌ Service Workerで'window'を使用しています。'globalThis'を使用してください。`,
                    code: line.trim()
                });
            }

            // document使用チェック
            if (/\bdocument\b/.test(line) && !/\/\//.test(line)) {
                errors.push({
                    file: filePath,
                    line: lineNum,
                    message: `❌ Service Workerで'document'を使用しています。Service Workerにはdomがありません。`,
                    code: line.trim()
                });
            }

            // localStorage使用チェック
            if (/\blocalStorage\b/.test(line) && !/\/\//.test(line)) {
                errors.push({
                    file: filePath,
                    line: lineNum,
                    message: `❌ Service Workerで'localStorage'を使用しています。'chrome.storage'を使用してください。`,
                    code: line.trim()
                });
            }
        });
    }

    // 全ファイル共通チェック
    lines.forEach((line, index) => {
        const lineNum = index + 1;

        // eval使用チェック
        if (/\beval\(/.test(line) && !/\/\//.test(line)) {
            errors.push({
                file: filePath,
                line: lineNum,
                message: `❌ 'eval()'の使用は禁止されています（CSP違反）。`,
                code: line.trim()
            });
        }

        // inline event handler チェック
        if (/onclick=|onload=|onerror=/.test(line) && !/\/\//.test(line)) {
            warnings.push({
                file: filePath,
                line: lineNum,
                message: `⚠️  インラインイベントハンドラーはCSP違反の可能性があります。`,
                code: line.trim()
            });
        }
    });
}

/**
 * manifest.jsonをチェック
 */
function checkManifest() {
    const manifestPath = path.join(__dirname, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
        errors.push({
            file: 'manifest.json',
            message: '❌ manifest.jsonが見つかりません。'
        });
        return;
    }

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        // Manifest V3チェック
        if (manifest.manifest_version !== 3) {
            errors.push({
                file: 'manifest.json',
                message: `❌ Manifest V3を使用してください。現在: V${manifest.manifest_version}`
            });
        }

        // Service Workerチェック
        if (!manifest.background || !manifest.background.service_worker) {
            warnings.push({
                file: 'manifest.json',
                message: '⚠️  background.service_workerが設定されていません。'
            });
        }

        // CSPチェック
        if (manifest.content_security_policy) {
            const csp = manifest.content_security_policy.extension_pages || '';

            if (csp.includes('unsafe-eval')) {
                errors.push({
                    file: 'manifest.json',
                    message: "❌ CSPで'unsafe-eval'を使用しています。削除してください。"
                });
            }

            if (csp.includes('unsafe-inline')) {
                warnings.push({
                    file: 'manifest.json',
                    message: "⚠️  CSPで'unsafe-inline'を使用しています。可能な限り削除してください。"
                });
            }
        }

        info.push({
            message: `✅ manifest.json: Manifest V${manifest.manifest_version}`
        });
    } catch (error) {
        errors.push({
            file: 'manifest.json',
            message: `❌ manifest.jsonの解析エラー: ${error.message}`
        });
    }
}

/**
 * 指定されたファイルをチェック
 */
function checkFiles() {
    const filesToCheck = [
        'background.js',
        'config.js',
        'subscription.html',
        'success.html',
        'teams-realtime-translator.html'
    ];

    filesToCheck.forEach((fileName) => {
        const filePath = path.join(__dirname, fileName);

        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            checkFileContent(filePath, content);
            info.push({ message: `✅ チェック完了: ${fileName}` });
        } else {
            warnings.push({
                file: fileName,
                message: `⚠️  ファイルが見つかりません: ${fileName}`
            });
        }
    });
}

/**
 * 結果を表示
 */
function printResults() {
    console.log('\n🔍 Chrome Extension コード品質チェック結果\n');
    console.log('='.repeat(60));

    // エラー
    if (errors.length > 0) {
        console.log('\n❌ エラー (' + errors.length + '件):');
        errors.forEach((error) => {
            console.log(`\n  ファイル: ${error.file}`);
            if (error.line) console.log(`  行: ${error.line}`);
            console.log(`  ${error.message}`);
            if (error.code) console.log(`  コード: ${error.code}`);
        });
    }

    // 警告
    if (warnings.length > 0) {
        console.log('\n⚠️  警告 (' + warnings.length + '件):');
        warnings.forEach((warning) => {
            console.log(`\n  ファイル: ${warning.file}`);
            if (warning.line) console.log(`  行: ${warning.line}`);
            console.log(`  ${warning.message}`);
            if (warning.code) console.log(`  コード: ${warning.code}`);
        });
    }

    // 情報
    if (info.length > 0 && errors.length === 0 && warnings.length === 0) {
        console.log('\n✅ 情報:');
        info.forEach((item) => {
            console.log(`  ${item.message}`);
        });
    }

    console.log('\n' + '='.repeat(60));

    // サマリー
    if (errors.length === 0 && warnings.length === 0) {
        console.log('\n✨ すべてのチェックに合格しました！\n');
        process.exit(0);
    } else {
        console.log(`\n📊 サマリー: エラー ${errors.length}件, 警告 ${warnings.length}件\n`);
        if (errors.length > 0) {
            console.log('❌ エラーを修正してください。\n');
            process.exit(1);
        } else {
            console.log('⚠️  警告を確認してください。\n');
            process.exit(0);
        }
    }
}

// メイン処理
console.log('🚀 Chrome Extension コード品質チェック開始...\n');

checkManifest();
checkFiles();
printResults();

