<#
.SYNOPSIS
    汎用テストランナースクリプト (設定ファイル駆動)
.DESCRIPTION
    test.config.json から設定を読み込み、プロジェクトに依存しない汎用テストを実行
    他のプロジェクトで再利用する場合は test.config.json を編集するだけでOK
.PARAMETER Setup
    環境準備のみ実行
.PARAMETER Unit
    単体テストのみ実行
.PARAMETER E2E
    E2E API テストのみ実行
.PARAMETER Playwright
    Playwright UI テストのみ実行
.PARAMETER All
    全テスト実行（デフォルト）
.PARAMETER Lang
    言語設定 (ja/en, デフォルト: ja)
.PARAMETER Help
    ヘルプ表示
.EXAMPLE
    .\scripts\test-runner.ps1 -Setup
    .\scripts\test-runner.ps1 -Unit
    .\scripts\test-runner.ps1 -All -Lang en
#>

param(
    [switch]$Setup,
    [switch]$Unit,
    [switch]$E2E,
    [switch]$Playwright,
    [switch]$All,
    [string]$Lang = "ja",
    [switch]$Help
)

# ============================================
# 設定ファイル読み込み
# ============================================
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir "test.config.json"

if (-not (Test-Path $configPath)) {
    Write-Host "[ERROR] test.config.json not found at: $configPath" -ForegroundColor Red
    Write-Host "Create test.config.json with project-specific settings." -ForegroundColor Yellow
    exit 1
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
$msg = $config.messages.$Lang
if (-not $msg) { $msg = $config.messages.ja }

# ============================================
# ユーティリティ関数
# ============================================
function Write-Status { param($text) Write-Host "[*] $text" -ForegroundColor Cyan }
function Write-Success { param($text) Write-Host "[OK] $text" -ForegroundColor Green }
function Write-Err { param($text) Write-Host "[NG] $text" -ForegroundColor Red }
function Write-Warn { param($text) Write-Host "[!] $text" -ForegroundColor Yellow }

function Test-TcpPort {
    param([int]$Port, [int]$Timeout = 2)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $task = $tcp.ConnectAsync("127.0.0.1", $Port)
        $task.Wait($Timeout * 1000) | Out-Null
        $connected = $tcp.Connected
        $tcp.Close()
        return $connected
    } catch { return $false }
}

function Test-HttpEndpoint {
    param([string]$Url, [int]$Timeout = 2)
    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec $Timeout -ErrorAction SilentlyContinue
        return $response.StatusCode -eq 200
    } catch { return $false }
}

function Wait-ForService {
    param([scriptblock]$Check, [int]$MaxRetries, [string]$ServiceName)
    $retries = 0
    while ($retries -lt $MaxRetries) {
        if (& $Check) { return $true }
        Start-Sleep -Seconds 1
        $retries++
    }
    return $false
}

# ============================================
# ヘルプ表示
# ============================================
if ($Help) {
    $projectName = $config.project.name
    Write-Host @"
$projectName テストスクリプト (設定ファイル駆動)
==========================================
使用方法: .\scripts\test-runner.ps1 [オプション]

オプション:
  -Setup      環境準備のみ実行 (Docker, DB マイグレーション)
  -Unit       単体テストのみ実行
  -E2E        E2E API テストのみ実行
  -Playwright Playwright UI テストのみ実行
  -All        全テスト実行 (デフォルト)
  -Lang       言語設定 (ja/en)
  -Help       このヘルプを表示

設定ファイル: scripts/test.config.json

例:
  .\scripts\test-runner.ps1 -Setup      # 環境準備
  .\scripts\test-runner.ps1 -Unit       # 単体テスト
  .\scripts\test-runner.ps1 -E2E        # E2E API テスト
  .\scripts\test-runner.ps1 -Lang en    # 英語で全テスト
"@
    exit 0
}

# デフォルトは全テスト
if (-not ($Setup -or $Unit -or $E2E -or $Playwright)) { $All = $true }

$ErrorActionPreference = "Continue"
$StartTime = Get-Date
$projectName = $config.project.name

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "    $projectName $($msg.title)" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

