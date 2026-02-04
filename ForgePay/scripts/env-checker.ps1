<#
.SYNOPSIS
    汎用環境チェック・自動修復スクリプト (設定ファイル駆動)
.DESCRIPTION
    test.config.json から設定を読み込み、開発環境の問題を検出・修復
    他のプロジェクトで再利用する場合は test.config.json を編集するだけでOK
.PARAMETER Fix
    検出した問題を自動修復
.PARAMETER Lang
    言語設定 (ja/en, デフォルト: ja)
.EXAMPLE
    .\scripts\env-checker.ps1
    .\scripts\env-checker.ps1 -Fix
    .\scripts\env-checker.ps1 -Fix -Lang en
#>

param(
    [switch]$Fix,
    [string]$Lang = "ja"
)

# ============================================
# 設定ファイル読み込み
# ============================================
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir "test.config.json"

if (-not (Test-Path $configPath)) {
    Write-Host "[ERROR] test.config.json not found at: $configPath" -ForegroundColor Red
    exit 1
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json

# 問題リスト
$script:fixable = @()
$script:issues = @()

# ============================================
# ユーティリティ関数
# ============================================
function Write-Check { 
    param($name, $status, $detail, $fixCommand)
    if ($status) {
        Write-Host "  [OK] $name" -ForegroundColor Green -NoNewline
        if ($detail) { Write-Host " - $detail" -ForegroundColor Gray }
        else { Write-Host "" }
    } else {
        Write-Host "  [NG] $name" -ForegroundColor Red -NoNewline
        if ($detail) { Write-Host " - $detail" -ForegroundColor Yellow }
        else { Write-Host "" }
        
        if ($fixCommand) {
            $script:fixable += [PSCustomObject]@{ Name = $name; Command = $fixCommand; Detail = $detail }
        } else {
            $script:issues += [PSCustomObject]@{ Name = $name; Detail = $detail }
        }
    }
    return $status
}

function Test-TcpPort {
    param([int]$Port)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $Port)
        $connected = $tcp.Connected
        $tcp.Close()
        return $connected
    } catch { return $false }
}

# ============================================
# ヘッダー表示
# ============================================
$projectName = $config.project.name

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "    $projectName Environment Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# 1. 必須ソフトウェア
# ============================================
Write-Host "Required Software:" -ForegroundColor White

# Node.js
$nodeVersion = node --version 2>$null
$nodeOk = $false
if ($nodeVersion -match "v(\d+)") {
    $nodeOk = [int]$Matches[1] -ge $config.requirements.nodeVersion
}
Write-Check "Node.js ($($config.requirements.nodeVersion)+)" $nodeOk $nodeVersion | Out-Null

if (-not $nodeOk -and $nodeVersion) {
    $script:issues += [PSCustomObject]@{ 
        Name = "Node.js Version"
        Detail = "Node.js $($config.requirements.nodeVersion)+ required. Download from https://nodejs.org/"
    }
}

# npm
$npmVersion = npm --version 2>$null
$npmOk = $null -ne $npmVersion
Write-Check "npm" $npmOk "v$npmVersion" | Out-Null

# Docker (必要な場合)
if ($config.requirements.dockerRequired) {
    $dockerVersion = docker --version 2>$null
    $dockerOk = $null -ne $dockerVersion
    Write-Check "Docker" $dockerOk ($dockerVersion -replace "Docker version ", "") | Out-Null

    if (-not $dockerOk) {
        $script:issues += [PSCustomObject]@{ 
            Name = "Docker"
            Detail = "Install Docker Desktop: https://www.docker.com/products/docker-desktop"
        }
    }

    # Docker running
    $dockerRunning = docker info 2>$null
    $dockerRunningOk = $null -ne $dockerRunning
    Write-Check "Docker Running" $dockerRunningOk $null "Start Docker Desktop" | Out-Null
}

Write-Host ""

# ============================================
# 2. プロジェクト依存関係
# ============================================
Write-Host "Project Dependencies:" -ForegroundColor White

# node_modules
$nodeModulesOk = Test-Path $config.paths.nodeModules
Write-Check "npm packages" $nodeModulesOk $config.paths.nodeModules $config.scripts.install | Out-Null

