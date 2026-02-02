# New App Setup Script
# 目的: 新規アプリ作成のためのセットアップスクリプト
# 使用方法: .\scripts\new-app-setup.ps1 -AppName "MyNewApp" -PackageName "com.example.mynewapp"

param(
    [Parameter(Mandatory=$true)]
    [string]$AppName,
    
    [Parameter(Mandatory=$true)]
    [string]$PackageName,
    
    [string]$AppDescription = "A new app built on the framework",
    
    [switch]$KeepTriPrizeBusiness = $false
)

$ErrorActionPreference = "Stop"

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "  New App Setup: $AppName" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan

# 1. 環境変数ファイルの更新
Write-Host "`n[1/5] Updating environment files..." -ForegroundColor Yellow

# API example.env
$apiEnvPath = "api/example.env"
if (Test-Path $apiEnvPath) {
    $content = Get-Content $apiEnvPath -Raw
    $content = $content -replace "APP_NAME=TriPrize", "APP_NAME=$AppName"
    $content = $content -replace "APP_DISPLAY_NAME=TriPrize", "APP_DISPLAY_NAME=$AppName"
    $content = $content -replace "APP_DESCRIPTION=.*", "APP_DESCRIPTION=$AppDescription"
    Set-Content $apiEnvPath $content
    Write-Host "  Updated: $apiEnvPath" -ForegroundColor Green
}

# Mobile example.env
$mobileEnvPath = "mobile/example.env"
if (Test-Path $mobileEnvPath) {
    $content = Get-Content $mobileEnvPath -Raw
    $content = $content -replace "APP_NAME=TriPrize", "APP_NAME=$AppName"
    $content = $content -replace "APP_DISPLAY_NAME=TriPrize", "APP_DISPLAY_NAME=$AppName"
    $content = $content -replace "APP_DESCRIPTION=.*", "APP_DESCRIPTION=$AppDescription"
    Set-Content $mobileEnvPath $content
    Write-Host "  Updated: $mobileEnvPath" -ForegroundColor Green
}

# Docker example.env
$dockerEnvPath = "docker.example.env"
if (Test-Path $dockerEnvPath) {
    $content = Get-Content $dockerEnvPath -Raw
    $content = $content -replace "APP_NAME=triprize", "APP_NAME=$($AppName.ToLower())"
    $content = $content -replace "APP_DISPLAY_NAME=TriPrize", "APP_DISPLAY_NAME=$AppName"
    $content = $content -replace "APP_DESCRIPTION=.*", "APP_DESCRIPTION=$AppDescription"
    Set-Content $dockerEnvPath $content
    Write-Host "  Updated: $dockerEnvPath" -ForegroundColor Green
}

# 2. Flutter pubspec.yaml 更新
Write-Host "`n[2/5] Updating Flutter configuration..." -ForegroundColor Yellow
$pubspecPath = "mobile/pubspec.yaml"
if (Test-Path $pubspecPath) {
    $content = Get-Content $pubspecPath -Raw
    $content = $content -replace "name: triprize_mobile", "name: $($AppName.ToLower())_mobile"
    $content = $content -replace "description: Triangle Lottery.*", "description: $AppDescription"
    Set-Content $pubspecPath $content
    Write-Host "  Updated: $pubspecPath" -ForegroundColor Green
}

# 3. Android build.gradle.kts 更新
Write-Host "`n[3/5] Updating Android configuration..." -ForegroundColor Yellow
$gradlePath = "mobile/android/app/build.gradle.kts"
if (Test-Path $gradlePath) {
    $content = Get-Content $gradlePath -Raw
    $content = $content -replace 'namespace = "com\.triprizeshuang\.triprizeMobile"', "namespace = `"$PackageName`""
    $content = $content -replace 'applicationId = "com\.triprizeshuang\.triprizeMobile"', "applicationId = `"$PackageName`""
    Set-Content $gradlePath $content
    Write-Host "  Updated: $gradlePath" -ForegroundColor Green
}

# 4. API package.json 更新
Write-Host "`n[4/5] Updating API configuration..." -ForegroundColor Yellow
$packageJsonPath = "api/package.json"
if (Test-Path $packageJsonPath) {
    $content = Get-Content $packageJsonPath -Raw
    $content = $content -replace '"name": "triprize-api"', "`"name`": `"$($AppName.ToLower())-api`""
    $content = $content -replace '"description": "Triangle Lottery.*"', "`"description`": `"$AppDescription API`""
    Set-Content $packageJsonPath $content
    Write-Host "  Updated: $packageJsonPath" -ForegroundColor Green
}

# 5. TriPrize 業務モジュールの削除（オプション）
if (-not $KeepTriPrizeBusiness) {
    Write-Host "`n[5/5] Removing TriPrize business modules..." -ForegroundColor Yellow
    
    # Mobile features
    $mobileFeaturesPath = "mobile/lib/features"
    @("campaign", "lottery", "purchase") | ForEach-Object {
        $featurePath = Join-Path $mobileFeaturesPath $_
        if (Test-Path $featurePath) {
            Remove-Item $featurePath -Recurse -Force
            Write-Host "  Removed: $featurePath" -ForegroundColor Green
        }
    }
    
    Write-Host "`n  [NOTE] API business modules are not auto-deleted." -ForegroundColor Yellow
    Write-Host "  Please manually remove/modify the following:" -ForegroundColor Yellow
    Write-Host "  - api/src/controllers/campaign.controller.ts" -ForegroundColor Gray
    Write-Host "  - api/src/controllers/lottery.controller.ts" -ForegroundColor Gray
    Write-Host "  - api/src/controllers/purchase.controller.ts" -ForegroundColor Gray
    Write-Host "  - api/src/services/campaign.service.ts" -ForegroundColor Gray
    Write-Host "  - api/src/services/lottery.service.ts" -ForegroundColor Gray
    Write-Host "  - api/src/services/purchase.service.ts" -ForegroundColor Gray
    Write-Host "  - api/src/routes/campaign.routes.ts" -ForegroundColor Gray
    Write-Host "  - api/src/routes/lottery.routes.ts" -ForegroundColor Gray
    Write-Host "  - api/src/routes/purchase.routes.ts" -ForegroundColor Gray
    Write-Host "  - api/src/models/campaign.entity.ts" -ForegroundColor Gray
    Write-Host "  - api/src/models/lottery.entity.ts" -ForegroundColor Gray
    Write-Host "  - api/src/models/purchase.entity.ts" -ForegroundColor Gray
    Write-Host "  - Update api/src/app.ts route imports" -ForegroundColor Gray
} else {
    Write-Host "`n[5/5] Keeping TriPrize business modules (as requested)" -ForegroundColor Yellow
}

Write-Host "`n==================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. Copy example.env files to .env and configure" -ForegroundColor White
Write-Host "2. Run: cd mobile && flutter pub get" -ForegroundColor White
Write-Host "3. Run: cd api && npm install" -ForegroundColor White
Write-Host "4. Configure Firebase: cd mobile && flutterfire configure" -ForegroundColor White
Write-Host "5. Update mobile/lib/core/di/injection.dart" -ForegroundColor White
Write-Host "6. Start developing your new app!" -ForegroundColor White

