param(
    [string]$BaseUrl = "http://localhost:8081",
    [string]$PeerUrl = "http://localhost:8082",
    [string]$AdminUser = "admin",
    [string]$AdminPassword = "admin123",
    [string]$ApproverUser = "approver",
    [string]$ApproverPassword = "approver123",
    [string]$ViewerUser = "viewer",
    [string]$ViewerPassword = "viewer123",
    [string]$ReportPath
)
$ErrorActionPreference = "Stop"
trap {
    $RootForTrap = Split-Path -Parent $PSScriptRoot
    $ReportsForTrap = Join-Path $RootForTrap "reports"
    New-Item -ItemType Directory -Force -Path $ReportsForTrap | Out-Null
    $FailurePath = Join-Path $ReportsForTrap "rule-admin-demo-failure.txt"
    $Lines = @(
        "status=FAIL",
        "failedAt=$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))",
        "message=$($_.Exception.Message)"
    )
    Set-Content -Encoding UTF8 -Path $FailurePath -Value $Lines
    [Console]::Error.WriteLine("Operation failed. See $FailurePath")
    exit 1
}
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
New-Item -ItemType Directory -Force -Path "reports" | Out-Null
if (-not $ReportPath) { $ReportPath = Join-Path $Root "reports\rule-admin-demo.json" }

# シナリオ#3「業務ルール管理・公開基盤」を端から端まで動かす。
#
#   1. 無認証で管理APIを叩くと拒否される
#   2. 参照専用ユーザーは読めるが書けない
#   3. 発行するたびに履歴（発行後の本文）が残る
#   4. 2つの版の差分が取れる
#   5. ロールバックすると Executor の挙動が旧版に戻る（版番号は前へ進む）
#   6. 申請 → 承認 → 反映（PENDING → APPLIED）
#   7. 承認権限の無いユーザーは承認できない
#  7b. 申請者本人は自分の申請を承認できない（職務分離）
#  7c. 管理画面のフォームログインとログアウトがブラウザと同じ経路で通る
#   8. すべての操作が監査ログに残る
#
# 手順E（demo-transform）が「変換ロジックを設定で変えられる」ことを示すのに対し、
# こちらは「その設定変更を統制できる」ことを示す。

function Auth([string]$User, [string]$Password) {
    $pair = [Text.Encoding]::UTF8.GetBytes("${User}:${Password}")
    return @{ Authorization = "Basic " + [Convert]::ToBase64String($pair) }
}
$AdminAuth = Auth $AdminUser $AdminPassword
$ApproverAuth = Auth $ApproverUser $ApproverPassword
$ViewerAuth = Auth $ViewerUser $ViewerPassword

function Invoke-Api([string]$Method, [string]$Path, $Body, $Headers, [string]$Url) {
    if (-not $Url) { $Url = $BaseUrl }
    $json = if ($null -eq $Body) { $null } else { $Body | ConvertTo-Json -Depth 12 -Compress }
    return Invoke-RestMethod -Method $Method -Uri "$Url$Path" -Headers $Headers `
        -ContentType "application/json; charset=utf-8" -Body $json -TimeoutSec 60
}

function Get-Status([string]$Method, [string]$Path, $Body, $Headers) {
    $json = if ($null -eq $Body) { $null } else { $Body | ConvertTo-Json -Depth 12 -Compress }
    try {
        $res = Invoke-WebRequest -Method $Method -Uri "$BaseUrl$Path" -Headers $Headers `
            -ContentType "application/json; charset=utf-8" -Body $json -TimeoutSec 60 -UseBasicParsing
        return [int]$res.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        throw
    }
}

function Wait-Trace([string]$ChainId, [string]$Expected, [string]$Url) {
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        try {
            $res = Invoke-Api "POST" "/api/flows/$ChainId/execute" ([ordered]@{ payload = "probe" }) @{} $Url
            if ((($res.trace) -join ",") -eq $Expected) { return $res }
        } catch { Start-Sleep -Milliseconds 200 }
        Start-Sleep -Milliseconds 400
    }
    throw "chain '$ChainId' が $Url で '$Expected' になりませんでした。"
}

