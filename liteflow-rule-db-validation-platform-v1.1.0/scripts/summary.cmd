@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0summary.ps1" %*
echo.
echo Summary written: reports\summary.md
pause
endlocal
