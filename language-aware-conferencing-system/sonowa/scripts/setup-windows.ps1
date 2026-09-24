# Sonowa の Windows 初回設定（管理者 PowerShell で実行。1台につき1回）
#   ホスト（Docker を動かす PC）: .\setup-windows.ps1 -CaPath <ca.crt のパス>
#   参加端末（ブラウザで会議に入るだけの PC）: .\setup-windows.ps1 -CaPath <ca.crt のパス> -ClientOnly
# 内容:
#   1. 社内ローカル CA（ca.crt）を「信頼されたルート証明機関」（コンピューター全体）へ登録する
#   2. ホストのみ: HTTPS と WebRTC のポートを Windows Firewall で受信許可する
#      （ネットワークが「パブリック」でも効くよう全プロファイル。ただし同一サブネットからのみ）
# 注意: ca.key（秘密鍵）は配らない。ca.crt だけを使う。
param(
    [Parameter(Mandatory = $true)][string]$CaPath,
    [switch]$ClientOnly,
    [string]$LogPath = ""
)
$ErrorActionPreference = "Stop"
if ($LogPath) { Start-Transcript -Path $LogPath -Force | Out-Null }
try {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) { throw "管理者として実行してください（PowerShell を右クリック →「管理者として実行」）" }

    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (Resolve-Path $CaPath).Path
    if ($cert.Subject -notlike "*Sonowa Local CA*") { throw "Sonowa の ca.crt ではありません: $($cert.Subject)" }
    $existing = Get-ChildItem Cert:\LocalMachine\Root | Where-Object Thumbprint -eq $cert.Thumbprint
    if ($existing) {
        Write-Output "[CA] 登録済み: $($cert.Subject) ($($cert.Thumbprint))"
    } else {
        Import-Certificate -FilePath (Resolve-Path $CaPath).Path -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
        Write-Output "[CA] 登録しました: $($cert.Subject) ($($cert.Thumbprint))"
    }

    if (-not $ClientOnly) {
        $rules = @(
            @{ Name = "Sonowa HTTPS";        Protocol = "TCP"; Port = "443" },
            @{ Name = "Sonowa HTTP redirect"; Protocol = "TCP"; Port = "80" },
            @{ Name = "Sonowa LiveKit TCP";  Protocol = "TCP"; Port = "7881" },
            @{ Name = "Sonowa TURN TCP";     Protocol = "TCP"; Port = "3478" },
            @{ Name = "Sonowa TURN UDP";     Protocol = "UDP"; Port = "3478" },
            @{ Name = "Sonowa media UDP";    Protocol = "UDP"; Port = "50000-50039" }
        )
        foreach ($r in $rules) {
            if (Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue) {
                Write-Output "[FW] 既存: $($r.Name)"
                continue
            }
            New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Action Allow `
                -Protocol $r.Protocol -LocalPort $r.Port -Profile Any -RemoteAddress LocalSubnet | Out-Null
            Write-Output "[FW] 追加: $($r.Name) $($r.Protocol) $($r.Port)"
        }
    }
    Write-Output "[OK] 完了。ブラウザを再起動してください。"
} finally {
    if ($LogPath) { Stop-Transcript | Out-Null }
}
