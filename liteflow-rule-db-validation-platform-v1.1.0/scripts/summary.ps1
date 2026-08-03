param(
    [string]$ReportDir
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
if (-not $ReportDir) { $ReportDir = Join-Path $Root "reports" }
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

# reports/ にある各レポートの判定を1枚の表にまとめる。
# 「どれを見ればいいのか分からない」を無くすための入口。
# 何も新しく検証しない。既に出ている証跡を読むだけ。

$SummaryMd = Join-Path $ReportDir "summary.md"
$SummaryJson = Join-Path $ReportDir "summary.json"

function Read-Json([string]$Path) {
    if (-not (Test-Path $Path)) { return $null }
    try { return Get-Content -Path $Path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
}

# 手順 → レポート → 判定の取り出し方
$Sources = @(
    [ordered]@{ step = "B"; name = "静的事前確認"; file = "preflight-report.json"
        detail = "Docker不要。ファイル欠損・構文・設定不整合・コーパス構造" }
    [ordered]@{ step = "C"; name = "ホストビルドとテスト"; file = "local-verify.json"
        detail = "Docker不要。JUnit 一式" }
    [ordered]@{ step = "C-2"; name = "ルール発火状況"; file = "rule-usage.json"
        detail = "宣言したルールをコーパスが実際に通しているか。status=PASS は「新しい死んだルールが無い」の意味で、全ルール検証済みではない" }
    [ordered]@{ step = "D-1"; name = "Dockerイメージ構築"; file = "build-evidence.json"
        detail = "コンテナ内 mvn clean verify" }
    [ordered]@{ step = "D-2"; name = "Rule-DB E2E検証（正式判定）"; file = "validation-report.json"
        detail = "2ノード同期・楽観ロック・監視・再起動再ロード・ルール管理" }
    [ordered]@{ step = "E"; name = "変換デモ"; file = "transform-demo.json"
        detail = "テンプレートとDBスクリプトの差し替えで生成コードが変わる" }
    [ordered]@{ step = "F/J/K"; name = "コーパス回帰"; file = "corpus-report.json"
        detail = "生成 → コンパイル → 振る舞い / ゴールデン差分" }
    [ordered]@{ step = "K-2"; name = "サンプル実プロジェクト"; file = "samples-build.json"
        detail = "Struts と Spring Boot 両方の実ビルドと画面確認" }
    [ordered]@{ step = "L"; name = "ルール管理デモ"; file = "rule-admin-demo.json"
        detail = "認証・履歴・差分・ロールバック・承認・監査" }
)

$rows = @()
foreach ($source in $Sources) {
    $path = Join-Path $ReportDir $source.file
    $json = Read-Json $path
    $status = "NOT_RUN"
    $note = "未実行"
    if ($null -ne $json) {
        if ($json.PSObject.Properties.Name -contains "overallStatus") {
            $status = $json.overallStatus
        } elseif ($json.PSObject.Properties.Name -contains "status") {
            $status = $json.status
        } else {
            $status = "UNKNOWN"
        }
        $note = ""
        if ($json.PSObject.Properties.Name -contains "summary" -and $null -ne $json.summary) {
            $s = $json.summary
            if ($s.PSObject.Properties.Name -contains "PASS") {
                $note = "PASS $($s.PASS) / FAIL $($s.FAIL) / WARN $($s.WARN) / SKIP $($s.SKIP)"
            } elseif ($s.PSObject.Properties.Name -contains "cases") {
                $note = "$($s.asExpected)/$($s.cases) cases as expected、未カバー率 " +
                        ("{0:P2}" -f [double]$s.overallUncoveredRate)
            }
        }
        if (-not $note -and ($json.PSObject.Properties.Name -contains "junit")) {
            $note = "tests $($json.junit.tests) / failures $($json.junit.failures)"
        }
        if (-not $note -and ($json.PSObject.Properties.Name -contains "assertions")) {
            $total = @($json.assertions.PSObject.Properties).Count
            $ok = @($json.assertions.PSObject.Properties | Where-Object { $_.Value -eq $true }).Count
            $note = "断言 $ok/$total"
        }
        if (-not $note) { $note = "-" }
    }
    $rows += [ordered]@{
        step = $source.step
        name = $source.name
        file = $source.file
        status = $status
        note = $note
        detail = $source.detail
        ranAt = if ($null -ne $json -and ($json.PSObject.Properties.Name -contains "ranAt")) { $json.ranAt }
                elseif ($null -ne $json -and ($json.PSObject.Properties.Name -contains "completedAt")) { $json.completedAt }
                else { "" }
    }
}

$failed = @($rows | Where-Object { $_.status -eq "FAIL" })
$notRun = @($rows | Where-Object { $_.status -eq "NOT_RUN" })
$overall = if ($failed.Count -gt 0) { "FAIL" } elseif ($notRun.Count -gt 0) { "PARTIAL" } else { "PASS" }

$report = [ordered]@{
    overall = $overall
    generatedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    failed = @($failed | ForEach-Object { $_.file })
    notRun = @($notRun | ForEach-Object { $_.file })
    reports = $rows
    scope = ("Aggregates the verdicts already written by each step. It runs no checks of its own. " +
             "NOT_RUN means the step has not been executed in this working copy, not that it passed.")
}
$report | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $SummaryJson

$md = @()
$md += "# 検証サマリ"
$md += ""
$md += "- 生成: $($report.generatedAt)"
$md += "- 総合: **$overall**"
$md += ""
$md += "> このファイルは既に出ている各レポートの判定を集めただけで、何も新しく検証していない。"
$md += "> **NOT_RUN は「合格」ではなく「まだ実行していない」** を意味する。"
$md += ""
$md += "| 手順 | 検証 | 判定 | 内訳 | レポート |"
$md += "|---|---|---|---|---|"
foreach ($row in $rows) {
    $mark = switch ($row.status) {
        "PASS" { "**PASS**" }
        "FAIL" { "**FAIL**" }
        "NOT_RUN" { "_未実行_" }
        default { $row.status }
    }
    $md += "| $($row.step) | $($row.name) | $mark | $($row.note) | ``reports/$($row.file)`` |"
}
$md += ""
$md += "## 各検証が何を見ているか"
$md += ""
foreach ($row in $rows) { $md += "- **$($row.name)** — $($row.detail)" }
$md += ""
$md += "## 正式判定はどれか"
$md += ""
$md += "オーケストレーション層の正式判定は **手順D-2 の `reports/validation-report.md`** だけである。"
$md += "他のレポートは補助的な証跡であり、Docker 2ノード構成での結果ではない場合がある。"
$md += ""
$md += "**どのレポートも、COBOL/Java の意味同値性と Struts/Spring Boot の業務等価性については何も示していない。**"
$md -join "`n" | Set-Content -Encoding UTF8 $SummaryMd

Write-Host "総合: $overall"
foreach ($row in $rows) {
    Write-Host ("  {0,-6} {1,-28} {2,-9} {3}" -f $row.step, $row.name, $row.status, $row.note)
}
Write-Host ""
Write-Host "証跡: $SummaryMd"
if ($overall -eq "FAIL") { exit 1 }