# dashboard node_modules
$dashboardModulesOk = Test-Path $config.paths.dashboardModules
Write-Check "Dashboard packages" $dashboardModulesOk $config.paths.dashboardModules $config.scripts.installDashboard | Out-Null

# Playwright browsers
$playwrightPath = $ExecutionContext.InvokeCommand.ExpandString($config.paths.playwrightBrowsers)
$chromiumExists = $false
if (Test-Path $playwrightPath) {
    $chromiumDirs = Get-ChildItem -Path $playwrightPath -Filter "chromium-*" -Directory -ErrorAction SilentlyContinue
    $chromiumExists = $null -ne $chromiumDirs
}
Write-Check "Playwright browsers" $chromiumExists $playwrightPath $config.scripts.playwrightInstall | Out-Null

Write-Host ""

# ============================================
# 3. Docker サービス
# ============================================
if ($config.requirements.dockerRequired) {
    Write-Host "Docker Services:" -ForegroundColor White

    # PostgreSQL
    $pgContainer = $config.docker.postgres.containerName
    $pgRunning = docker ps --filter "name=$pgContainer" --filter "status=running" --format "{{.Names}}" 2>$null
    $pgOk = $pgRunning -eq $pgContainer
    Write-Check "PostgreSQL" $pgOk $pgContainer $config.scripts.dockerUp | Out-Null

    # Redis
    $redisContainer = $config.docker.redis.containerName
    $redisRunning = docker ps --filter "name=$redisContainer" --filter "status=running" --format "{{.Names}}" 2>$null
    $redisOk = $redisRunning -eq $redisContainer
    Write-Check "Redis" $redisOk $redisContainer $config.scripts.dockerUp | Out-Null

    Write-Host ""
}

# ============================================
# 4. アプリケーションサーバー
# ============================================
Write-Host "Application Servers:" -ForegroundColor White

# Backend
$backendPort = $config.ports.backend
$backendOk = Test-TcpPort -Port $backendPort
Write-Check "Backend API" $backendOk $config.endpoints.backendBase $config.scripts.dev | Out-Null

# Dashboard
$dashboardPort = $config.ports.dashboard
$dashboardOk = Test-TcpPort -Port $dashboardPort
Write-Check "Dashboard" $dashboardOk $config.endpoints.dashboardBase $config.scripts.devDashboard | Out-Null

Write-Host ""

# ============================================
# 5. 設定ファイル
# ============================================
Write-Host "Configuration:" -ForegroundColor White

# .env
$envFile = $config.environment.envFile
$envExists = Test-Path $envFile
$envExample = $config.environment.envExample
Write-Check ".env file" $envExists $null "cp $envExample $envFile" | Out-Null

$stripeKeyOk = $false
$testApiKeyOk = $false
$dbUrlOk = $false
$redisUrlOk = $false

if ($envExists) {
    $envContent = Get-Content $envFile -Raw
    
    # Stripe test key
    $stripeKeyPattern = $config.environment.requiredPatterns.stripeTestKey
    $stripeKeyOk = $envContent -match $stripeKeyPattern
    Write-Check "Stripe Test Key" $stripeKeyOk | Out-Null
    
    if (-not $stripeKeyOk) {
        $script:issues += [PSCustomObject]@{ 
            Name = "Stripe Test Key"
            Detail = "Set STRIPE_TEST_SECRET_KEY in .env. Get from https://dashboard.stripe.com/test/apikeys"
        }
    }
    
    # TEST_API_KEY
    $testApiKeyPattern = $config.environment.requiredPatterns.testApiKey
    $testApiKeyOk = $envContent -match $testApiKeyPattern
    Write-Check "TEST_API_KEY" $testApiKeyOk $null $config.scripts.setupTestDeveloper | Out-Null
    
    # DATABASE_URL
    $dbUrlPattern = $config.environment.requiredPatterns.databaseUrl
    $dbUrlOk = $envContent -match $dbUrlPattern
    Write-Check "DATABASE_URL" $dbUrlOk | Out-Null
    
    # REDIS_URL
    $redisUrlPattern = $config.environment.requiredPatterns.redisUrl
    $redisUrlOk = $envContent -match $redisUrlPattern
    Write-Check "REDIS_URL" $redisUrlOk | Out-Null
}

Write-Host ""

