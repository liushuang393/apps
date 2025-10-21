@echo off
REM VoiceTranslate Pro 起動スクリプト (Batch)
REM UTF-8エンコーディングで起動

chcp 65001 >nul 2>&1

echo ==================================
echo VoiceTranslate Pro 起動中...
echo ==================================
echo.

npm run electron:dev

