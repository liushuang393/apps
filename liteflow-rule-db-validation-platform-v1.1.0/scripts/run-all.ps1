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
    # 呼び先が exit 1 で終わっても、呼び出し側では例外にならず $LASTEXITCODE に入るだけである。
    # 明示的に見ないと、install が失敗したまま validate へ進み、
    # さらにその失敗が後続スクリプトのせいに見えてしまう。
    $global:LASTEXITCODE = 0
    & (Join-Path $PSScriptRoot "install.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "install が失敗しました（exit $LASTEXITCODE）。reports\install-failure.txt を確認してください。"
    }
    $global:LASTEXITCODE = 0
    & (Join-Path $PSScriptRoot "validate.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "validate が失敗しました（exit $LASTEXITCODE）。reports\validation-report.md を確認してください。"
    }

    # 正式判定（validate）の後に、変換とルール管理の検証も続けて回す。
    # ここで落ちても validate の結果は既にファイルに残っているので、
    # 個別に失敗を記録して先へ進み、最後に summary で全体を見せる。
    # 引数はハッシュテーブルでスプラットする。@() は「配列部分式」であって splat ではないため、
    # 空配列を渡すと**空配列そのものが第1引数**として束縛され、$BaseUrl が空になって
    # 3本とも即座に「無効なURI」で失敗する（local-corpus.ps1 が同じ罠を回避している）。
    $optional = @(
        @{ name = "corpus-run"; script = "corpus-run.ps1"; params = @{} },
        @{ name = "demo-transform"; script = "demo-transform.ps1"; params = @{} },
        @{ name = "rule-admin-demo"; script = "rule-admin-demo.ps1"; params = @{} }
    )
    $optionalFailures = @()
    foreach ($item in $optional) {
        try {
            # 直前のスクリプトの終了コードが残らないよう毎回リセットする。
            $global:LASTEXITCODE = 0
            $splat = $item.params
            & (Join-Path $PSScriptRoot $item.script) @splat
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
