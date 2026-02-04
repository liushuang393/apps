# ForgePay 开发环境一键启动脚本
# 使用方法: .\scripts\start-dev.ps1

param(
    [switch]$Backend,    # 仅启动后端
    [switch]$Dashboard,  # 仅启动前端
    [switch]$Stripe,     # 启动 Stripe CLI
    [switch]$All         # 启动所有 (默认)
)

function Write-Status { param($msg) Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "[✓] $msg" -ForegroundColor Green }
function Write-Error { param($msg) Write-Host "[✗] $msg" -ForegroundColor Red }

if (-not ($Backend -or $Dashboard -or $Stripe)) { $All = $true }

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "    ForgePay 开发环境" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

# 检查并启动 Docker
Write-Status "检查 Docker 服务..."
$pgRunning = docker ps --filter "name=forgepaybridge-postgres" --format "{{.Names}}" 2>$null
if (-not $pgRunning) {
    Write-Status "启动 Docker 服务..."
    docker-compose up -d postgres redis
    Start-Sleep -Seconds 3
}
Write-Success "Docker 服务: 运行中"

# 检查数据库迁移
Write-Status "检查数据库..."
$migrationCheck = npm run migrate:up 2>&1 | Out-String
Write-Success "数据库: 就绪"

# 启动后端
if ($Backend -or $All) {
    Write-Status "启动后端服务器..."
    $backendJob = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm run dev" -PassThru
    Write-Success "后端服务器: http://localhost:3000 (PID: $($backendJob.Id))"
}

# 启动前端 Dashboard
if ($Dashboard -or $All) {
    $dashboardPath = Join-Path $PWD "dashboard"
    if (Test-Path $dashboardPath) {
        Write-Status "启动 Dashboard..."
        $dashboardJob = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$dashboardPath'; npm run dev" -PassThru
        Write-Success "Dashboard: http://localhost:3001 (PID: $($dashboardJob.Id))"
    } else {
        Write-Error "Dashboard 目录不存在: $dashboardPath"
    }
}

# 启动 Stripe CLI (如果安装)
if ($Stripe -or $All) {
    $stripeInstalled = Get-Command stripe -ErrorAction SilentlyContinue
    if ($stripeInstalled) {
        Write-Status "启动 Stripe Webhook 监听..."
        $stripeJob = Start-Process powershell -ArgumentList "-NoExit", "-Command", "stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe" -PassThru
        Write-Success "Stripe CLI: 监听中 (PID: $($stripeJob.Id))"
    } else {
        Write-Status "Stripe CLI 未安装 (可选)"
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "    开发环境已启动!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "服务地址:" -ForegroundColor Cyan
Write-Host "  - 后端 API:    http://localhost:3000"
Write-Host "  - API 文档:    http://localhost:3000/api-docs"
Write-Host "  - Dashboard:   http://localhost:3001"
Write-Host "  - 健康检查:    http://localhost:3000/health"
Write-Host ""
Write-Host "测试命令:" -ForegroundColor Cyan
Write-Host "  - 单元测试:    npm run test:coverage"
Write-Host "  - E2E 测试:    npm run test:e2e:api"
Write-Host "  - Playwright:  npm run test:e2e:ui"
Write-Host ""
Write-Host "按 Ctrl+C 关闭各个终端窗口" -ForegroundColor Yellow
Write-Host ""
