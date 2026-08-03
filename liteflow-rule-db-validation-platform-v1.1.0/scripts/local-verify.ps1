$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
New-Item -ItemType Directory -Force -Path "reports" | Out-Null

$EvidencePath = Join-Path $Root "reports\local-verify.json"
$LogFile = Join-Path $Root "reports\local-verify.log"
$JUnitDir = Join-Path $Root "reports\junit-local"

function Write-Evidence([string]$Status, [hashtable]$Extra) {
    $evidence = [ordered]@{
        status  = $Status
        ranAt   = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
        profile = "LOCAL"
        note    = "Host JDK/Maven build. NOT the official gate - runtime PASS only comes from validate.cmd (Docker)."
        log     = "reports/local-verify.log"
    }
    foreach ($key in $Extra.Keys) { $evidence[$key] = $Extra[$key] }
    $evidence | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $EvidencePath
}

# ホストに既に入っているものをそのまま使う。ツールチェーンを勝手に導入しない。
$Mvn = Get-Command mvn -ErrorAction SilentlyContinue
$Java = Get-Command java -ErrorAction SilentlyContinue
if (-not $Mvn -or -not $Java) {
    $missing = @()
    if (-not $Mvn) { $missing += "mvn" }
    if (-not $Java) { $missing += "java" }
    Write-Evidence "SKIP" @{ reason = "missing on PATH: $($missing -join ', ')" }
    Write-Warning "Maven/JDK がホストにありません（$($missing -join ', ')）。install.cmd の Docker ビルドを使用してください。"
    exit 0
}

Write-Host "[1/3] ホストツールチェーン"
Write-Host "  - mvn:  $((mvn -v | Select-Object -First 1))"
# `java -version`（ハイフン1本）は stderr へ書く。$ErrorActionPreference = "Stop" のもとで
# 2>&1 とつなぐと NativeCommandError が終了エラーになり、対話コンソール以外では必ず落ちる。
# JDK 9 以降の `--version`（ハイフン2本）は stdout へ書くので、そのまま読める。
Write-Host "  - java: $((java --version | Select-Object -First 1))"

Write-Host "[2/3] mvn clean verify（LiteFlow 2.16.1 API + Rule-DB JUnit）"
$global:LASTEXITCODE = 0
# mvn は情報や警告も stderr へ書く（Mockito の self-attach 警告など）。
# $ErrorActionPreference = "Stop" のまま 2>&1 でつなぐと、その1行だけで
# NativeCommandError が終了エラーになり、ビルドが成功していても失敗と報告してしまう。
# 成否は $LASTEXITCODE で判定するので、ネイティブ呼び出しの間だけ Continue に戻す。
$PreviousErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& mvn -f (Join-Path $Root "app\pom.xml") -B -ntp clean verify 2>&1 | Tee-Object -FilePath $LogFile
$BuildExit = $LASTEXITCODE
$ErrorActionPreference = $PreviousErrorAction

Write-Host "[3/3] JUnit 証跡の抽出"
if (Test-Path $JUnitDir) { Remove-Item -Recurse -Force $JUnitDir }
New-Item -ItemType Directory -Force -Path $JUnitDir | Out-Null
$Surefire = Join-Path $Root "app\target\surefire-reports"
$Tests = 0; $Failures = 0; $Errors = 0; $Files = 0
if (Test-Path $Surefire) {
    Get-ChildItem -Path $Surefire -Filter "TEST-*.xml" -File | ForEach-Object {
        Copy-Item $_.FullName $JUnitDir
        [xml]$xml = Get-Content $_.FullName
        $Files++
        $Tests += [int]$xml.testsuite.tests
        $Failures += [int]$xml.testsuite.failures
        $Errors += [int]$xml.testsuite.errors
    }
}

$Status = if ($BuildExit -eq 0 -and $Files -gt 0 -and $Tests -gt 0 -and $Failures -eq 0 -and $Errors -eq 0) { "PASS" } else { "FAIL" }
Write-Evidence $Status @{
    mavenExitCode = $BuildExit
    junitDirectory = "reports/junit-local"
    junit = [ordered]@{ files = $Files; tests = $Tests; failures = $Failures; errors = $Errors }
}

if ($Status -ne "PASS") {
    Write-Host ""
    Write-Host "ローカル検証 FAIL。reports\local-verify.log を確認してください。"
    exit 1
}
Write-Host ""
Write-Host "ローカル検証 PASS: tests=$Tests failures=$Failures errors=$Errors"
Write-Host "証跡: reports\local-verify.json / reports\junit-local"
Write-Host "注意: これはホストビルドの結果です。正式判定は Docker の validate.cmd が生成する reports\validation-report.md です。"