# ============================================
# 1. 環境チェック（自動修復付き）
# ============================================
Write-Status $msg.envCheck

# Node.js チェック
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Err $msg.nodeNotFound
    Write-Host ""
    Write-Host "Solution:" -ForegroundColor Yellow
    Write-Host "  1. Download Node.js $($config.requirements.nodeVersion)+ from https://nodejs.org/"
    Write-Host "  2. Restart terminal after installation"
    exit 1
}
$nodeVersionNum = [int]($nodeVersion -replace 'v(\d+).*', '$1')
if ($nodeVersionNum -lt $config.requirements.nodeVersion) {
    Write-Err "$($msg.nodeOld) ($nodeVersion < v$($config.requirements.nodeVersion))"
    exit 1
}
Write-Success "Node.js: $nodeVersion"

# Docker チェック（必要な場合）
if ($config.requirements.dockerRequired) {
    $dockerVersion = docker --version 2>$null
    if (-not $dockerVersion) {
        Write-Err $msg.dockerNotFound
        Write-Host ""
        Write-Host "Solution:" -ForegroundColor Yellow
        Write-Host "  Install Docker Desktop: https://www.docker.com/products/docker-desktop"
        exit 1
    }
    
    $dockerRunning = docker info 2>$null
    if (-not $dockerRunning) {
        Write-Warn $msg.dockerNotRunning
        Write-Host ""
        Write-Host "Solution: Start Docker Desktop" -ForegroundColor Yellow
        exit 1
    }
    Write-Success "Docker: Running"
}

# npm 依存関係チェック（自動インストール）
$nodeModulesPath = $config.paths.nodeModules
if (-not (Test-Path $nodeModulesPath)) {
    Write-Warn "npm packages not installed"
    Write-Status $msg.installPackages
    Invoke-Expression $config.scripts.install
    if ($LASTEXITCODE -ne 0) {
        Write-Err "npm install failed"
        exit 1
    }
}
Write-Success "npm packages: Installed"

# ============================================
# 2. 環境セットアップ
# ============================================
if ($Setup -or $All) {
    Write-Host ""
    Write-Status $msg.startingDocker
    
    Invoke-Expression $config.scripts.dockerUp
    
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Docker service startup failed"
        Write-Host ""
        Write-Host "Solution:" -ForegroundColor Yellow
        Write-Host "  1. $($config.scripts.dockerDown)"
        Write-Host "  2. Restart Docker Desktop"
        Write-Host "  3. Retry"
        exit 1
    }
    
    # PostgreSQL 待機
    Write-Status $msg.waitingPostgres
    $pgContainer = $config.docker.postgres.containerName
    $pgUser = $config.docker.postgres.user
    $pgReady = Wait-ForService -MaxRetries $config.timeouts.dockerStartup -ServiceName "PostgreSQL" -Check {
        $check = docker exec $pgContainer pg_isready -U $pgUser 2>$null
        $check -match "accepting connections"
    }
    
    if (-not $pgReady) {
        Write-Err "PostgreSQL timeout"
        Write-Host "Debug: docker logs $pgContainer" -ForegroundColor Yellow
        exit 1
    }
    Write-Success $msg.postgresReady

    # Redis チェック
    $redisContainer = $config.docker.redis.containerName
    $redisResponse = docker exec $redisContainer redis-cli ping 2>$null
    if ($redisResponse -ne $config.docker.redis.expectedResponse) {
        Write-Err "Redis connection failed"
        exit 1
    }
    Write-Success $msg.redisReady

    # マイグレーション
    Write-Status $msg.runningMigration
    Invoke-Expression $config.scripts.migrate 2>$null
    Write-Success "Migration: Complete"

    # テスト開発者の確認と作成
    $envContent = Get-Content $config.environment.envFile -Raw -ErrorAction SilentlyContinue
    $testApiKeyPattern = $config.environment.requiredPatterns.testApiKey
    $hasTestApiKey = $envContent -match $testApiKeyPattern
    
    if (-not $hasTestApiKey) {
        Write-Warn "TEST_API_KEY not configured"
        
        $healthUrl = "$($config.endpoints.backendBase)$($config.endpoints.health)"
        $backendRunning = Test-HttpEndpoint -Url $healthUrl
        
        if (-not $backendRunning) {
            Write-Status "Starting backend temporarily..."
            $backendProcess = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -PassThru -WindowStyle Hidden
            
            $backendRunning = Wait-ForService -MaxRetries $config.timeouts.serverStartup -ServiceName "Backend" -Check {
                Test-HttpEndpoint -Url $healthUrl
            }
        }
        
        if ($backendRunning) {
            Invoke-Expression $config.scripts.setupTestDeveloper
            Write-Success "TEST_API_KEY: Auto-configured"
        } else {
            Write-Warn "Could not start backend"
            Write-Host "Run manually: $($config.scripts.setupTestDeveloper)" -ForegroundColor Yellow
        }
    } else {
        Write-Success "TEST_API_KEY: Configured"
    }
}

