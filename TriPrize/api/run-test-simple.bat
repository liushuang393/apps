@echo off
cd /d %~dp0
echo Running Jest tests...
call npx jest --no-coverage --no-watchman --verbose 2>&1 | findstr /V "^$"
echo.
echo Test execution completed.
