# AI パイプライン設定の実機 E2E スモーク（Windows / PowerShell）
# 使い方: powershell -File scripts/smoke_ai_pipeline_settings.ps1
# 前提: docker compose で backend / postgres が起動済み

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $env:LAMS_API_BASE) { $env:LAMS_API_BASE = "http://localhost:8090" }
if (-not $env:LAMS_FRONTEND) { $env:LAMS_FRONTEND = "http://localhost:5273" }

Write-Host "[SMOKE-PIPELINE] running scripts/smoke_ai_pipeline_settings.py"
python scripts/smoke_ai_pipeline_settings.py
exit $LASTEXITCODE