if ($Setup -and -not $All) {
    Write-Host ""
    Write-Success "Environment setup complete!"
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  .\scripts\test-runner.ps1 -Unit       # Unit tests"
    Write-Host "  .\scripts\test-runner.ps1 -E2E        # E2E API tests"
    Write-Host "  .\scripts\test-runner.ps1 -Playwright # Playwright tests"
    exit 0
}

# ============================================
# 3. 単体テスト
# ============================================
if ($Unit -or $All) {
    Write-Host ""
    Write-Host "----------------------------------------" -ForegroundColor Yellow
    Write-Host "    $($msg.unitTestTitle)" -ForegroundColor Yellow
    Write-Host "----------------------------------------" -ForegroundColor Yellow
    
    Invoke-Expression $config.scripts.testUnit
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "$($msg.unitTestTitle): $($msg.allPassed)"
        Write-Host ""
        Write-Host "Coverage report: $($config.paths.coverageReport)" -ForegroundColor Gray
    } else {
        Write-Err "$($msg.unitTestTitle): $($msg.someFailed)"
        Write-Host ""
        Write-Host "Debug:" -ForegroundColor Yellow
        Write-Host "  npm test -- --testPathPattern='FailedTest'"
        Write-Host "  npm run test:watch"
        if (-not $All) { exit 1 }
    }
}

# ============================================
# 4. E2E API テスト
# ============================================
if ($E2E -or $All) {
    Write-Host ""
    Write-Host "----------------------------------------" -ForegroundColor Yellow
    Write-Host "    $($msg.e2eTestTitle)" -ForegroundColor Yellow
    Write-Host "----------------------------------------" -ForegroundColor Yellow
    
    $healthUrl = "$($config.endpoints.backendBase)$($config.endpoints.health)"
    $serverRunning = Test-HttpEndpoint -Url $healthUrl

    if (-not $serverRunning) {
        Write-Warn "Backend not running"
        Write-Status "Auto-starting..."
        $backendProcess = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -PassThru -WindowStyle Minimized
        
        $serverRunning = Wait-ForService -MaxRetries $config.timeouts.serverStartup -ServiceName "Backend" -Check {
            Test-HttpEndpoint -Url $healthUrl
        }
    }

    if ($serverRunning) {
        Write-Success "Backend: $($config.endpoints.backendBase)"
        Invoke-Expression $config.scripts.testE2eApi
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "$($msg.e2eTestTitle): $($msg.allPassed)"
        } else {
            Write-Err "$($msg.e2eTestTitle): $($msg.someFailed)"
        }
    } else {
        Write-Err "Could not start backend"
        Write-Host ""
        Write-Host "Solution:" -ForegroundColor Yellow
        Write-Host "  1. Run: $($config.scripts.dev)"
        Write-Host "  2. Retry: .\scripts\test-runner.ps1 -E2E"
    }
}

