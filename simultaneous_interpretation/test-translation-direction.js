/**
 * 翻訳方向テストスクリプト
 * 
 * 目的：
 *   中国語→日本語の翻訳が正しく動作することを確認
 * 
 * 使用方法：
 *   1. アプリを起動
 *   2. ブラウザの開発者ツールを開く
 *   3. このスクリプトをコンソールに貼り付けて実行
 */

(async function testTranslationDirection() {
    console.log('========== 翻訳方向テスト開始 ==========');
    
    // テスト1: デフォルト設定の確認
    console.log('\n【テスト1】デフォルト設定の確認');
    console.log('期待値: targetLang = "ja"');
    console.log('実際値: targetLang =', app.state.targetLang);
    
    if (app.state.targetLang === 'ja') {
        console.log('✅ PASS: デフォルト目標言語は日本語です');
    } else {
        console.error('❌ FAIL: デフォルト目標言語が日本語ではありません！');
        console.error('   現在の値:', app.state.targetLang);
    }
    
    // テスト2: UI要素の確認
    console.log('\n【テスト2】UI要素の確認');
    const targetLangSelect = document.getElementById('targetLang');
    const selectedValue = targetLangSelect.value;
    const selectedText = targetLangSelect.options[targetLangSelect.selectedIndex].text;
    
    console.log('選択されている値:', selectedValue);
    console.log('選択されているテキスト:', selectedText);
    
    if (selectedValue === 'ja') {
        console.log('✅ PASS: UIで日本語が選択されています');
    } else {
        console.error('❌ FAIL: UIで日本語が選択されていません！');
    }
    
    // テスト3: 翻訳指示の確認
    console.log('\n【テスト3】翻訳指示の確認');
    const instructions = app.getInstructions();
    
    // 中国語→日本語の指示が含まれているか確認
    const hasChineseToJapanese = instructions.includes('Chinese') && instructions.includes('Japanese');
    const hasCorrectDirection = instructions.includes('Chinese to Japanese') || 
                                instructions.includes('Chinese speech to Japanese speech');
    
    console.log('翻訳指示に「Chinese」が含まれる:', instructions.includes('Chinese'));
    console.log('翻訳指示に「Japanese」が含まれる:', instructions.includes('Japanese'));
    
    if (hasChineseToJapanese) {
        console.log('✅ PASS: 翻訳指示に中国語と日本語が含まれています');
    } else {
        console.warn('⚠️ WARNING: 翻訳指示の言語ペアを確認してください');
    }
    
    // テスト4: 言語検出のシミュレーション
    console.log('\n【テスト4】言語検出のシミュレーション');
    
    const testTexts = [
        { text: '你好世界', expected: 'zh', description: '中国語（簡体字）' },
        { text: 'こんにちは', expected: 'ja', description: '日本語（ひらがな）' },
        { text: 'Hello World', expected: 'en', description: '英語' }
    ];
    
    // Path1Processor の detectLanguageFromTranscript メソッドをテスト
    // 注意: このメソッドは Path1Processor のインスタンスメソッドなので、
    // 直接テストできない場合があります
    
    console.log('言語検出テスト:');
    testTexts.forEach(({ text, expected, description }) => {
        // 簡易的な言語検出ロジック（実際のコードと同じ）
        let detected = null;
        if (/[\u4E00-\u9FFF]/.test(text)) {
            detected = 'zh';
        } else if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
            detected = 'ja';
        } else if (/^[a-zA-Z\s0-9!?,.\'-]+$/.test(text)) {
            detected = 'en';
        }
        
        const result = detected === expected ? '✅ PASS' : '❌ FAIL';
        console.log(`  ${result}: "${text}" → ${detected} (期待: ${expected}) - ${description}`);
    });
    
    // テスト5: 翻訳方向の確認
    console.log('\n【テスト5】翻訳方向の確認');
    console.log('現在の設定:');
    console.log('  ソース言語:', app.state.sourceLang || '自動検出');
    console.log('  ターゲット言語:', app.state.targetLang);
    console.log('  翻訳方向: 自動検出 →', app.state.targetLang);
    
    // 中国語入力時の翻訳方向をシミュレート
    const simulatedSourceLang = 'zh'; // 中国語が検出されたと仮定
    const simulatedTargetLang = app.state.targetLang;
    
    console.log('\n中国語入力時の翻訳方向:');
    console.log(`  ${simulatedSourceLang} → ${simulatedTargetLang}`);
    
    if (simulatedTargetLang === 'ja') {
        console.log('✅ PASS: 中国語は日本語に翻訳されます');
    } else {
        console.error('❌ FAIL: 中国語が日本語に翻訳されません！');
        console.error(`   現在の翻訳先: ${simulatedTargetLang}`);
    }
    
    // テスト結果サマリー
    console.log('\n========== テスト結果サマリー ==========');
    const allTestsPassed = 
        app.state.targetLang === 'ja' &&
        targetLangSelect.value === 'ja' &&
        hasChineseToJapanese;
    
    if (allTestsPassed) {
        console.log('🎉 すべてのテストに合格しました！');
        console.log('✅ 中国語→日本語の翻訳が正しく設定されています');
    } else {
        console.error('⚠️ 一部のテストが失敗しました');
        console.error('設定を確認してください');
    }
    
    console.log('\n========== テスト完了 ==========');
})();

