/**
 * ESLint 設定ファイル (Flat Config)
 * 
 * @description
 * VoiceTranslate Pro のコード品質管理設定
 */

const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettierPlugin = require('eslint-plugin-prettier');

module.exports = [
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2020,
                sourceType: 'module',
                project: './tsconfig.json'
            },
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                module: 'readonly',
                require: 'readonly',
                exports: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                Promise: 'readonly',
                Error: 'readonly',
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                location: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                crypto: 'readonly',
                WebSocket: 'readonly',
                Event: 'readonly',
                MessageEvent: 'readonly',
                CloseEvent: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                btoa: 'readonly',
                atob: 'readonly',
                screen: 'readonly'
            }
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            'prettier': prettierPlugin
        },
        rules: {
            // TypeScript ルール
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],

            // 一般ルール
            'no-console': ['warn', {
                allow: ['warn', 'error', 'info']
            }],
            'no-debugger': 'error',
            'no-alert': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'eqeqeq': ['error', 'always'],
            'curly': ['error', 'all'],

            // Prettier
            'prettier/prettier': 'error'
        }
    },
    {
        files: ['electron/**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2020,
                sourceType: 'module',
                project: './tsconfig.electron.json'
            },
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                module: 'readonly',
                require: 'readonly',
                exports: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                Promise: 'readonly',
                Error: 'readonly'
            }
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            'prettier': prettierPlugin
        },
        rules: {
            // TypeScript ルール
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],

            // 一般ルール
            'no-console': 'off',
            'no-debugger': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'eqeqeq': ['error', 'always'],
            'curly': ['error', 'all'],

            // Prettier
            'prettier/prettier': 'error'
        }
    },
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'coverage/**',
            '*.config.js',
            'tests/**',
            'eslint.config.js',
            'jest.config.js'
        ]
    }
];

