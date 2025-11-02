/**
 * VoiceTranslate Pro - アプリケーションアイコン生成スクリプト
 *
 * 目的:
 *     Electronアプリ用のマイク/音声アイコンを生成
 *     - icon.png (512x512) - Electron用
 *     - tray-icon.png (32x32) - システムトレイ用
 *
 * 使用方法:
 *     node create-app-icon.js
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

/**
 * マイクアイコンを生成
 *
 * @param {number} size - アイコンサイズ
 * @returns {Canvas} 生成されたキャンバス
 */
function createMicrophoneIcon(size) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // 透明背景
    ctx.clearRect(0, 0, size, size);

    // グラデーションカラー（紫系）
    const colorPrimary = '#667eea';
    const colorSecondary = '#764ba2';

    // マイク本体（楕円）
    const micWidth = size * 0.35;
    const micHeight = size * 0.45;
    const micX = (size - micWidth) / 2;
    const micY = size * 0.15;

    ctx.fillStyle = colorPrimary;
    ctx.beginPath();
    ctx.ellipse(
        micX + micWidth / 2,
        micY + micHeight / 2,
        micWidth / 2,
        micHeight / 2,
        0,
        0,
        Math.PI * 2
    );
    ctx.fill();

    // マイクスタンド（縦線）
    const standWidth = size * 0.08;
    const standX = (size - standWidth) / 2;
    const standY = micY + micHeight;
    const standHeight = size * 0.25;

    ctx.fillStyle = colorSecondary;
    ctx.fillRect(standX, standY, standWidth, standHeight);

    // マイクベース（横線）
    const baseWidth = size * 0.4;
    const baseHeight = size * 0.08;
    const baseX = (size - baseWidth) / 2;
    const baseY = standY + standHeight;

    ctx.fillRect(baseX, baseY, baseWidth, baseHeight);

    // 音波エフェクト（3つの弧）
    ctx.strokeStyle = colorPrimary;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = size * 0.04;

    for (let i = 0; i < 3; i++) {
        const offset = (i + 1) * size * 0.08;
        const waveY = micY + micHeight * 0.3;
        const waveHeight = micHeight * 0.4;

        // 左側の音波
        ctx.beginPath();
        ctx.arc(
            micX,
            waveY + waveHeight / 2,
            offset,
            -Math.PI / 2,
            Math.PI / 2,
            true
        );
        ctx.stroke();

        // 右側の音波
        ctx.beginPath();
        ctx.arc(
            micX + micWidth,
            waveY + waveHeight / 2,
            offset,
            Math.PI / 2,
            -Math.PI / 2,
            true
        );
        ctx.stroke();
    }

    ctx.globalAlpha = 1.0;

    return canvas;
}

/**
 * アイコンファイルを保存
 *
 * @param {string} outputDir - 出力ディレクトリ
 */
function saveIconFiles(outputDir = 'icons') {
    // 出力ディレクトリを作成
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log('🎨 VoiceTranslate Pro アイコン生成中...\n');

    // 1. icon.png (512x512) - Electron/Linux用
    const icon512 = createMicrophoneIcon(512);
    const icon512Path = path.join(outputDir, 'icon.png');
    const icon512Buffer = icon512.toBuffer('image/png');
    fs.writeFileSync(icon512Path, icon512Buffer);
    console.log(`✅ 生成: ${icon512Path} (512x512)`);

    // 2. tray-icon.png (32x32) - システムトレイ用
    const trayIcon = createMicrophoneIcon(32);
    const trayIconPath = path.join(outputDir, 'tray-icon.png');
    const trayIconBuffer = trayIcon.toBuffer('image/png');
    fs.writeFileSync(trayIconPath, trayIconBuffer);
    console.log(`✅ 生成: ${trayIconPath} (32x32)`);

    // 3. 256x256 (Windows用)
    const icon256 = createMicrophoneIcon(256);
    const icon256Path = path.join(outputDir, 'icon-256.png');
    const icon256Buffer = icon256.toBuffer('image/png');
    fs.writeFileSync(icon256Path, icon256Buffer);
    console.log(`✅ 生成: ${icon256Path} (256x256)`);

    console.log('\nℹ️  Windows用icon.icoとmacOS用icon.icnsは、electron-builderが自動生成します');
    console.log('   (icon.pngから自動的に変換されます)');

    console.log('\n✨ アイコン生成完了！');
    console.log('\n📋 次のステップ:');
    console.log('1. Electronアプリを再ビルド: npm run build:electron');
    console.log('2. アプリを起動: npm run electron');
    console.log('3. Windowsタスクバーでアイコンを確認');
}

// メイン処理
try {
    saveIconFiles();
} catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
        console.error('❌ エラー: canvasライブラリがインストールされていません\n');
        console.error('以下のコマンドでインストールしてください:');
        console.error('npm install canvas');
    } else {
        console.error('❌ エラー:', error.message);
    }
    process.exit(1);
}

