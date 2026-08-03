@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-verify.ps1"
if errorlevel 1 (
  echo.
  echo Local verify failed. Check reports\local-verify.log.
  pause
  exit /b 1
)
echo.
echo Local verify completed: reports\local-verify.json
pause
endlocal
