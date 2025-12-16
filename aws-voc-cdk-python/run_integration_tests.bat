@echo off
REM 目的: 統合テストを実行するスクリプト（Windows版）
REM 使用方法: run_integration_tests.bat [options]

setlocal enabledelayedexpansion

REM デフォルト設定
set VERBOSE=false
set REPORT=false
set SPECIFIC_TEST=
set CLEANUP=true

REM ロゴ表示
echo.
echo ===============================================================
echo.
echo        AWS VOC CDK - Integration Test Runner (Windows)
echo.
echo ===============================================================
echo.

REM 引数解析
:parse_args
if "%~1"=="" goto check_prereqs
if /i "%~1"=="-h" goto show_help
if /i "%~1"=="--help" goto show_help
if /i "%~1"=="-v" (
    set VERBOSE=true
    shift
    goto parse_args
)
if /i "%~1"=="--verbose" (
    set VERBOSE=true
    shift
    goto parse_args
)
if /i "%~1"=="-r" (
    set REPORT=true
    shift
    goto parse_args
)
if /i "%~1"=="--report" (
    set REPORT=true
    shift
    goto parse_args
)
if /i "%~1"=="-t" (
    set SPECIFIC_TEST=%~2
    shift
    shift
    goto parse_args
)
if /i "%~1"=="--test" (
    set SPECIFIC_TEST=%~2
    shift
    shift
    goto parse_args
)
if /i "%~1"=="--no-cleanup" (
    set CLEANUP=false
    shift
    goto parse_args
)
echo エラー: 不明なオプション: %~1
goto show_help

:show_help
echo 使用方法: %~nx0 [options]
echo.
echo オプション:
echo   -h, --help              このヘルプメッセージを表示
echo   -v, --verbose           詳細ログを表示
echo   -r, --report            HTMLレポートを生成
echo   -t, --test TEST_NAME    特定のテストのみ実行
echo   --no-cleanup            テスト後のクリーンアップをスキップ
echo.
echo 例:
echo   %~nx0                      # すべての統合テストを実行
echo   %~nx0 -v -r                # 詳細ログとHTMLレポート付きで実行
echo   %~nx0 -t test_s3_buckets_exist  # 特定のテストのみ実行
exit /b 0

:check_prereqs
echo [1/5] 前提条件をチェック中...

REM Python環境チェック
python --version >nul 2>&1
if errorlevel 1 (
    echo エラー: Pythonがインストールされていません
    exit /b 1
)

REM AWS CLIチェック
aws --version >nul 2>&1
if errorlevel 1 (
    echo エラー: AWS CLIがインストールされていません
    exit /b 1
)

REM AWS認証情報チェック
aws sts get-caller-identity >nul 2>&1
if errorlevel 1 (
    echo エラー: AWS認証情報が設定されていません
    echo 以下のコマンドで設定してください:
    echo   aws configure
    exit /b 1
)

echo [OK] 前提条件OK
echo.

REM 依存関係インストール
echo [2/5] 依存関係をインストール中...
pip install -q -r requirements-dev.txt
if errorlevel 1 (
    echo エラー: 依存関係のインストールに失敗しました
    exit /b 1
)
echo [OK] 依存関係インストール完了
echo.

REM AWS環境確認
echo [3/5] AWS環境を確認中...

REM 設定ファイル確認
if not exist "config\config.yaml" (
    echo エラー: config\config.yaml が見つかりません
    exit /b 1
)

REM プレフィックスとリージョンを取得
for /f "delims=" %%i in ('python -c "import yaml; print(yaml.safe_load(open('config/config.yaml'))['project']['prefix'])"') do set PREFIX=%%i
for /f "delims=" %%i in ('python -c "import yaml; print(yaml.safe_load(open('config/config.yaml'))['project']['region'])"') do set REGION=%%i

echo   プレフィックス: %PREFIX%
echo   リージョン: %REGION%

REM S3バケット確認
for /f %%i in ('aws s3 ls ^| find /c "%PREFIX%"') do set BUCKET_COUNT=%%i
if "%BUCKET_COUNT%"=="0" (
    echo エラー: S3バケットが見つかりません
    echo 以下のコマンドでデプロイしてください:
    echo   cdk deploy --all
    exit /b 1
)

echo [OK] AWS環境OK ^(S3バケット: %BUCKET_COUNT%個^)
echo.

REM テスト実行前のクリーンアップ
if "%CLEANUP%"=="true" (
    echo [4/5] テスト前のクリーンアップ中...
    aws s3 rm "s3://%PREFIX%-raw-apne1/inbox/" --recursive --exclude "*" --include "test_*" --quiet 2>nul
    echo [OK] クリーンアップ完了
) else (
    echo [4/5] クリーンアップをスキップ
)
echo.

REM テスト実行
echo [5/5] 統合テストを実行中...
echo.

REM pytestコマンド構築
set PYTEST_CMD=pytest tests/integration/

if not "%SPECIFIC_TEST%"=="" (
    set PYTEST_CMD=!PYTEST_CMD!::%SPECIFIC_TEST%
)

set PYTEST_CMD=!PYTEST_CMD! -m integration

if "%VERBOSE%"=="true" (
    set PYTEST_CMD=!PYTEST_CMD! -v -s
) else (
    set PYTEST_CMD=!PYTEST_CMD! -v
)

if "%REPORT%"=="true" (
    set PYTEST_CMD=!PYTEST_CMD! --html=integration_report.html --self-contained-html
)

echo 実行コマンド: !PYTEST_CMD!
echo.

REM テスト実行
!PYTEST_CMD!
if errorlevel 1 (
    echo.
    echo ===============================================================
    echo.
    echo              [X] テストが失敗しました
    echo.
    echo ===============================================================
    echo.
    echo トラブルシューティング:
    echo   1. TROUBLESHOOTING.md を参照
    echo   2. CloudWatch Logsを確認
    echo   3. Step Functions実行履歴を確認
    echo.
    echo 詳細ログを表示:
    echo   %~nx0 -v
    exit /b 1
)

echo.
echo ===============================================================
echo.
echo              [OK] すべてのテストが成功しました！
echo.
echo ===============================================================

if "%REPORT%"=="true" (
    echo.
    echo HTMLレポートが生成されました: integration_report.html
)

exit /b 0

