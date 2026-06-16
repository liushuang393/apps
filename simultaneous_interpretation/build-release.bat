@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  VoiceTranslate Pro - 本番リリース ビルド自動化
REM  生成物:
REM    1) release\        : Windowsインストーラ(.exe/nsis) ＋ portable版
REM    2) *-extension.zip : Chrome拡張アップロード用zip
REM
REM  実行前提:
REM    - Node.js / npm 導入済み
REM    - .env に本番用 OPENAI_API_KEY 等を設定済み
REM    - manifest.json / package.json の version を更新済み
REM  詳しい手順は docs\RELEASE_GUIDE.md を参照
REM ============================================================

cd /d "%~dp0"
echo ============================================
echo   VoiceTranslate Pro  リリースビルド
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [エラー] Node.js が見つかりません。中止します。
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [0/4] 依存パッケージをインストール中...
    call npm install || goto :fail
)

echo.
echo [1/4] 品質ゲート（型チェック/lint/format/拡張チェック）...
call npm run quality || goto :fail

echo.
echo [2/4] 全コードビルド（core / electron / extension）...
call npm run build:all || goto :fail

echo.
echo [3/4] Windowsインストーラを作成中... ^(release\ に出力^)
call npm run dist:win || goto :fail

echo.
echo [4/4] Chrome拡張パッケージ(zip)を作成中...
call npm run pack:extension || goto :fail

echo.
echo ============================================
echo   ✅ リリースビルド完了
echo ============================================
echo   - Windowsインストーラ : release\ フォルダ
echo   - Chrome拡張zip       : ルートに生成された *-extension.zip
echo.
echo   次の手順は docs\RELEASE_GUIDE.md を参照してください。
echo.
pause
endlocal
exit /b 0

:fail
echo.
echo [エラー] ビルドが失敗しました。上のログを確認してください。
echo.
pause
endlocal
exit /b 1
