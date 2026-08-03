param(
    [string]$BaseUrl = "http://localhost:8081",
    [string]$Family = "all",
    [string]$Profile,
    [string]$ChainId,
    [string]$CorpusDir,
    [string]$ReportDir,
    [string]$User = "admin",
    [string]$Password = "admin123"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
if (-not $CorpusDir) { $CorpusDir = Join-Path $Root "corpus\families" }
if (-not $ReportDir) { $ReportDir = Join-Path $Root "reports" }
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

# コーパスの全ケースを「生成 → コンパイル → 振る舞いテスト / ゴールデン差分 → 品質ゲート」に通し、
# コンパイル率・振る舞い合格率・未カバー率を報告する。負例（meta.json の
# expectQualityGate = FAIL）は拒否されるのが正しい。負例が通ってしまうのはゲートの退行なので、
# 両方向を検査する。
#
# ケースは corpus/families/<family>/cases/<case>/ に置き、
#   meta.json          目的・既知の穴・期待するゲート結果
#   input/             変換元ファイル一式
#   output/            期待する成果物。behaviour.json は振る舞い期待値、それ以外はゴールデン成果物
# family.json が family 既定のプロファイル・チェーンEL・入力方式・判定方式を持つ。

$ReportJson = Join-Path $ReportDir "corpus-report.json"
$ReportMd = Join-Path $ReportDir "corpus-report.md"

$AuthHeader = @{}
if ($User) {
    $pair = [Text.Encoding]::UTF8.GetBytes($User + ":" + $Password)
    $AuthHeader = @{ Authorization = "Basic " + [Convert]::ToBase64String($pair) }
}

# ---- Windows PowerShell 5.1 の ConvertTo-Json について（変えるときは必ず読むこと） ----
#
# **`Get-Content` の出力をそのまま body に載せてはいけない。**
# `Get-Content` が返す文字列は PSObject に包まれ、`PSPath` / `PSParentPath` / `PSChildName` /
# `PSDrive` / `PSProvider` というプロバイダ用のメタプロパティが付いている。
# `PSProvider` はさらに own プロパティを持つため、5.1 の ConvertTo-Json はこれを再帰的に展開し、
# **返ってこなくなる**（実測: corpus 1ケース分の body で10分以上応答なし）。
# PowerShell 7 では起きないので、**pwsh では再現せず 5.1 だけで固まる**。
# `.cmd` は `powershell`（5.1）を呼ぶため、corpus-run.cmd と run-all.cmd が丸ごと固まっていた。
#
# 対策は値だけを残すこと — `[string[]]` / `[string]` へキャストする（下の3か所）。
# 深さを下げるだけでは直らない（-Depth 12 でも固まることを実測した）。
#
# 実データの入れ子は body 側で5段程度（body → expectations[] → entry → given → 値）、
# レポート側でも7段程度なので、12 で十分な余裕がある。
$JsonDepth = 12

function Invoke-Api([string]$Method, [string]$Path, $Body) {
    $json = if ($null -eq $Body) { $null } else { $Body | ConvertTo-Json -Depth $JsonDepth -Compress }
    return Invoke-RestMethod -Method $Method -Uri "$BaseUrl$Path" -Headers $AuthHeader `
        -ContentType "application/json; charset=utf-8" -Body $json -TimeoutSec 120
}

function Read-TextFile([string]$Path) {
    return (Get-Content -Path $Path -Raw -Encoding UTF8)
}

# ConvertFrom-Json が返す PSCustomObject を、素のハッシュテーブル／配列／スカラーへ落とす。
#
# 上の `Get-Content` と同じ種類の予防措置である。PSObject に包まれた値を
# 5.1 の ConvertTo-Json へ渡すと余計なメタプロパティまで辿られるため、
# body に載せる前に素の型だけにしておく。
# （5.1 には `ConvertFrom-Json -AsHashtable` が無いため自前で変換する）
function ConvertTo-PlainMap($Object) {
    $map = [ordered]@{}
    foreach ($property in $Object.PSObject.Properties) {
        $value = $property.Value
        if ($value -is [System.Management.Automation.PSCustomObject]) {
            $map[$property.Name] = ConvertTo-PlainMap $value
        } elseif ($value -is [object[]]) {
            $items = @()
            foreach ($item in $value) {
                if ($item -is [System.Management.Automation.PSCustomObject]) {
                    $items += , (ConvertTo-PlainMap $item)
                } else {
                    $items += $item
                }
            }
            $map[$property.Name] = $items
        } else {
            $map[$property.Name] = $value
        }
    }
    return $map
}

# PowerShell の @($null) は要素数1の配列になる。応答に無いフィールドを 0 件として
# 数えるため、null 要素を落としてから数える。
function Get-ItemCount($Value) {
    if ($null -eq $Value) { return 0 }
    return @(@($Value) | Where-Object { $null -ne $_ }).Count
}

Write-Host "対象 Executor : $BaseUrl"
Invoke-RestMethod -Uri "$BaseUrl/actuator/health" -TimeoutSec 10 | Out-Null
Write-Host "  - health OK"

# ---- family の決定 -----------------------------------------------------------
if (-not (Test-Path $CorpusDir)) { throw "コーパスディレクトリがありません: $CorpusDir" }
$familyDirs = @(Get-ChildItem -Path $CorpusDir -Directory | Sort-Object Name)
if ($Family -ne "all") {
    $familyDirs = @($familyDirs | Where-Object { $_.Name -eq $Family })
    if ($familyDirs.Count -eq 0) { throw "family が見つかりません: $Family" }
}
if ($familyDirs.Count -eq 0) { throw "family が1つもありません: $CorpusDir" }

$profileCache = @{}
function Get-ProfileInfo([string]$Name) {
    if (-not $profileCache.ContainsKey($Name)) {
        $profileCache[$Name] = Invoke-Api "GET" "/api/templates/$Name" $null
    }
    return $profileCache[$Name]
}

$chainCache = @{}
function Get-Chain([string]$El) {
    if ($ChainId) { return $ChainId }
    if ($chainCache.ContainsKey($El)) { return $chainCache[$El] }
    $id = "corpus" + ([Guid]::NewGuid().ToString("N")).Substring(0, 10)
    Invoke-Api "POST" "/api/rules/chains" ([ordered]@{
        chainId = $id
        el = $El
        expectedVersion = 0
    }) | Out-Null
    $deadline = (Get-Date).AddSeconds(20)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $probe = Invoke-Api "POST" "/api/flows/$id/execute" ([ordered]@{ payload = "probe" })
            if ($probe.success -eq $true) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 200 }
        Start-Sleep -Milliseconds 400
    }
    if (-not $ready) { throw "chain '$id' が Executor に反映されませんでした。" }
    Write-Host "chain 公開: $id = $El"
    $chainCache[$El] = $id
    return $id
}

# ---- ケース実行 --------------------------------------------------------------
$results = @()
$familySummaries = @()
$profilesUsed = @{}

foreach ($fdir in $familyDirs) {
    $familyMetaPath = Join-Path $fdir.FullName "family.json"
    if (-not (Test-Path $familyMetaPath)) {
        Write-Warning "skip family $($fdir.Name): family.json missing"
        continue
    }
    $fmeta = Read-TextFile $familyMetaPath | ConvertFrom-Json
    $familyProfile = if ($Profile) { $Profile } else { $fmeta.templateProfile }
    $familyEl = if ($fmeta.chainEl) { $fmeta.chainEl } else { "THEN(validate,analyze,transform,compile,test,qualityGate,report)" }
    $inputMode = if ($fmeta.inputMode) { $fmeta.inputMode } else { "single" }
    $grading = if ($fmeta.grading) { $fmeta.grading } else { "behaviour" }

    $caseRoot = Join-Path $fdir.FullName "cases"
    if (-not (Test-Path $caseRoot)) { Write-Warning "skip family $($fdir.Name): cases/ missing"; continue }
    $caseDirs = @(Get-ChildItem -Path $caseRoot -Directory | Sort-Object Name)
    if ($caseDirs.Count -eq 0) { Write-Warning "skip family $($fdir.Name): ケースがありません"; continue }

    Write-Host ""
    Write-Host "== family: $($fdir.Name) — $($fmeta.title)"
    Write-Host "   profile=$familyProfile grading=$grading inputMode=$inputMode"
    $chain = Get-Chain $familyEl

    $familyStart = $results.Count
    foreach ($dir in $caseDirs) {
        $metaPath = Join-Path $dir.FullName "meta.json"
        $inputDir = Join-Path $dir.FullName "input"
        $outputDir = Join-Path $dir.FullName "output"
        if (-not (Test-Path $metaPath) -or -not (Test-Path $inputDir)) {
            Write-Warning "skip $($fdir.Name)/$($dir.Name): meta.json / input が足りません"
            continue
        }
        $meta = Read-TextFile $metaPath | ConvertFrom-Json
        $caseProfile = if ($meta.templateProfile) { $meta.templateProfile } else { $familyProfile }
        $profilesUsed[$caseProfile] = $true

        $inputFiles = @(Get-ChildItem -Path $inputDir -File | Sort-Object Name)
        if ($inputFiles.Count -eq 0) { Write-Warning "skip $($dir.Name): input が空です"; continue }

        # 期待値。behaviour.json は振る舞い、それ以外の output/ 配下はゴールデン成果物。
        $expectations = @()
        $behaviourPath = Join-Path $outputDir "behaviour.json"
        if (Test-Path $behaviourPath) {
            $parsed = Read-TextFile $behaviourPath | ConvertFrom-Json
            # PSCustomObject のまま body に載せると 5.1 の ConvertTo-Json が止まる。
            if ($null -ne $parsed) { $expectations = @($parsed | ForEach-Object { ConvertTo-PlainMap $_ }) }
        }
        $golden = [ordered]@{}
        if (Test-Path $outputDir) {
            foreach ($g in (Get-ChildItem -Path $outputDir -File | Sort-Object Name)) {
                if ($g.Name -eq "behaviour.json") { continue }
                $golden[$g.Name] = [string](Read-TextFile $g.FullName)
            }
        }

        $body = [ordered]@{
            payload          = $dir.Name
            templateProfile  = $caseProfile
            expectations     = $expectations
            maxUncoveredRate = $meta.maxUncoveredRate
        }
        if ($inputMode -eq "single") {
            # 単一ファイル方式は従来どおり sourceLines だけを送る。既存12ケースの
            # 生成コードを1バイトも変えないため、ここは分岐させたままにしておくこと。
            # [string[]] へのキャストが必須。Get-Content が返す文字列には PSPath / PSProvider
            # などのプロバイダ用メタプロパティが付いており、5.1 の ConvertTo-Json はそれを
            # 再帰的に展開して停止する。値だけを残すこと。
            $body["sourceLines"] = [string[]]@(Get-Content -Path $inputFiles[0].FullName -Encoding UTF8 | Where-Object { $_.Trim().Length -gt 0 })
        } else {
            $files = [ordered]@{}
            foreach ($f in $inputFiles) {
                $files[$f.Name] = [string[]]@(Get-Content -Path $f.FullName -Encoding UTF8)
            }
            $body["sourceFiles"] = $files
        }
        if ($meta.entryProgram) { $body["entryProgram"] = $meta.entryProgram }
        if ($golden.Count -gt 0) { $body["goldenArtifacts"] = $golden }

        $response = Invoke-Api "POST" "/api/flows/$chain/execute" $body

        $expectedGate = if ($meta.expectQualityGate) { $meta.expectQualityGate } else { "PASS" }
        $actualGate = if ($response.qualityGate) { $response.qualityGate } else { "UNKNOWN" }
        $verdict = if ($actualGate -eq $expectedGate) { "AS_EXPECTED" } else { "UNEXPECTED" }

        $testsTotal = Get-ItemCount $response.tests
        $testsPassed = Get-ItemCount ($response.tests | Where-Object { $_.passed })
        $goldenTotal = Get-ItemCount $response.golden
        $goldenMatched = Get-ItemCount ($response.golden | Where-Object { $_.matched })

        $results += [ordered]@{
            family            = $fdir.Name
            case              = $dir.Name
            title             = $meta.title
            profile           = $caseProfile
            verdict           = $verdict
            expectedGate      = $expectedGate
            actualGate        = $actualGate
            inputFiles        = @($inputFiles | ForEach-Object { $_.Name })
            sourceLines       = [int]$response.coverage.totalLines
            compileAttempted  = [bool]$response.compile.attempted
            compilerAvailable = [bool]$response.compile.compilerAvailable
            compileSuccess    = [bool]$response.compile.success
            compileErrors     = [int]$response.compile.errorCount
            testsTotal        = $testsTotal
            testsPassed       = $testsPassed
            goldenTotal       = $goldenTotal
            goldenMatched     = $goldenMatched
            goldenDetail      = @(@($response.golden) | Where-Object { $null -ne $_ })
            totalLines        = [int]$response.coverage.totalLines
            recognisedLines   = [int]$response.coverage.recognisedLines
            unrecognisedLines = [int]$response.coverage.unrecognisedLines
            uncoveredRate     = [double]$response.coverage.uncoveredRate
            byRule            = $response.coverage.byRule
            unrecognisedSamples = @($response.coverage.unrecognisedSamples)
            findings          = @($response.qualityGateFindings)
            knownGaps         = @($meta.knownGaps)
            generatedCode     = $response.generatedCode
            generatedArtifacts = $response.generatedArtifacts
            generatedJava     = $response.compile.source
        }

        $flag = if ($verdict -eq "AS_EXPECTED") { "OK  " } else { "XX  " }
        $extra = if ($goldenTotal -gt 0) { " golden=$goldenMatched/$goldenTotal" } else { "" }
        Write-Host ("  {0}{1,-26} gate={2,-4} (expected {3,-4}) compile={4} tests={5}/{6}{7} uncovered={8:P1}" -f `
            $flag, $dir.Name, $actualGate, $expectedGate, $response.compile.success, $testsPassed, $testsTotal, $extra, $response.coverage.uncoveredRate)
    }

    $fr = @($results[$familyStart..($results.Count - 1)])
    if ($results.Count -eq $familyStart) { $fr = @() }
    $fPositive = @($fr | Where-Object { $_.expectedGate -eq "PASS" })
    $fLines = 0; $fUncov = 0; $fBehTotal = 0; $fBehPassed = 0; $fGoldTotal = 0; $fGoldMatched = 0
    foreach ($r in $fr) { $fLines += [int]$r.totalLines; $fUncov += [int]$r.unrecognisedLines }
    foreach ($r in $fPositive) { $fBehTotal += [int]$r.testsTotal; $fBehPassed += [int]$r.testsPassed }
    foreach ($r in $fr) { $fGoldTotal += [int]$r.goldenTotal; $fGoldMatched += [int]$r.goldenMatched }
    $familySummaries += [ordered]@{
        family = $fdir.Name
        title = $fmeta.title
        templateProfile = $familyProfile
        chainEl = $familyEl
        grading = $grading
        cases = $fr.Count
        asExpected = @($fr | Where-Object { $_.verdict -eq "AS_EXPECTED" }).Count
        positiveCases = $fPositive.Count
        negativeCases = @($fr | Where-Object { $_.expectedGate -eq "FAIL" }).Count
        positiveCasesCompiled = @($fPositive | Where-Object { $_.compileSuccess }).Count
        behaviourCasesTotal = $fBehTotal
        behaviourCasesPassed = $fBehPassed
        goldenArtifactsTotal = $fGoldTotal
        goldenArtifactsMatched = $fGoldMatched
        sourceLines = $fLines
        uncoveredLines = $fUncov
        uncoveredRate = [Math]::Round($(if ($fLines -gt 0) { $fUncov / $fLines } else { 0 }), 4)
    }
}

