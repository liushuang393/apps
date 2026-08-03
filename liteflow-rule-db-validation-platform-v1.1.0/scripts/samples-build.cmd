@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0samples-build.ps1" %*
if errorlevel 1 (
  echo.
  echo Sample projects build failed. See reports\samples-build-failure.txt
  pause
  exit /b 1
)
echo.
echo Sample projects built and verified: reports\samples-build.json
pause
endlocal
