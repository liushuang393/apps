param(
    [int]$Port = 8081,
    [string]$Family = "all",
    [string]$Profile
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
New-Item -ItemType Directory -Force -Path "reports" | Out-Null

# Docker を使わずにコーパスを実行する。ホスト上にExecutorを1つ起動し、Rule-DBはH2を使う。
# LOCALプロファイルであり、2ノード構成のDocker検証の代わりにはならない。

$Jar = Join-Path $Root "app\target\liteflow-rule-db-validation-app.jar"
if (-not (Test-Path $Jar)) {
    throw "$Jar がありません。先に local-verify.cmd を実行してください。"
}
$javaHome = Split-Path -Parent (Split-Path -Parent (Get-Command java).Source)
if (-not (Test-Path (Join-Path $javaHome "bin\javac.exe"))) {
    Write-Warning "javac が見つかりません（JRE の可能性）。CompileNode は compilerAvailable=false を報告します。"
}

$listener = $null
try { $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1 } catch { }
if ($listener) { throw "port $Port は PID $($listener.OwningProcess) が使用中です。" }

$DataDir = Join-Path $Root "reports\local-h2"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$env:SERVER_PORT = "$Port"
$env:INSTANCE_ID = "local-corpus"
$env:SPRING_DATASOURCE_URL = "jdbc:h2:file:$($DataDir -replace '\\','/')/liteflow-rules;MODE=MySQL;AUTO_SERVER=TRUE"
$env:SPRING_DATASOURCE_USERNAME = "sa"
$env:SPRING_DATASOURCE_PASSWORD = ""
$env:SPRING_DATASOURCE_DRIVER = "org.h2.Driver"

# Struts→Spring Boot ファミリの生成Javaは Spring の型を参照するため、javac に
# Spring Boot 4.1 の依存jarを渡す必要がある。無い場合はそのファミリのコンパイルだけが
# 失敗する（他のファミリには影響しない）。
$BootLibs = Join-Path $Root "corpus\families\struts-springboot\apps\target-springboot41\lib"
if (Test-Path $BootLibs) {
    $env:TRANSFORM_EXTRA_CLASSPATH = $BootLibs
    Write-Host "  - Spring Boot 4.1 classpath: $BootLibs"
} else {
    Write-Warning "Spring Boot 4.1 の依存jarがありません。先に scripts\samples-build.cmd を実行してください: $BootLibs"
}

Write-Host "[1/3] Executor 起動 (port $Port, H2 Rule-DB)"
$proc = Start-Process -FilePath "java" -ArgumentList @("-jar", $Jar) `
    -RedirectStandardOutput (Join-Path $Root "reports\local-corpus-app.log") `
    -RedirectStandardError (Join-Path $Root "reports\local-corpus-app.err.log") `
    -PassThru -WindowStyle Hidden
try {
    $ready = $false
    for ($i = 1; $i -le 60; $i++) {
        if ($proc.HasExited) { throw "Executor が異常終了しました（exit=$($proc.ExitCode)）。reports\local-corpus-app.log を確認してください。" }
        try {
            Invoke-RestMethod -Uri "http://localhost:$Port/actuator/health" -TimeoutSec 3 | Out-Null
            $ready = $true; break
        } catch { Start-Sleep -Seconds 2 }
    }
    if (-not $ready) { throw "Executor が起動しませんでした。reports\local-corpus-app.log を確認してください。" }
    Write-Host "  - READY"
    Write-Host ""
    Write-Host "[2/3] コーパス実行"
    # 配列のスプラッティングは要素を位置引数として渡してしまう。ハッシュテーブルで渡すこと。
    $forward = @{ BaseUrl = "http://localhost:$Port"; Family = $Family }
    if ($Profile) { $forward["Profile"] = $Profile }
    & (Join-Path $PSScriptRoot "corpus-run.ps1") @forward
    exit $LASTEXITCODE
} finally {
    if (-not $proc.HasExited) {
        Write-Host ""
        Write-Host "[3/3] Executor 停止 (PID $($proc.Id))"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}
