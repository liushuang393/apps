@echo off
chcp 932 >nul
setlocal

REM ============================================================
REM  VoiceTranslate Pro - ローカルアプリ(Electron) 一括起動
REM  使い方: このファイルをダブルクリックするだけ
REM    1. Node.js の有無を確認
REM    2. 初回のみ npm install
REM    3. Electron(TypeScript) をビルド
REM    4. アプリを起動
REM ============================================================

cd /d "%~dp0"
echo ============================================
echo   VoiceTranslate Pro  ローカル起動
echo ============================================
echo.

REM --- 1) Node.js 確認 ---
where node >nul 2>nul
if errorlevel 1 (
    echo [エラー] Node.js が見つかりません。
    echo         https://nodejs.org/ から LTS 版をインストールしてください。
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo [OK] Node.js %%v

REM --- 2) 依存インストール（node_modules が無い時だけ） ---
if not exist "node_modules" (
    echo.
    echo [1/3] 依存パッケージをインストール中... ^(初回のみ・数分かかります^)
    call npm install
    if errorlevel 1 (
        echo [エラー] npm install に失敗しました。
        pause
        exit /b 1
    )
) else (
    echo [1/3] 依存パッケージは導入済み ^(スキップ^)
)

REM --- 3) .env 確認（APIキー）---
if not exist ".env" (
    echo.
    echo [注意] .env が見つかりません。
    echo        .env.example をコピーして OPENAI_API_KEY を設定してください:
    echo            copy .env.example .env
    echo        ^(未設定でも起動はしますが、画面でAPIキー入力が必要です^)
    echo.
)

REM --- 4) Electron(main/preload) をビルド ---
echo.
echo [2/3] Electron をビルド中...
call npm run build:electron
if errorlevel 1 (
    echo [エラー] ビルドに失敗しました。上のログを確認してください。
    pause
    exit /b 1
)

REM --- 5) 起動 ---
echo.
echo [3/3] アプリを起動します...
echo.
call npm run electron:run

endlocal
