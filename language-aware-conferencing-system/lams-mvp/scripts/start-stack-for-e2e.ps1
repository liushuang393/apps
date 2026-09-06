# LAMS スタック起動（Windows PowerShell・Cursor 外推奨）
# 使い方: このファイルを PowerShell で実行
#   powershell -ExecutionPolicy Bypass -File scripts\start-stack-for-e2e.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "[LAMS] docker compose up -d --build"
docker compose up -d --build

Write-Host "[LAMS] alembic upgrade head"
docker compose exec backend alembic upgrade head

Write-Host "[LAMS] waiting for /health"
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8090/health" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
  Start-Sleep -Seconds 2
}
if (-not $ok) {
  Write-Error "API health timeout. Check: docker compose ps"
  exit 2
}

Write-Host "[LAMS] stack ready"
Write-Host "  API:      http://127.0.0.1:8090/health"
Write-Host "  Frontend: http://127.0.0.1:5273/"
Write-Host "Next (WSL or PowerShell):"
Write-Host "  export LAMS_E2E_MOCK_AI=1"
Write-Host "  ./scripts/e2e_run_a_lane.sh"
