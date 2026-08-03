@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preflight.ps1"
if errorlevel 1 (
  echo.
  echo Preflight failed. See reports\preflight-report.md when available.
  pause
  exit /b 1
)
echo.
echo Preflight completed: reports\preflight-report.md
pause
endlocal
