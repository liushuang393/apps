@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-all.ps1"
if errorlevel 1 (
  echo.
  echo Validation failed. The window will stay open.
  echo Check reports\run-all-failure.txt, reports\install.log, and reports\validation-run.log.
  pause
  exit /b 1
)
echo.
echo Validation completed.
echo Open reports\validation-report.md
pause
endlocal