# ---- 集計 --------------------------------------------------------------------
$total = $results.Count
if ($total -eq 0) { throw "実行できたケースが1件もありません。" }
$asExpected = @($results | Where-Object { $_.verdict -eq "AS_EXPECTED" }).Count
$positive = @($results | Where-Object { $_.expectedGate -eq "PASS" })
$negative = @($results | Where-Object { $_.expectedGate -eq "FAIL" })
$compiledOk = @($positive | Where-Object { $_.compileSuccess }).Count
# Measure-Object は OrderedDictionary のキーを読めないため、明示的に合計する。
$behaviourTotal = 0; $behaviourPassed = 0; $linesTotal = 0; $linesUncovered = 0
$goldTotal = 0; $goldMatched = 0
foreach ($r in $positive) { $behaviourTotal += [int]$r.testsTotal; $behaviourPassed += [int]$r.testsPassed }
foreach ($r in $results) { $linesTotal += [int]$r.totalLines; $linesUncovered += [int]$r.unrecognisedLines }
foreach ($r in $results) { $goldTotal += [int]$r.goldenTotal; $goldMatched += [int]$r.goldenMatched }
$overallUncovered = if ($linesTotal -gt 0) { $linesUncovered / $linesTotal } else { 0 }
$status = if ($asExpected -eq $total) { "PASS" } else { "FAIL" }

