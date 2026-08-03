$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
New-Item -ItemType Directory -Force -Path "reports" | Out-Null
$FailureFile = Join-Path $Root "reports\run-all-failure.txt"
# 前回実行の証跡を消す。古いファイルを今回の結果と誤読させないため。
Remove-Item -Force -ErrorAction SilentlyContinue $FailureFile,
    (Join-Path $Root "reports\install-failure.txt"),
    (Join-Path $Root "reports\validation-failure.txt")
try {
    $Python = Get-Command python -ErrorAction SilentlyContinue
    $Py = Get-Command py -ErrorAction SilentlyContinue
    if ($Python) {
        & python (Join-Path $Root "tools\preflight.py")
        if ($LASTEXITCODE -ne 0) { throw "Preflight failed with exit code $LASTEXITCODE" }
    } elseif ($Py) {
        & py -3 (Join-Path $Root "tools\preflight.py")
        if ($LASTEXITCODE -ne 0) { throw "Preflight failed with exit code $LASTEXITCODE" }
    } else {
        Write-Warning "Python 3 が見つかりません。ホスト事前確認はスキップします（Dockerビルドとテストは実行されます）。"
    }
    & (Join-Path $PSScriptRoot "install.ps1")
    & (Join-Path $PSScriptRoot "validate.ps1")

    # 正式判定（validate）の後に、変換とルール管理の検証も続けて回す。
    # ここで落ちても validate の結果は既にファイルに残っているので、
    # 個別に失敗を記録して先へ進み、最後に summary で全体を見せる。
    $optional = @(
        @{ name = "corpus-run"; script = "corpus-run.ps1"; args = @() },
        @{ name = "demo-transform"; script = "demo-transform.ps1"; args = @() },
        @{ name = "rule-admin-demo"; script = "rule-admin-demo.ps1"; args = @() }
    )
    $optionalFailures = @()
    foreach ($item in $optional) {
        try {
            & (Join-Path $PSScriptRoot $item.script) @($item.args)
            if ($LASTEXITCODE -ne 0) { $optionalFailures += $item.name }
        } catch {
            Write-Warning "$($item.name) が失敗しました: $($_.Exception.Message)"
            $optionalFailures += $item.name
        }
    }

    & (Join-Path $PSScriptRoot "summary.ps1")

    if ($optionalFailures.Count -gt 0) {
        throw "次の検証が失敗しました: $($optionalFailures -join ', ')。reports\summary.md を確認してください。"
    }
    Remove-Item -Force -ErrorAction SilentlyContinue $FailureFile
} catch {
    $lines = @(
        "status=FAIL",
        "failedAt=$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))",
        "message=$($_.Exception.Message)",
        "installLog=reports\install.log",
        "validationLog=reports\validation-run.log"
    )
    Set-Content -Encoding UTF8 -Path $FailureFile -Value $lines
    [Console]::Error.WriteLine("Run failed. Evidence: $FailureFile")
    exit 1
}
