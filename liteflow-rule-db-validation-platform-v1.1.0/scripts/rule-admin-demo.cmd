@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rule-admin-demo.ps1" %*
if errorlevel 1 (
  echo.
  echo Rule administration demo failed. See reports\rule-admin-demo.json
  pause
  exit /b 1
)
echo.
echo Rule administration demo completed: reports\rule-admin-demo.json
pause
endlocal
