param(
    [string]$BaseUrl = "http://localhost:8081",
    [string]$ReportPath,
    [string]$User = "admin",
    [string]$Password = "admin123"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
New-Item -ItemType Directory -Force -Path "reports" | Out-Null
if (-not $ReportPath) { $ReportPath = Join-Path $Root "reports\transform-demo.json" }

# ルール駆動のコード変換が2つの層で設定可能であることを実演する。
#   A. テンプレート表（リクエストごとに渡すデータ） -> 同じchainでも出力が変わる
#   B. Rule-DB に格納したスクリプトノードのソース   -> ロジックの追加・変更を再デプロイなしで
# 以下の処理はアプリの再起動も再ビルドも行わない。

$Suffix = ([Guid]::NewGuid().ToString("N")).Substring(0, 10)
$ChainId = "demoTransform$Suffix"
$ScriptNodeId = "postProcess$Suffix"

$SourceLines = @(
    "MOVE WS-CUSTOMER-NAME TO WS-OUT-NAME.",
    "ADD 1 TO WS-RECORD-COUNT.",
    "DISPLAY 'MIGRATION DONE'.",
    "PERFORM SOME-UNSUPPORTED-PARA."
)

$TemplatesV1 = [ordered]@{
    move    = '${target} = ${source};'
    add     = '${target} += ${source};'
    display = 'System.out.println(${value});'
    unknown = '// TODO unsupported: ${line}'
}
# ここで変えるのはテンプレートだけ。Javaには一切触れない。
$TemplatesV2 = [ordered]@{
    move    = 'this.${target} = this.${source};   // COBOL MOVE'
    add     = 'this.${target} = this.${target} + ${source};   // COBOL ADD'
    display = 'log.info("{}", ${value});'
    unknown = '// [MANUAL REVIEW REQUIRED] ${line}'
}

$ScriptV1 = @'
migrationContext.addStep("postProcess");
migrationContext.emit("// migrated by rule-db script v1");
'@

# ここで変えるのはスクリプト本文だけ。本文はjarではなくデータベースにある。
$ScriptV2 = @'
migrationContext.addStep("postProcess");
def produced = migrationContext.getGeneratedLines().size();
migrationContext.emit("// migrated by rule-db script v2");
migrationContext.emit("// statements generated: " + produced);
migrationContext.emit("// reviewed: true");
'@

$Steps = @()

# /api/rules/** は SecurityConfig で保護されている。実行API（/api/flows/**）は無認証のまま。
$AuthHeader = @{}
if ($User) {
    $pair = [Text.Encoding]::UTF8.GetBytes($User + ":" + $Password)
    $AuthHeader = @{ Authorization = "Basic " + [Convert]::ToBase64String($pair) }
}

function Invoke-Api([string]$Method, [string]$Path, $Body) {
    $json = if ($null -eq $Body) { $null } else { $Body | ConvertTo-Json -Depth 8 -Compress }
    return Invoke-RestMethod -Method $Method -Uri "$BaseUrl$Path" -Headers $AuthHeader -ContentType "application/json; charset=utf-8" -Body $json -TimeoutSec 20
}

function Invoke-Transform([string]$Chain, $Templates) {
    $body = [ordered]@{
        payload     = "demo"
        sourceLines = $SourceLines
        templates   = $Templates
    }
    return Invoke-Api "POST" "/api/flows/$Chain/execute" $body
}

# 公開直後のchainがこのExecutorに届くまでにはポーリング1周期分かかる。
function Wait-Trace([string]$Chain, [string[]]$Expected, $Templates, [int]$TimeoutSec = 20) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $last = $null
    while ((Get-Date) -lt $deadline) {
        try {
            $last = Invoke-Transform $Chain $Templates
            if ($last.success -eq $true -and (@($last.trace) -join ",") -eq ($Expected -join ",")) {
                return $last
            }
        } catch {
            $last = @{ error = $_.Exception.Message }
        }
        Start-Sleep -Milliseconds 400
    }
    throw ("chain '$Chain' が期待 trace [$($Expected -join ',')] に収束しませんでした。last=" +
           ($last | ConvertTo-Json -Depth 6 -Compress))
}

Write-Host "対象 Executor: $BaseUrl"
Invoke-RestMethod -Uri "$BaseUrl/actuator/health" -TimeoutSec 10 | Out-Null
Write-Host "  - health OK"

Write-Host ""
Write-Host "[1/4] テンプレート版 chain を公開: THEN(validate,transform,report)"
Invoke-Api "POST" "/api/rules/chains" ([ordered]@{
    chainId = $ChainId
    el = "THEN(validate,transform,report)"
    expectedVersion = 0
}) | Out-Null

