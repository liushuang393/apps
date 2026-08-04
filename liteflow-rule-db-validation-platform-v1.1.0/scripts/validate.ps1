$ErrorActionPreference = "Stop"
trap {
    $RootForTrap = Split-Path -Parent $PSScriptRoot
    $ReportsForTrap = Join-Path $RootForTrap "reports"
    New-Item -ItemType Directory -Force -Path $ReportsForTrap | Out-Null
    $FailurePath = Join-Path $ReportsForTrap "validation-failure.txt"
    $Lines = @(
        "status=FAIL",
        "failedAt=$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))",
        "message=$($_.Exception.Message)",
        "log=reports\validation-run.log"
    )
    Set-Content -Encoding UTF8 -Path $FailurePath -Value $Lines
    [Console]::Error.WriteLine("Operation failed. See $FailurePath")
    exit 1
}
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
New-Item -ItemType Directory -Force -Path "reports" | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue "reports\validation-report.md", "reports\validation-report.json", "reports\validation-state.json"
$LogFile = Join-Path $Root "reports\validation-run.log"
Set-Content -Path $LogFile -Value ""

function Invoke-Logged([scriptblock]$Command) {
    # install.ps1 と同様。最後がネイティブコマンドでない場合に古い終了コードが残らないようリセットする。
    $global:LASTEXITCODE = 0
    # docker は進捗を stderr へ書く。$ErrorActionPreference = "Stop" のままだと
    # その1行で NativeCommandError が終了エラーになり、成功しても失敗と報告される。
    # 成否は $LASTEXITCODE だけで判定する。
    $PreviousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        # install.ps1 と同じ。ForEach-Object で文字列へ落とさないと、成功しているのに
        # 赤字の NativeCommandError が表示され「失敗した」と読まれる。
        & $Command 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $LogFile -Append
    } finally {
        $ErrorActionPreference = $PreviousErrorAction
    }
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" }
}

# validator は FAIL 項目が1つでもあると終了コード1を返すが、レポート自体は生成されている。
# そのレポートこそ運用者が読むべきものなので、異常終了として報告してはならない。
function Invoke-Validator([string]$Phase) {
    $global:LASTEXITCODE = 0
    # docker compose run はコンテナの生成・破棄の進捗を stderr へ書く。
    # Invoke-Logged と同じ理由で、この間だけ Continue に戻す（成否は $LASTEXITCODE で見る）。
    $PreviousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker compose run --rm validator --phase $Phase 2>&1 | ForEach-Object { "$_" } |
            Tee-Object -FilePath $LogFile -Append
    } finally {
        $ErrorActionPreference = $PreviousErrorAction
    }
    if ($LASTEXITCODE -ne 0) {
        throw ("検証フェーズ '$Phase' に FAIL 項目があります（validator exit=$LASTEXITCODE）。" +
               "レポートは生成済みです。reports\validation-report.md と " +
               "reports\validation-report.json を確認してください。")
    }
}

function Wait-Http([string]$Url, [string]$Name, [int]$Attempts = 90) {
    for ($i = 1; $i -le $Attempts; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                Write-Host "  - $Name READY"
                return
            }
            Start-Sleep -Seconds 2
        } catch { Start-Sleep -Seconds 2 }
    }
    docker compose ps | Out-Host
    docker compose logs --tail=200 executor-a executor-b mariadb prometheus grafana | Out-Host
    throw "$Name が起動しませんでした: $Url"
}

. (Join-Path $PSScriptRoot "_common.ps1")

Write-Host "[0/6] 事前確認"
Assert-DockerReady
Assert-PortsFree
docker image inspect liteflow-rule-db-validation-app:1.0.0 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "アプリイメージがありません。先に install.cmd を実行してください。" }
if (-not (Test-Path (Join-Path $Root "reports\build-evidence.json"))) { throw "ビルド証跡がありません。先に install.cmd を実行してください。" }

Write-Host "[1/6] MariaDB、Executor、監視基盤起動"
Invoke-Logged { docker compose up -d mariadb executor-a executor-b prometheus grafana }

Write-Host "[2/6] ヘルスチェック"
Wait-Http "http://localhost:8081/actuator/health" "Executor A"
Wait-Http "http://localhost:8082/actuator/health" "Executor B"
Wait-Http "http://localhost:9090/-/ready" "Prometheus"
Wait-Http "http://localhost:3000/api/health" "Grafana"

Write-Host "[3/6] Rule-DB E2E検証"
Invoke-Validator "main"

Write-Host "[4/6] Executor B再起動"
Invoke-Logged { docker compose restart executor-b }
Wait-Http "http://localhost:8082/actuator/health" "Executor B（再起動後）"

Write-Host "[5/6] 永続化・再ロード検証"
Invoke-Validator "persistence"

Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Root "reports\validation-failure.txt")
Write-Host "[6/6] 完了"
Write-Host "検証レポート: $Root\reports\validation-report.md"
Write-Host "JSON証跡:      $Root\reports\validation-report.json"
Write-Host "JUnit証跡:     $Root\reports\junit"
Write-Host "Executor A:   http://localhost:8081"
Write-Host "Executor B:   http://localhost:8082"
Write-Host "Prometheus:   http://localhost:9090"
Write-Host "Grafana:      http://localhost:3000  (admin / admin)"