# ============================================
# 6. テスト準備状況
# ============================================
Write-Host "Test Readiness:" -ForegroundColor White

$unitTestReady = $nodeModulesOk
Write-Check "Unit Tests" $unitTestReady $config.scripts.testUnit | Out-Null

$e2eApiReady = $pgOk -and $redisOk -and $backendOk -and $testApiKeyOk
Write-Check "E2E API Tests" $e2eApiReady $config.scripts.testE2eApi | Out-Null

$playwrightReady = $e2eApiReady -and $dashboardOk -and $chromiumExists
Write-Check "Playwright UI Tests" $playwrightReady $config.scripts.testPlaywright | Out-Null

Write-Host ""

# ============================================
# サマリーと修復
# ============================================
Write-Host "========================================" -ForegroundColor Cyan

if ($script:fixable.Count -eq 0 -and $script:issues.Count -eq 0) {
    Write-Host "  All checks passed!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Test Commands:" -ForegroundColor Cyan
    Write-Host "  .\scripts\test-runner.ps1 -Unit       # Unit tests"
    Write-Host "  .\scripts\test-runner.ps1 -E2E        # E2E API tests"
    Write-Host "  .\scripts\test-runner.ps1 -Playwright # Playwright tests"
    Write-Host ""
    exit 0
}

Write-Host "  Issues detected" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 自動修復可能
if ($script:fixable.Count -gt 0) {
    Write-Host "Auto-fixable issues ($($script:fixable.Count)):" -ForegroundColor Yellow
    foreach ($item in $script:fixable) {
        Write-Host "  - $($item.Name)" -ForegroundColor White
        Write-Host "    Fix: " -NoNewline -ForegroundColor Gray
        Write-Host "$($item.Command)" -ForegroundColor Cyan
    }
    Write-Host ""
    
    if ($Fix) {
        Write-Host "Running auto-fix..." -ForegroundColor Cyan
        Write-Host ""
        
        foreach ($item in $script:fixable) {
            Write-Host "[Fix] $($item.Name)..." -ForegroundColor Yellow
            
            try {
                Invoke-Expression $item.Command
                Write-Host "  [OK] Fixed" -ForegroundColor Green
            } catch {
                Write-Host "  [NG] Failed: $_" -ForegroundColor Red
            }
        }
        Write-Host ""
        Write-Host "Run check again: .\scripts\env-checker.ps1" -ForegroundColor Cyan
    } else {
        Write-Host "Run with -Fix to auto-fix: " -NoNewline -ForegroundColor Gray
        Write-Host ".\scripts\env-checker.ps1 -Fix" -ForegroundColor Cyan
        Write-Host ""
    }
}

# 手動修復必要
if ($script:issues.Count -gt 0) {
    Write-Host "Manual fix required ($($script:issues.Count)):" -ForegroundColor Red
    foreach ($item in $script:issues) {
        Write-Host "  - $($item.Name)" -ForegroundColor White
        Write-Host "    $($item.Detail)" -ForegroundColor Yellow
    }
    Write-Host ""
}

# トラブルシューティング
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Troubleshooting" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$pgContainer = $config.docker.postgres.containerName
$backendPort = $config.ports.backend
$dashboardPort = $config.ports.dashboard

Write-Host "Q: Docker services won't start" -ForegroundColor White
Write-Host "A: Start Docker Desktop, then run:" -ForegroundColor Gray
Write-Host "   $($config.scripts.dockerDown); $($config.scripts.dockerUp)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Q: Port in use ($backendPort/$dashboardPort)" -ForegroundColor White
Write-Host "A: Find and kill the process:" -ForegroundColor Gray
Write-Host "   netstat -ano | findstr :$backendPort" -ForegroundColor Cyan
Write-Host "   taskkill /PID <PID> /F" -ForegroundColor Cyan
Write-Host ""
Write-Host "Q: TEST_API_KEY not working" -ForegroundColor White
Write-Host "A: Recreate test developer:" -ForegroundColor Gray
Write-Host "   docker exec $pgContainer psql -U postgres -d forgepaybridge -c `"DELETE FROM developers WHERE email = 'e2e-test@forgepay.io';`"" -ForegroundColor Cyan
Write-Host "   $($config.scripts.setupTestDeveloper)" -ForegroundColor Cyan
Write-Host ""
