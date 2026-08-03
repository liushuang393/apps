@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0corpus-run.ps1" %*
if errorlevel 1 (
  echo.
  echo Corpus run reported unexpected results. See reports\corpus-report.md.
  pause
  exit /b 1
)
echo.
echo Corpus run completed: reports\corpus-report.md
pause
endlocal