Write-Host "対象 Executor : $BaseUrl（隣: $PeerUrl）"
Invoke-RestMethod -Uri "$BaseUrl/actuator/health" -TimeoutSec 10 | Out-Null
Write-Host "  - health OK"

$ChainId = "govDemo" + ([Guid]::NewGuid().ToString("N")).Substring(0, 10)
$V1 = "THEN(validate,transform,report)"
$V2 = "THEN(validate,analyze,transform,report)"
$V3 = "THEN(validate,analyze,transform,review,report)"
$steps = @()
$assertions = [ordered]@{}

# ---- 1. 認証 ------------------------------------------------------------------
Write-Host "[1/8] 無認証と権限不足の拒否"
$anonStatus = Get-Status "GET" "/api/rules" $null @{}
$viewerWriteStatus = Get-Status "POST" "/api/rules/chains" ([ordered]@{ chainId = $ChainId; el = $V1; expectedVersion = 0 }) $ViewerAuth
$flowsAnonStatus = Get-Status "POST" "/api/flows/$ChainId/execute" ([ordered]@{ payload = "anon" }) @{}
Write-Host "  - 無認証で GET /api/rules        -> $anonStatus (401 期待)"
Write-Host "  - viewer で POST /api/rules/chains -> $viewerWriteStatus (403 期待)"
Write-Host "  - 無認証で 実行API                -> $flowsAnonStatus (認証不要のまま)"
$assertions["anonymousRejected"] = ($anonStatus -eq 401)
$assertions["viewerCannotWrite"] = ($viewerWriteStatus -eq 403)
$assertions["executionStaysOpen"] = ($flowsAnonStatus -ne 401 -and $flowsAnonStatus -ne 403)

# ---- 2〜3. 発行と履歴 ----------------------------------------------------------
Write-Host "[2/8] 3回発行して履歴を積む"
$p1 = Invoke-Api "POST" "/api/rules/chains" ([ordered]@{ chainId = $ChainId; el = $V1; expectedVersion = 0; comment = "初版" }) $AdminAuth
Wait-Trace $ChainId "validate,transform,report" $BaseUrl | Out-Null
$p2 = Invoke-Api "POST" "/api/rules/chains" ([ordered]@{ chainId = $ChainId; el = $V2; expectedVersion = $p1.version; comment = "analyze を追加" }) $AdminAuth
Wait-Trace $ChainId "validate,analyze,transform,report" $BaseUrl | Out-Null
$p3 = Invoke-Api "POST" "/api/rules/chains" ([ordered]@{ chainId = $ChainId; el = $V3; expectedVersion = $p2.version; comment = "review を追加" }) $AdminAuth
$runV3 = Wait-Trace $ChainId "validate,analyze,transform,review,report" $BaseUrl
Write-Host "  - version $($p1.version) → $($p2.version) → $($p3.version)"
$steps += [ordered]@{ step = "publish"; versions = @($p1.version, $p2.version, $p3.version); traceV3 = $runV3.trace }

Write-Host "[3/8] 履歴の確認"
$history = Invoke-Api "GET" "/api/rules/CHAIN/$ChainId/revisions" $null $AdminAuth
Write-Host "  - 履歴 $($history.count) 件"
$assertions["historyRecorded"] = ($history.count -ge 3)
$steps += [ordered]@{ step = "history"; count = $history.count
    revisions = @($history.revisions | ForEach-Object { [ordered]@{ version = $_.version; actor = $_.actor; comment = $_.comment; body = $_.body } }) }

# ---- 4. 差分 -------------------------------------------------------------------
Write-Host "[4/8] 版1と版3の差分"
$diff = Invoke-Api "GET" "/api/rules/CHAIN/$ChainId/diff?from=$($p1.version)&to=$($p3.version)" $null $AdminAuth
Write-Host "  - 変更行数 $($diff.changedLines)"
$assertions["diffNotEmpty"] = ($diff.changedLines -gt 0)
$steps += [ordered]@{ step = "diff"; from = $p1.version; to = $p3.version; changedLines = $diff.changedLines; lines = @($diff.lines) }