# ============================================
# 5. Playwright UI テスト
# ============================================
if ($Playwright -or $All) {
    Write-Host ""
    Write-Host "----------------------------------------" -ForegroundColor Yellow
    Write-Host "    $($msg.playwrightTitle)" -ForegroundColor Yellow
    Write-Host "----------------------------------------" -ForegroundColor Yellow
    
    # Playwright ブラウザ確認（自動インストール）
    Write-Status "Checking Playwright browsers..."
    $playwrightPath = $ExecutionContext.InvokeCommand.ExpandString($config.paths.playwrightBrowsers)
    $chromiumDirs = Get-ChildItem -Path $playwrightPath -Filter "chromium-*" -Directory -ErrorAction SilentlyContinue
    
    if (-not $chromiumDirs) {
        Write-Warn "Playwright browsers not installed"
        Write-Status "Auto-installing (this may take a few minutes)..."
        Invoke-Expression $config.scripts.playwrightInstall
        
        if ($LASTEXITCODE -ne 0) {
            Write-Err "Playwright browser installation failed"
            exit 1
        }
        Write-Success "Playwright browsers: Installed"
    } else {
        Write-Success "Playwright browsers: Installed"
    }
    
    # Dashboard npm 依存確認
    $dashboardModulesPath = $config.paths.dashboardModules
    if (-not (Test-Path $dashboardModulesPath)) {
        Write-Warn "Dashboard packages not installed"
        Write-Status "Auto-installing..."
        Invoke-Expression $config.scripts.installDashboard
        Write-Success "Dashboard packages: Installed"
    }
    
    # サーバー確認
    $healthUrl = "$($config.endpoints.backendBase)$($config.endpoints.health)"
    $backendRunning = Test-HttpEndpoint -Url $healthUrl
    $dashboardRunning = Test-TcpPort -Port $config.ports.dashboard

    if (-not $dashboardRunning -or -not $backendRunning) {
        Write-Warn "Servers not running"
        Write-Host ""
        Write-Host "Playwright tests require:" -ForegroundColor Cyan
        if (-not $backendRunning) {
            Write-Host "  [NG] Backend ($($config.endpoints.backendBase))" -ForegroundColor Red
            Write-Host "      Start: $($config.scripts.dev)" -ForegroundColor Gray
        } else {
            Write-Host "  [OK] Backend ($($config.endpoints.backendBase))" -ForegroundColor Green
        }
        if (-not $dashboardRunning) {
            Write-Host "  [NG] Dashboard ($($config.endpoints.dashboardBase))" -ForegroundColor Red
            Write-Host "      Start: $($config.scripts.devDashboard)" -ForegroundColor Gray
        } else {
            Write-Host "  [OK] Dashboard ($($config.endpoints.dashboardBase))" -ForegroundColor Green
        }
        Write-Host ""
        Write-Host "Or use Playwright auto-start:" -ForegroundColor Cyan
        Write-Host "  npx playwright test" -ForegroundColor White
    } else {
        Write-Success "Backend: $($config.endpoints.backendBase)"
        Write-Success "Dashboard: $($config.endpoints.dashboardBase)"
        Write-Host ""
        Write-Status "Running Playwright tests (stop on first failure)..."
        
        Invoke-Expression $config.scripts.testPlaywright
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "$($msg.playwrightTitle): $($msg.allPassed)"
        } else {
            Write-Err "$($msg.playwrightTitle): $($msg.someFailed)"
            Write-Host ""
            Write-Host "Debug:" -ForegroundColor Yellow
            Write-Host "  npm run test:e2e:debug   # Step-by-step debug"
            Write-Host "  npm run test:e2e:ui      # Visual UI mode"
            Write-Host "  npm run test:e2e:headed  # Show browser"
            Write-Host ""
            Write-Host "Report:" -ForegroundColor Yellow
            Write-Host "  npx playwright show-report"
        }
    }
}

# ============================================
# 6. テスト結果サマリー
# ============================================
$EndTime = Get-Date
$Duration = $EndTime - $StartTime

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "    $($msg.testComplete)" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "Duration: $($Duration.Minutes)m $($Duration.Seconds)s"
Write-Host ""
Write-Host "Reports:" -ForegroundColor Cyan
Write-Host "  Coverage: $($config.paths.coverageReport)"
Write-Host "  Playwright: npx playwright show-report"
Write-Host ""
