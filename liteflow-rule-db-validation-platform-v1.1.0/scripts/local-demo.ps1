param(
    [int]$Port = 8081,
    [switch]$KeepRunning
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
New-Item -ItemType Directory -Force -Path "reports" | Out-Null

# Docker を使わずに変換デモを実行する。ホスト上にExecutorを1つ起動し、Rule-DBはH2を使う。
# LOCALプロファイルであり、2ノード構成のDocker検証の代わりにはならない。

$Jar = Join-Path $Root "app\target\liteflow-rule-db-validation-app.jar"
if (-not (Test-Path $Jar)) {
    throw "$Jar がありません。先に local-verify.cmd（または install.cmd）を実行してください。"
}
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    throw "java がホストにありません。"
}

$listener = $null
try { $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1 } catch { }
if ($listener) {
    throw "port $Port は PID $($listener.OwningProcess) が使用中です。"
}

$DataDir = Join-Path $Root "reports\local-h2"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$StdOut = Join-Path $Root "reports\local-demo-app.log"
$StdErr = Join-Path $Root "reports\local-demo-app.err.log"

$env:SERVER_PORT = "$Port"
$env:INSTANCE_ID = "local-demo"
$env:SPRING_DATASOURCE_URL = "jdbc:h2:file:$($DataDir -replace '\\','/')/liteflow-rules;MODE=MySQL;AUTO_SERVER=TRUE"
$env:SPRING_DATASOURCE_USERNAME = "sa"
$env:SPRING_DATASOURCE_PASSWORD = ""
$env:SPRING_DATASOURCE_DRIVER = "org.h2.Driver"

Write-Host "[1/3] Executor 起動 (port $Port, H2 Rule-DB)"
$proc = Start-Process -FilePath "java" -ArgumentList @("-jar", $Jar) `
    -RedirectStandardOutput $StdOut -RedirectStandardError $StdErr -PassThru -WindowStyle Hidden

try {
    $ready = $false
    for ($i = 1; $i -le 60; $i++) {
        if ($proc.HasExited) { throw "Executor が異常終了しました（exit=$($proc.ExitCode)）。reports\local-demo-app.log を確認してください。" }
        try {
            Invoke-RestMethod -Uri "http://localhost:$Port/actuator/health" -TimeoutSec 3 | Out-Null
            $ready = $true
            break
        } catch { Start-Sleep -Seconds 2 }
    }
    if (-not $ready) { throw "Executor が起動しませんでした。reports\local-demo-app.log を確認してください。" }
    Write-Host "  - READY"

    Write-Host ""
    Write-Host "[2/3] 変換デモ実行"
    & (Join-Path $PSScriptRoot "demo-transform.ps1") -BaseUrl "http://localhost:$Port"
    $demoExit = $LASTEXITCODE

    if ($KeepRunning) {
        Write-Host ""
        Write-Host "[3/3] -KeepRunning 指定のため Executor は起動したままです (PID $($proc.Id))"
        Write-Host "      停止: Stop-Process -Id $($proc.Id)"
        exit $demoExit
    }
    exit $demoExit
} finally {
    if (-not $KeepRunning -and -not $proc.HasExited) {
        Write-Host ""
        Write-Host "[3/3] Executor 停止 (PID $($proc.Id))"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}
