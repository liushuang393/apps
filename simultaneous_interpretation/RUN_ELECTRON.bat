@echo off
REM Electronアプリケーション起動スクリプト
REM 
REM 目的:
REM   VoiceTranslate Pro Electronアプリを開発モードで起動
REM 
REM 前提条件:
REM   - Node.js がインストール済み
REM   - npm install 実行済み
REM   - npm run build:electron 実行済み
REM 
REM 使用方法:
REM   ダブルクリックまたは: RUN_ELECTRON.bat

echo ===============================================
echo VoiceTranslate Pro - Electron起動
echo ===============================================
echo.

REM カレントディレクトリを確認
cd /d "%~dp0"
echo カレントディレクトリ: %CD%
echo.

REM Node.js確認
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [エラー] Node.jsが見つかりません
    echo Node.jsをインストールしてください: https://nodejs.org/
    pause
    exit /b 1
)

REM 依存関係確認
if not exist "node_modules\" (
    echo [警告] node_modulesが見つかりません
    echo npm installを実行します...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [エラー] npm install失敗
        pause
        exit /b 1
    )
)

REM ビルド確認
if not exist "dist\electron\main.js" (
    echo [警告] ビルドファイルが見つかりません
    echo npm run build:electronを実行します...
    call npm run build:electron
    if %ERRORLEVEL% NEQ 0 (
        echo [エラー] ビルド失敗
        pause
        exit /b 1
    )
)

REM Electronアプリ起動
echo Electronアプリを起動中...
echo.
set NODE_ENV=development
call npm run electron

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [エラー] Electron起動失敗
    pause
    exit /b 1
)

echo.
echo ===============================================
echo Electronアプリを終了しました
echo ===============================================
pause

