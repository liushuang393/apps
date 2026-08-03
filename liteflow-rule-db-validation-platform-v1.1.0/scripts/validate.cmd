@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0validate.ps1"
if errorlevel 1 (
  echo.
  echo Validation failed. Check reports\validation-run.log and reports\validation-report.md.
  pause
  exit /b 1
)
endlocal