$runA = Wait-Trace $ChainId @("validate", "transform", "report") $TemplatesV1
Write-Host "  - 生成コード (テンプレート v1):"
$runA.generatedCode -split "`n" | ForEach-Object { Write-Host "      $_" }
$Steps += [ordered]@{ step = "A1-template-v1"; changed = "nothing (baseline)"; trace = $runA.trace; generatedCode = $runA.generatedCode }

Write-Host ""
Write-Host "[2/4] テンプレートだけ差し替えて再実行（デプロイなし・chain も不変）"
$runB = Invoke-Transform $ChainId $TemplatesV2
Write-Host "  - 生成コード (テンプレート v2):"
$runB.generatedCode -split "`n" | ForEach-Object { Write-Host "      $_" }
$Steps += [ordered]@{ step = "A2-template-v2"; changed = "template table only"; trace = $runB.trace; generatedCode = $runB.generatedCode }

Write-Host ""
Write-Host "[3/4] Rule-DB に Groovy script ノードを公開し、chain に組み込む"
$scriptPublish = Invoke-Api "POST" "/api/rules/scripts" ([ordered]@{
    nodeId = $ScriptNodeId
    script = $ScriptV1
    name = "post process (demo)"
    type = "script"
    language = "groovy"
    expectedVersion = 0
})
Write-Host "  - script version=$($scriptPublish.version) op=$($scriptPublish.operation)"

Invoke-Api "POST" "/api/rules/chains" ([ordered]@{
    chainId = $ChainId
    el = "THEN(validate,transform,$ScriptNodeId,report)"
    expectedVersion = 1
}) | Out-Null

$runC = Wait-Trace $ChainId @("validate", "transform", "postProcess", "report") $TemplatesV2
Write-Host "  - 生成コード (script v1 追加後):"
$runC.generatedCode -split "`n" | ForEach-Object { Write-Host "      $_" }
$Steps += [ordered]@{ step = "B1-script-v1"; changed = "new script node stored in Rule-DB + chain EL"; trace = $runC.trace; generatedCode = $runC.generatedCode }

Write-Host ""
Write-Host "[4/4] script 本文だけを更新（chain も jar も不変、再起動なし）"
$scriptUpdate = Invoke-Api "POST" "/api/rules/scripts" ([ordered]@{
    nodeId = $ScriptNodeId
    script = $ScriptV2
    name = "post process (demo)"
    type = "script"
    language = "groovy"
    expectedVersion = $scriptPublish.version
})
Write-Host "  - script version=$($scriptUpdate.version) op=$($scriptUpdate.operation)"

$deadline = (Get-Date).AddSeconds(20)
$runD = $null
while ((Get-Date) -lt $deadline) {
    $candidate = Invoke-Transform $ChainId $TemplatesV2
    if ($candidate.generatedCode -like "*script v2*") { $runD = $candidate; break }
    Start-Sleep -Milliseconds 400
}
if (-not $runD) { throw "script v2 が収束しませんでした。" }
Write-Host "  - 生成コード (script v2):"
$runD.generatedCode -split "`n" | ForEach-Object { Write-Host "      $_" }
$Steps += [ordered]@{ step = "B2-script-v2"; changed = "script body only"; trace = $runD.trace; generatedCode = $runD.generatedCode }

$templateChanged = $runA.generatedCode -ne $runB.generatedCode
$scriptAdded = $runB.generatedCode -ne $runC.generatedCode
$scriptChanged = $runC.generatedCode -ne $runD.generatedCode
$status = if ($templateChanged -and $scriptAdded -and $scriptChanged) { "PASS" } else { "FAIL" }

[ordered]@{
    status = $status
    ranAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    baseUrl = $BaseUrl
    chainId = $ChainId
    scriptNodeId = $ScriptNodeId
    sourceLines = $SourceLines
    # assertions は「true でなければ失敗」のものだけを入れる。
    # 「再起動していない」「再ビルドしていない」は事実の記録であって合否条件ではないので、
    # facts の側へ分けてある（混ぜると集計で false 2件が失敗に見えてしまう）。
    assertions = [ordered]@{
        templateSwapChangesOutput = $templateChanged
        dbScriptNodeAddsBehaviour = $scriptAdded
        dbScriptEditChangesOutput = $scriptChanged
    }
    facts = [ordered]@{
        applicationRestarted = $false
        applicationRebuilt = $false
    }
    scope = ("Proves transformation logic is configurable at runtime (templates + Rule-DB script nodes). " +
             "Does NOT prove COBOL parsing coverage or COBOL/Java semantic equivalence.")
    steps = $Steps
} | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $ReportPath

Write-Host ""
Write-Host "判定: $status"
Write-Host "  - テンプレート差し替えで出力が変化: $templateChanged"
Write-Host "  - DB の script ノード追加で挙動が変化: $scriptAdded"
Write-Host "  - script 本文の更新だけで出力が変化: $scriptChanged"
Write-Host "証跡: $ReportPath"
if ($status -ne "PASS") { exit 1 }