$ruleTotals = @{}
foreach ($r in $results) {
    if ($r.byRule) {
        foreach ($p in $r.byRule.PSObject.Properties) {
            $ruleTotals[$p.Name] = [int]$ruleTotals[$p.Name] + [int]$p.Value
        }
    }
}

$profileViews = @()
foreach ($name in ($profilesUsed.Keys | Sort-Object)) {
    $pi = Get-ProfileInfo $name
    $profileViews += [ordered]@{
        name = $pi.profile
        version = $pi.version
        owner = $pi.owner
        ruleCount = @($pi.rules).Count
        source = $pi.source
    }
}

$report = [ordered]@{
    status = $status
    ranAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    baseUrl = $BaseUrl
    familyFilter = $Family
    templateProfiles = $profileViews
    summary = [ordered]@{
        families = $familySummaries.Count
        cases = $total
        asExpected = $asExpected
        unexpected = $total - $asExpected
        positiveCases = $positive.Count
        negativeCases = $negative.Count
        positiveCasesCompiled = $compiledOk
        behaviourCasesTotal = $behaviourTotal
        behaviourCasesPassed = $behaviourPassed
        goldenArtifactsTotal = $goldTotal
        goldenArtifactsMatched = $goldMatched
        cobolLines = $linesTotal
        uncoveredLines = $linesUncovered
        overallUncoveredRate = [Math]::Round($overallUncovered, 4)
    }
    families = $familySummaries
    statementsByRule = $ruleTotals
    scope = ("Synthetic seed fixtures written to exercise the rule tables. They validate the " +
             "generate/compile/test machinery only - they are NOT real assets and say nothing " +
             "about coverage of a real estate or about semantic equivalence between the source " +
             "language and the generated Java.")
    cases = $results
}
$report | ConvertTo-Json -Depth $JsonDepth | Set-Content -Encoding UTF8 $ReportJson

