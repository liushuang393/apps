# Flutter Web 開発モード起動スクリプト
# 目的: 熱リロード（Hot Reload）対応の Web 開発サーバーを起動
# 使用方法: .\scripts\run-web-dev.ps1

param(
    [int]$Port = 8888,
    [switch]$Release = $false
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Flutter Web 開発サーバー起動" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 作業ディレクトリを mobile に移動
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$mobilePath = Split-Path -Parent $scriptPath
Set-Location $mobilePath

Write-Host "`n[1/3] 環境チェック..." -ForegroundColor Yellow

# Flutter がインストールされているか確認
$flutterVersion = flutter --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Flutter がインストールされていません" -ForegroundColor Red
    exit 1
}
Write-Host "  Flutter: OK" -ForegroundColor Green

# .env ファイルが存在するか確認
if (-not (Test-Path ".env")) {
    if (Test-Path "example.env") {
        Write-Host "  .env ファイルが見つかりません。example.env からコピーします..." -ForegroundColor Yellow
        Copy-Item "example.env" ".env"
        Write-Host "  .env ファイルを作成しました。必要に応じて編集してください。" -ForegroundColor Green
    } else {
        Write-Host "WARNING: .env ファイルが見つかりません" -ForegroundColor Yellow
    }
} else {
    Write-Host "  .env: OK" -ForegroundColor Green
}

Write-Host "`n[2/3] 依存関係を取得中..." -ForegroundColor Yellow
flutter pub get
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: flutter pub get に失敗しました" -ForegroundColor Red
    exit 1
}
Write-Host "  依存関係: OK" -ForegroundColor Green

Write-Host "`n[3/3] Web サーバーを起動中..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Hot Reload 使用方法:" -ForegroundColor White
Write-Host "  - r キー: Hot Reload（状態保持）" -ForegroundColor Gray
Write-Host "  - R キー: Hot Restart（状態リセット）" -ForegroundColor Gray
Write-Host "  - q キー: 終了" -ForegroundColor Gray
Write-Host "  - h キー: ヘルプ表示" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($Release) {
    Write-Host "リリースモードで起動します..." -ForegroundColor Yellow
    flutter run -d chrome --web-port=$Port --release
} else {
    Write-Host "開発モード（Hot Reload 有効）で起動します..." -ForegroundColor Green
    Write-Host "URL: http://localhost:$Port" -ForegroundColor Cyan
    Write-Host ""
    
    # 開発モードで起動（Hot Reload 有効）
    flutter run -d chrome --web-port=$Port --web-renderer=html
}

