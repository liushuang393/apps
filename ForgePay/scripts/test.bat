@echo off
REM Quick test runner wrapper
REM Usage: scripts\test.bat [unit|e2e|playwright|all]

setlocal

if "%1"=="" goto all
if "%1"=="unit" goto unit
if "%1"=="e2e" goto e2e
if "%1"=="playwright" goto playwright
if "%1"=="setup" goto setup
if "%1"=="check" goto check
goto help

:all
powershell -ExecutionPolicy Bypass -File "%~dp0test-runner.ps1" -All
goto end

:unit
powershell -ExecutionPolicy Bypass -File "%~dp0test-runner.ps1" -Unit
goto end

:e2e
powershell -ExecutionPolicy Bypass -File "%~dp0test-runner.ps1" -E2E
goto end

:playwright
powershell -ExecutionPolicy Bypass -File "%~dp0test-runner.ps1" -Playwright
goto end

:setup
powershell -ExecutionPolicy Bypass -File "%~dp0test-runner.ps1" -Setup
goto end

:check
powershell -ExecutionPolicy Bypass -File "%~dp0env-checker.ps1"
goto end

:help
echo.
echo Test Runner Quick Commands
echo ==========================
echo   scripts\test.bat          - Run all tests
echo   scripts\test.bat unit     - Run unit tests only
echo   scripts\test.bat e2e      - Run E2E API tests only
echo   scripts\test.bat playwright - Run Playwright tests only
echo   scripts\test.bat setup    - Setup environment only
echo   scripts\test.bat check    - Check environment status
echo.

:end
endlocal
