@echo off
cd /d %~dp0
echo Running all tests...
npx jest --no-coverage --no-watchman --verbose > test-output.txt 2>&1
echo Test run complete. Check test-output.txt for results.
type test-output.txt