# ---- 5. ロールバック -----------------------------------------------------------
Write-Host "[5/8] 版1へロールバック"
$rollback = Invoke-Api "POST" "/api/rules/CHAIN/$ChainId/rollback" ([ordered]@{ toVersion = $p1.version; comment = "デモのロールバック" }) $AdminAuth
$afterRollback = Wait-Trace $ChainId "validate,transform,report" $BaseUrl
Write-Host "  - 版 $($rollback.restoredFromVersion) の本文を版 $($rollback.newVersion) として再発行"
Write-Host "  - Executor の trace: $((($afterRollback.trace) -join ','))"
$assertions["rollbackRestoresBehaviour"] = ((($afterRollback.trace) -join ",") -eq "validate,transform,report")
$assertions["rollbackMovesVersionForward"] = ($rollback.newVersion -gt $p3.version)
$steps += [ordered]@{ step = "rollback"; restoredFrom = $rollback.restoredFromVersion
    previousVersion = $rollback.previousVersion; newVersion = $rollback.newVersion
    traceAfter = $afterRollback.trace }

# ---- 6〜7. 承認フロー ----------------------------------------------------------
Write-Host "[6/8] 変更申請 → 承認 → 反映"
$request = Invoke-Api "POST" "/api/rules/approvals" ([ordered]@{
    targetType = "CHAIN"; targetId = $ChainId; body = $V2; comment = "analyze を戻したい"
}) $AdminAuth
Write-Host "  - 申請 #$($request.id) = $($request.status)"
$pendingTrace = (Invoke-Api "POST" "/api/flows/$ChainId/execute" ([ordered]@{ payload = "still-old" }) @{}).trace
$assertions["pendingNotApplied"] = ((($pendingTrace) -join ",") -eq "validate,transform,report")

Write-Host "[7/8] 承認権限の確認"
$viewerApprove = Get-Status "POST" "/api/rules/approvals/$($request.id)/approve" ([ordered]@{ note = "権限なし" }) $ViewerAuth
Write-Host "  - viewer で承認 -> $viewerApprove (403 期待)"
$assertions["viewerCannotApprove"] = ($viewerApprove -eq 403)

$approved = Invoke-Api "POST" "/api/rules/approvals/$($request.id)/approve" ([ordered]@{ note = "承認します" }) $ApproverAuth
$afterApprove = Wait-Trace $ChainId "validate,analyze,transform,report" $BaseUrl
Write-Host "  - 申請 #$($approved.id) = $($approved.status) (反映版 $($approved.appliedVersion))"
$assertions["approvalApplied"] = ($approved.status -eq "APPLIED")
$assertions["approvalChangedBehaviour"] = ((($afterApprove.trace) -join ",") -eq "validate,analyze,transform,report")

# 隣の Executor にも伝わっているか（承認による変更も Rule-DB 経由で同期される）
$peerSynced = $false
try {
    $peerRun = Wait-Trace $ChainId "validate,analyze,transform,report" $PeerUrl
    $peerSynced = $true
    Write-Host "  - 隣の Executor にも同期: $((($peerRun.trace) -join ','))"
} catch {
    Write-Warning "隣の Executor ($PeerUrl) を確認できませんでした: $($_.Exception.Message)"
}
$assertions["approvalSyncedToPeer"] = $peerSynced

$steps += [ordered]@{ step = "approval"; id = $approved.id; status = $approved.status
    appliedVersion = $approved.appliedVersion; requestedBy = $approved.requestedBy
    decidedBy = $approved.decidedBy; traceAfter = $afterApprove.trace; peerSynced = $peerSynced }

$rejected = Invoke-Api "POST" "/api/rules/approvals" ([ordered]@{
    targetType = "CHAIN"; targetId = $ChainId; body = "THEN(validate,forcedFailure,report)"; comment = "却下される申請"
}) $AdminAuth
$rejectedResult = Invoke-Api "POST" "/api/rules/approvals/$($rejected.id)/reject" ([ordered]@{ note = "危険なので却下" }) $ApproverAuth
$assertions["rejectionRecorded"] = ($rejectedResult.status -eq "REJECTED")
$steps += [ordered]@{ step = "rejection"; id = $rejectedResult.id; status = $rejectedResult.status }

