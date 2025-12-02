@echo off
cd /d %~dp0
echo Running tests...
npx jest --no-coverage --no-watchman > test-output.txt 2>&1
type test-output.txt
echo.
echo Test output saved to test-output.txt
