param(
    [switch]$Force,
    [switch]$SkipPull
)
$ErrorActionPreference = "Stop"
trap {
    $RootForTrap = Split-Path -Parent $PSScriptRoot
    $ReportsForTrap = Join-Path $RootForTrap "reports"
    New-Item -ItemType Directory -Force -Path $ReportsForTrap | Out-Null
    $FailurePath = Join-Path $ReportsForTrap "install-failure.txt"
    $Lines = @(
        "status=FAIL",
        "failedAt=$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))",
        "message=$($_.Exception.Message)",
        "log=reports\install.log"
    )
    Set-Content -Encoding UTF8 -Path $FailurePath -Value $Lines
    [Console]::Error.WriteLine("Operation failed. See $FailurePath")
    exit 1
}
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
New-Item -ItemType Directory -Force -Path "reports" | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue "reports\build-evidence.json", "reports\build-metadata.json"
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "reports\junit"
$LogFile = Join-Path $Root "reports\install.log"
Set-Content -Path $LogFile -Value ""

function Invoke-Logged([scriptblock]$Command) {
    # 先にリセットする。スクリプトブロックの最後がネイティブコマンドでない場合、
    # $LASTEXITCODE に古い値が残り、失敗を成功と誤読しかねない。
    $global:LASTEXITCODE = 0
    # docker と mvn は進捗や警告も stderr へ書く（BuildKit の " => Building" など）。
    # $ErrorActionPreference = "Stop" のまま 2>&1 でつなぐと、その1行だけで
    # NativeCommandError が終了エラーになり、ビルドが成功していても失敗と報告してしまう。
    # 成否は $LASTEXITCODE だけで判定するので、ネイティブ呼び出しの間は Continue に戻す。
    $PreviousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Command 2>&1 | Tee-Object -FilePath $LogFile -Append
    } finally {
        $ErrorActionPreference = $PreviousErrorAction
    }
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" }
}

. (Join-Path $PSScriptRoot "_common.ps1")

Write-Host "[0/4] Docker 事前確認"
Assert-DockerReady

$RuntimeImages = [ordered]@{
    mariadb    = "mariadb:11.4.12"
    prometheus = "prom/prometheus:v3.13.1"
    grafana    = "grafana/grafana:13.1.1"
    validator  = "python:3.13-slim"
}

Write-Host "[1/4] 固定バージョンの実行イメージ取得"
if ($SkipPull) {
    Write-Host "  - -SkipPull 指定のため取得をスキップ"
} else {
    # ローカルに無いものだけを取得する。既にあるイメージを取り直しても帯域を消費するだけで、
    # オフライン環境では失敗する。
    $ToPull = @()
    foreach ($service in $RuntimeImages.Keys) {
        if (-not $Force -and (Test-DockerImageExists $RuntimeImages[$service])) {
            Write-Host "  - $($RuntimeImages[$service]) はローカルに存在（取得スキップ）"
        } else {
            $ToPull += $service
        }
    }
    if ($ToPull.Count -gt 0) {
        Invoke-Logged { docker compose pull @ToPull }
    } else {
        Write-Host "  - すべてローカルに存在。取得不要。"
    }
}

Write-Host "[2/4] アプリケーションイメージ構築（mvn clean verifyを実行）"
if ($Force) {
    Invoke-Logged { docker compose build --pull executor-a }
} else {
    # 既定では --pull を付けない。ビルド用ベースイメージは版数固定なので、毎回更新しても
    # ネットワークコストが増えるだけである。更新したい場合は -Force を使う。
    Invoke-Logged { docker compose build executor-a }
}

Write-Host "[3/4] JUnit XML証跡の抽出"
$JUnit = Join-Path $Root "reports\junit"
if (Test-Path $JUnit) { Remove-Item -Recurse -Force $JUnit }
New-Item -ItemType Directory -Force -Path $JUnit | Out-Null
# 終了コードを確認する前に .Trim() を呼んではならない。失敗時の出力は $null であり、
# NullReferenceException が本来のdockerエラーを覆い隠してしまう。
$ContainerId = docker create liteflow-rule-db-validation-app:1.0.0
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($ContainerId)) {
    throw "Temporary container creation failed (exit=$LASTEXITCODE, output='$ContainerId')"
}
$ContainerId = ([string]$ContainerId).Trim()
try {
    docker cp "${ContainerId}:/app/test-reports/." $JUnit
    if ($LASTEXITCODE -ne 0) { throw "JUnit report extraction failed" }
    docker cp "${ContainerId}:/app/build-metadata.json" (Join-Path $Root "reports\build-metadata.json")
    if ($LASTEXITCODE -ne 0) { throw "Build metadata extraction failed" }
} finally {
    docker rm -f $ContainerId | Out-Null
}
$JUnitFiles = Get-ChildItem -Path $JUnit -Filter "TEST-*.xml" -File -ErrorAction SilentlyContinue
if (-not $JUnitFiles) { throw "JUnit XML was not extracted." }
$MetadataPath = Join-Path $Root "reports\build-metadata.json"
if (-not (Test-Path $MetadataPath) -or (Get-Item $MetadataPath).Length -eq 0) { throw "build-metadata.json is missing or empty." }

Write-Host "[4/4] ビルド証跡作成"
$ImageId = (docker image inspect liteflow-rule-db-validation-app:1.0.0 --format '{{.Id}}').Trim()
$Evidence = [ordered]@{
    status = "PASS"
    builtAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    image = "liteflow-rule-db-validation-app:1.0.0"
    imageId = $ImageId
    buildCommand = "docker compose build --pull executor-a"
    mavenCommand = "mvn -B -ntp clean verify"
    junitDirectory = "reports/junit"
    liteflowResolutionMetadata = "reports/build-metadata.json"
}
$Evidence | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Root "reports\build-evidence.json")
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Root "reports\install-failure.txt")
Write-Host "インストール完了: $ImageId"
Write-Host "次の操作: scripts\validate.cmd"