$md = @()
$md += "# Transformation corpus report"
$md += ""
$md += "- Ran at: $($report.ranAt)"
$md += "- Executor: $BaseUrl"
$md += "- Family filter: ``$Family``"
$md += "- Overall: **$status** — $asExpected / $total cases behaved as expected"
$md += ""
$md += "> Synthetic seed fixtures. They exercise the generate -> compile -> behavioural-test / golden-diff loop."
$md += "> They are **not** real assets and prove nothing about coverage of a real estate,"
$md += "> nor about semantic equivalence between the source language and the generated Java."
$md += ""
$md += "## Rule profiles used"
$md += ""
$md += "| Profile | Version | Owner | Rules | Source |"
$md += "|---|---:|---|---:|---|"
foreach ($p in $profileViews) {
    $md += "| $($p.name) | $($p.version) | $($p.owner) | $($p.ruleCount) | ``$($p.source)`` |"
}
$md += ""
$md += "## Summary by family"
$md += ""
$md += "| Family | Cases | As expected | Compiled | Behaviour | Golden | Uncovered |"
$md += "|---|---:|---:|---:|---:|---:|---:|"
foreach ($f in $familySummaries) {
    $md += ("| {0} | {1} | {2}/{1} | {3}/{4} | {5}/{6} | {7}/{8} | {9:P2} |" -f `
        $f.family, $f.cases, $f.asExpected, $f.positiveCasesCompiled, $f.positiveCases, `
        $f.behaviourCasesPassed, $f.behaviourCasesTotal, $f.goldenArtifactsMatched, $f.goldenArtifactsTotal, $f.uncoveredRate)
}
$md += ""
$md += "## Overall"
$md += ""
$md += "| Metric | Value |"
$md += "|---|---:|"
$md += "| Cases | $total (positive $($positive.Count) / negative $($negative.Count)) |"
$md += "| Behaved as expected | $asExpected / $total |"
$md += "| Positive cases that compiled | $compiledOk / $($positive.Count) |"
$md += "| Behavioural checks passed | $behaviourPassed / $behaviourTotal |"
$md += "| Golden artifacts matched | $goldMatched / $goldTotal |"
$md += "| Source lines processed | $linesTotal |"
$md += "| Uncovered lines | $linesUncovered |"
$md += ("| **Overall uncovered rate** | **{0:P2}** |" -f $overallUncovered)
$md += ""
$md += "## Statements recognised, by rule"
$md += ""
$md += "| Rule | Lines |"
$md += "|---|---:|"
foreach ($key in ($ruleTotals.Keys | Sort-Object)) { $md += "| $key | $($ruleTotals[$key]) |" }
$md += ""
$md += "## Cases"
$md += ""
$md += "| Family | Case | Gate | Expected | Compile | Behaviour | Golden | Uncovered | Verdict |"
$md += "|---|---|---|---|---|---:|---:|---:|---|"
foreach ($r in $results) {
    $md += ("| {0} | {1} | {2} | {3} | {4} | {5}/{6} | {7}/{8} | {9:P1} | {10} |" -f `
        $r.family, $r.case, $r.actualGate, $r.expectedGate, $r.compileSuccess, `
        $r.testsPassed, $r.testsTotal, $r.goldenMatched, $r.goldenTotal, $r.uncoveredRate, $r.verdict)
}
$md += ""
$md += "## Findings per case"
$md += ""
foreach ($r in $results) {
    $md += "### $($r.family) / $($r.case) — $($r.title)"
    $md += ""
    $md += "- gate: **$($r.actualGate)** (expected $($r.expectedGate)) → $($r.verdict)"
    $md += "- input: $((@($r.inputFiles) -join ', '))"
    if ($r.findings.Count -gt 0) {
        $md += "- quality gate findings:"
        foreach ($f in $r.findings) { $md += "  - $f" }
    }
    if ($r.unrecognisedSamples.Count -gt 0) {
        $md += "- unrecognised lines:"
        foreach ($u in $r.unrecognisedSamples) { $md += "  - ``$u``" }
    }
    if ($r.knownGaps.Count -gt 0) {
        $md += "- known gaps (declared in meta.json):"
        foreach ($g in $r.knownGaps) { $md += "  - $g" }
    }
    $md += ""
}
$md += "## Next"
$md += ""
$md += "Replace these fixtures with real assets, expected output confirmed by a domain owner,"
$md += "and input/output datasets captured from real runs. Track the uncovered rate per family as"
$md += "the primary measure of how far each rule library still is from its target estate."
$md -join "`n" | Set-Content -Encoding UTF8 $ReportMd

Write-Host ""
Write-Host "判定: $status ($asExpected/$total cases as expected)"
Write-Host ("  - 正例のコンパイル成功  : {0}/{1}" -f $compiledOk, $positive.Count)
Write-Host ("  - 振る舞いテスト合格    : {0}/{1}" -f $behaviourPassed, $behaviourTotal)
if ($goldTotal -gt 0) {
    Write-Host ("  - ゴールデン成果物一致  : {0}/{1}" -f $goldMatched, $goldTotal)
}
Write-Host ("  - 全体の未カバー率      : {0:P2} ({1}/{2} lines)" -f $overallUncovered, $linesUncovered, $linesTotal)
Write-Host "証跡: $ReportMd"
Write-Host "      $ReportJson"
if ($status -ne "PASS") { exit 1 }
