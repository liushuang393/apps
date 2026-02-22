@echo off
:: git-sync.bat - stash, pull origin/main, then restore local changes

echo ========================================
echo  Git Sync: pull origin/main
echo ========================================

:: Check for local changes
git diff --quiet 2>nul
set DIFF=%errorlevel%
git diff --cached --quiet 2>nul
set CACHED=%errorlevel%

set STASHED=0
if %DIFF% neq 0 goto DO_STASH
if %CACHED% neq 0 goto DO_STASH
goto PULL

:DO_STASH
echo [1/3] Stashing local changes...
git stash push -m "auto-sync: pre-pull stash"
if %errorlevel% neq 0 (
    echo [ERROR] git stash failed
    pause
    exit /b 1
)
set STASHED=1

:PULL
echo [2/3] Pulling origin/main...
git pull origin main
if %errorlevel% neq 0 (
    echo [ERROR] git pull failed
    if %STASHED%==1 git stash pop
    pause
    exit /b 1
)

:POP
if %STASHED%==0 goto DONE
echo [3/3] Restoring local changes...
git stash pop
if %errorlevel% neq 0 (
    echo.
    echo [CONFLICT] Resolve the following files manually:
    git diff --name-only --diff-filter=U
    echo.
    echo After resolving: git add . ^&^& git stash drop
    pause
    exit /b 1
)

:DONE
echo.
echo [OK] Sync complete
echo.
git log --oneline -3
pause

