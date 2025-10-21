@echo off
REM Electron設定ファイル削除スクリプト
REM 
REM 目的:
REM   保存された設定ファイルを削除してデフォルト設定に戻す
REM 
REM 使用方法:
REM   ダブルクリックまたは: RESET_CONFIG.bat

echo ===============================================
echo VoiceTranslate Pro - 設定リセット
echo ===============================================
echo.

REM 設定ファイルの場所
set CONFIG_DIR=%APPDATA%\VoiceTranslate Pro
set CONFIG_FILE=%CONFIG_DIR%\config.json
set CONFIG_DIR2=%APPDATA%\app2
set CONFIG_FILE2=%CONFIG_DIR2%\config.json

echo 設定ファイルを削除します...
echo.

REM VoiceTranslate Pro設定を削除
if exist "%CONFIG_FILE%" (
    echo [削除] %CONFIG_FILE%
    del "%CONFIG_FILE%"
    echo ✓ 削除完了
) else (
    echo [スキップ] %CONFIG_FILE% が見つかりません
)

echo.

REM app2設定を削除（念のため）
if exist "%CONFIG_FILE2%" (
    echo [削除] %CONFIG_FILE2%
    del "%CONFIG_FILE2%"
    echo ✓ 削除完了
) else (
    echo [スキップ] %CONFIG_FILE2% が見つかりません
)

echo.
echo ===============================================
echo 設定リセット完了
echo 次回起動時にデフォルト設定が適用されます
echo ===============================================
echo.
echo Electronアプリを再起動してください
pause

