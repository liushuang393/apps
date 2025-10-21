/**
 * Prettier 設定ファイル
 * 
 * @description
 * VoiceTranslate Pro のコードフォーマット設定
 */

module.exports = {
    // 基本設定
    printWidth: 100,
    tabWidth: 4,
    useTabs: false,
    semi: true,
    singleQuote: true,
    quoteProps: 'as-needed',
    
    // JSX 設定
    jsxSingleQuote: false,
    jsxBracketSameLine: false,
    
    // 末尾カンマ
    trailingComma: 'none',
    
    // スペース
    bracketSpacing: true,
    arrowParens: 'always',
    
    // 改行
    endOfLine: 'lf',
    
    // ファイル形式
    overrides: [
        {
            files: '*.json',
            options: {
                tabWidth: 2
            }
        },
        {
            files: '*.md',
            options: {
                proseWrap: 'preserve'
            }
        }
    ]
};