# ---- 7b. 職務分離（申請者本人は承認できない） ------------------------------------
# ロールを分けるだけでは境界にならない。approver は ADMIN を持たないが、
# 「自分で申請して自分で承認」ができると ADMIN 無しで任意の本文を発行できてしまう。
Write-Host "[7b] 職務分離（自己承認の拒否）"
$selfRequest = Invoke-Api "POST" "/api/rules/approvals" ([ordered]@{
    targetType = "CHAIN"; targetId = $ChainId; body = "THEN(validate,report)"; comment = "自分で通そうとする"
}) $ApproverAuth
$selfApproveStatus = Get-Status "POST" "/api/rules/approvals/$($selfRequest.id)/approve" ([ordered]@{ note = "自己承認" }) $ApproverAuth
Write-Host "  - 申請者本人で承認 -> $selfApproveStatus (403 期待)"
$stillPending = Invoke-Api "GET" "/api/rules/approvals?status=PENDING" $null $AdminAuth
$selfStillPending = @($stillPending.approvals | Where-Object { $_.id -eq $selfRequest.id }).Count -eq 1
$assertions["selfApprovalRejected"] = ($selfApproveStatus -eq 403)
$assertions["selfApprovalLeavesRequestPending"] = $selfStillPending
$steps += [ordered]@{ step = "separation-of-duties"; id = $selfRequest.id
    selfApproveStatus = $selfApproveStatus; stillPending = $selfStillPending }

# ---- 7c. 管理画面のフォームログイン（ブラウザと同じ経路） --------------------------
# 42項目も他のスクリプトもすべて Basic 認証で叩いているため、
# フォームログインの経路はどの検査も通っていなかった。CSRF の除外は /api/** だけなので、
# トークンを載せない POST /admin/login は認証の前に 403 になる（＝画面から入れない）。
Write-Host "[7c] 管理画面のフォームログインとログアウト"

# Windows PowerShell 5.1 で動かす前提。-SkipHttpErrorCheck は 6+ にしか無く、
# -MaximumRedirection 0 は 3xx で例外になる。そのため
#   ・リダイレクトは追わせる（最終URIで着地点を判定する）
#   ・4xx は例外から状態コードを取り出す
# という書き方に統一してある。
# リダイレクトを追った先の最終URIを取り出す。
# **PowerShell の版で型が違う。** 5.1 は HttpWebResponse なので ResponseUri を持つが、
# 7 は HttpResponseMessage で ResponseUri が無く、RequestMessage.RequestUri を見る。
# 片方だけを見ると「動いているのに着地URIが空 ＝ FAIL」という偽の失敗になる。
# .cmd 経由は 5.1、pwsh から直接呼ぶと 7 なので、入口によって結果が変わっていた。
function Get-FinalUri($Response) {
    $base = $Response.BaseResponse
    if ($base.ResponseUri) { return "$($base.ResponseUri)" }
    return "$($base.RequestMessage.RequestUri)"
}

