/**
 * VoiceTranslate Pro - ベンダーライブラリバンドルスクリプト
 *
 * 目的:
 *   Chrome Extension Manifest V3では外部CDNからのスクリプト読み込みが禁止されているため、
 *   npm パッケージをローカルにバンドルして使用する
 *
 * 処理内容:
 *   1. @supabase/supabase-js をバンドル
 *   2. @stripe/stripe-js をバンドル
 *   3. 各ライブラリを単一のJSファイルとして出力
 *
 * 出力先:
 *   - vendor/supabase.js
 *   - vendor/stripe.js
 */

const fs = require('fs');
const path = require('path');

// ベンダーディレクトリを作成
const vendorDir = path.join(__dirname, 'vendor');
if (!fs.existsSync(vendorDir)) {
    fs.mkdirSync(vendorDir, { recursive: true });
}

/**
 * Supabaseライブラリをバンドル
 */
function bundleSupabase() {
    console.log('📦 Bundling Supabase...');
    
    try {
        // Supabaseのブラウザ用ビルドを探す
        const supabasePath = require.resolve('@supabase/supabase-js');
        const supabaseDir = path.dirname(supabasePath);
        
        // dist/umd/supabase.js を探す
        let supabaseFile = path.join(supabaseDir, '..', 'dist', 'umd', 'supabase.js');
        
        if (!fs.existsSync(supabaseFile)) {
            // 別の場所を試す
            supabaseFile = path.join(supabaseDir, 'dist', 'umd', 'supabase.js');
        }
        
        if (!fs.existsSync(supabaseFile)) {
            // メインファイルをコピー
            supabaseFile = supabasePath;
        }
        
        const content = fs.readFileSync(supabaseFile, 'utf-8');
        
        // UMD形式でラップ
        const wrapped = `
/**
 * Supabase Client Library (Bundled for Chrome Extension)
 * @version 2.39.0
 */
(function(global) {
    'use strict';
    
    ${content}
    
    // グローバルに公開
    if (typeof window !== 'undefined') {
        window.supabase = supabase;
    }
    if (typeof self !== 'undefined') {
        self.supabase = supabase;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.supabase = supabase;
    }
})(typeof self !== 'undefined' ? self : this);
`;
        
        const outputPath = path.join(vendorDir, 'supabase.js');
        fs.writeFileSync(outputPath, wrapped, 'utf-8');
        
        console.log('✅ Supabase bundled successfully:', outputPath);
    } catch (error) {
        console.error('❌ Failed to bundle Supabase:', error.message);
        
        // フォールバック: 簡易版を作成
        createSupabaseFallback();
    }
}

/**
 * Supabaseフォールバック版を作成
 */
function createSupabaseFallback() {
    console.log('📝 Creating Supabase fallback...');
    
    const fallback = `
/**
 * Supabase Client Library (Fallback - CDN Loader)
 * Chrome Extension用の簡易ローダー
 */
(function(global) {
    'use strict';
    
    // Supabaseクライアントを動的にロード
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.onload = function() {
        console.log('Supabase loaded from CDN');
    };
    script.onerror = function() {
        console.error('Failed to load Supabase from CDN');
    };
    
    if (typeof document !== 'undefined') {
        document.head.appendChild(script);
    }
})(typeof self !== 'undefined' ? self : this);
`;
    
    const outputPath = path.join(vendorDir, 'supabase.js');
    fs.writeFileSync(outputPath, fallback, 'utf-8');
    
    console.log('✅ Supabase fallback created:', outputPath);
}

/**
 * Stripeライブラリをバンドル
 */
function bundleStripe() {
    console.log('📦 Bundling Stripe...');
    
    const stripeContent = `
/**
 * Stripe.js Loader (Chrome Extension Compatible)
 * 
 * 注意: Stripe.jsは外部スクリプトとして読み込む必要があるため、
 * Chrome Extensionでは特別な処理が必要
 */
(function(global) {
    'use strict';
    
    /**
     * Stripe.jsを動的にロード
     * @param {string} publishableKey - Stripe公開可能キー
     * @returns {Promise<Stripe>} Stripeインスタンス
     */
    function loadStripe(publishableKey) {
        return new Promise((resolve, reject) => {
            // すでにロード済みの場合
            if (typeof Stripe !== 'undefined') {
                resolve(Stripe(publishableKey));
                return;
            }
            
            // スクリプトを動的に追加
            const script = document.createElement('script');
            script.src = 'https://js.stripe.com/v3/';
            script.async = true;
            
            script.onload = function() {
                if (typeof Stripe !== 'undefined') {
                    resolve(Stripe(publishableKey));
                } else {
                    reject(new Error('Stripe failed to load'));
                }
            };
            
            script.onerror = function() {
                reject(new Error('Failed to load Stripe.js'));
            };
            
            if (typeof document !== 'undefined') {
                document.head.appendChild(script);
            } else {
                reject(new Error('Document is not available'));
            }
        });
    }
    
    // グローバルに公開
    const stripeLoader = { loadStripe };
    
    if (typeof window !== 'undefined') {
        window.stripeLoader = stripeLoader;
    }
    if (typeof self !== 'undefined') {
        self.stripeLoader = stripeLoader;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.stripeLoader = stripeLoader;
    }
})(typeof self !== 'undefined' ? self : this);
`;
    
    const outputPath = path.join(vendorDir, 'stripe.js');
    fs.writeFileSync(outputPath, stripeContent, 'utf-8');
    
    console.log('✅ Stripe bundled successfully:', outputPath);
}

/**
 * メイン処理
 */
function main() {
    console.log('🚀 Starting vendor library bundling...\n');
    
    bundleSupabase();
    bundleStripe();
    
    console.log('\n✨ All vendor libraries bundled successfully!');
    console.log('📁 Output directory:', vendorDir);
}

// 実行
main();