function Invoke-Browser([string]$Method, [string]$Url, $Body, $Headers, $Session) {
    try {
        $response = Invoke-WebRequest -Uri $Url -Method $Method -WebSession $Session `
            -Body $Body -Headers $Headers -UseBasicParsing -TimeoutSec 20
        return [ordered]@{ status = [int]$response.StatusCode; uri = (Get-FinalUri $response) }
    } catch {
        $webResponse = $_.Exception.Response
        $code = if ($webResponse) { [int]$webResponse.StatusCode } else { -1 }
        return [ordered]@{ status = $code; uri = "" }
    }
}

# CSRFトークンは cookie で渡ってくる。**認証に成功した時点で作り直される**
# （セッション固定攻撃への対策。Spring Security の CsrfAuthenticationStrategy）。
# そのため使う直前に読み直すこと。ログイン前のトークンでログアウトすると 403 になる。
# 画面側の JS はクリック時に cookie を読むので自然に新しい方を使う。
function Get-CsrfToken($Session) {
    $cookie = $Session.Cookies.GetCookies([Uri]$BaseUrl) | Where-Object { $_.Name -eq "XSRF-TOKEN" }
    if ($cookie) { return [Uri]::UnescapeDataString(@($cookie)[0].Value) }
    return $null
}

$loginPage = Invoke-WebRequest -Uri "$BaseUrl/admin/login.html" -SessionVariable Browser `
    -UseBasicParsing -TimeoutSec 20
$csrfToken = Get-CsrfToken $Browser
Write-Host "  - ログイン画面 $([int]$loginPage.StatusCode) / XSRF-TOKEN $(if ($csrfToken) { '取得' } else { '未取得' })"
$assertions["loginPageIssuesCsrfToken"] = ($null -ne $csrfToken -and $csrfToken.Length -gt 8)

# リダイレクトを追わせ、最終的な着地点で判定する。
$formLogin = Invoke-Browser "POST" "$BaseUrl/admin/login" `
    @{ username = $AdminUser; password = $AdminPassword; _csrf = $csrfToken } $null $Browser
Write-Host "  - フォームログイン -> $($formLogin.status) 着地 $($formLogin.uri)"
$assertions["formLoginSucceeds"] = ($formLogin.status -eq 200 -and $formLogin.uri -like "*/admin/index.html")

# セッションのまま管理APIが読めること。
$sessionRead = Invoke-Browser "GET" "$BaseUrl/api/rules" $null $null $Browser
$assertions["sessionCanReadRules"] = ($sessionRead.status -eq 200)

# ログアウトでセッションが実際に無効化されること（画面だけ戻って生きている状態にしない）。
# トークンはログインで作り直されているので読み直す。
$sessionToken = Get-CsrfToken $Browser
$logout = Invoke-Browser "POST" "$BaseUrl/admin/logout" $null @{ "X-XSRF-TOKEN" = $sessionToken } $Browser
$afterLogout = Invoke-Browser "GET" "$BaseUrl/api/rules" $null $null $Browser
Write-Host "  - ログアウト -> $($logout.status) / その後の参照 -> $($afterLogout.status) (401 期待)"
$assertions["logoutEndsSession"] = ($logout.status -lt 400 -and $afterLogout.status -eq 401)
$steps += [ordered]@{ step = "form-login"; loginStatus = $formLogin.status
    loginLanding = $formLogin.uri; sessionRead = $sessionRead.status
    logoutStatus = $logout.status; afterLogout = $afterLogout.status }

# ---- 8. 監査 -------------------------------------------------------------------
Write-Host "[8/8] 監査ログ"
$audit = Invoke-Api "GET" "/api/rules/audit?limit=200" $null $AdminAuth
$mine = @($audit.entries | Where-Object { $_.targetId -eq $ChainId })
$actions = @($mine | ForEach-Object { $_.action } | Sort-Object -Unique)
Write-Host "  - このチェーンに関する記録 $($mine.Count) 件: $($actions -join ', ')"
$assertions["auditRecorded"] = ($mine.Count -ge 6)
$assertions["auditHasRollbackAndApprove"] = (($actions -contains "ROLLBACK") -and ($actions -contains "APPROVE"))
$steps += [ordered]@{ step = "audit"; entries = $mine.Count; actions = $actions }

# ---- レポート ------------------------------------------------------------------
$failed = @()
foreach ($key in $assertions.Keys) { if (-not $assertions[$key]) { $failed += $key } }
$status = if ($failed.Count -eq 0) { "PASS" } else { "FAIL" }

$report = [ordered]@{
    status = $status
    ranAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    baseUrl = $BaseUrl
    peerUrl = $PeerUrl
    chainId = $ChainId
    failedAssertions = $failed
    assertions = $assertions
    steps = $steps
    scope = ("Proves that rule changes can be governed: authentication and role separation, " +
             "per-publish history (LiteFlow itself keeps none), diff between versions, rollback " +
             "(which republishes an old body FORWARD as a new version), an approval workflow that " +
             "does not touch LiteFlow until approved, and an audit trail. Does NOT prove production " +
             "readiness: users are in-memory with plaintext defaults, there is no MFA, no user " +
             "management, and no sandbox around published Groovy scripts.")
}
$report | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 $ReportPath

Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Root "reports\rule-admin-demo-failure.txt")
Write-Host ""
Write-Host "判定: $status"
if ($failed.Count -gt 0) { Write-Host "  失敗した断言: $($failed -join ', ')" }
Write-Host "証跡: $ReportPath"
if ($status -ne "PASS") { exit 1 }
