# テストファイルを名前順（降順）でソートして実行
$testFiles = @(
    "tests/unit/utils/position-calculator.test.ts",
    "tests/unit/utils/crypto.test.ts",
    "tests/unit/services/user.service.test.ts",
    "tests/unit/services/purchase.service.test.ts",
    "tests/unit/services/payment.service.test.ts",
    "tests/unit/services/notification.service.test.ts",
    "tests/unit/services/lottery.service.test.ts",
    "tests/unit/services/idempotency.service.test.ts",
    "tests/unit/services/campaign.service.test.ts",
    "tests/integration/purchase-flow.test.ts",
    "tests/integration/purchase-validation.test.ts",
    "tests/integration/payment-webhook.test.ts",
    "tests/integration/lottery-flow.test.ts",
    "tests/integration/campaigns.test.ts",
    "tests/integration/auth-flow.test.ts",
    "tests/contract/stripe-webhook.test.ts",
    "tests/contract/stripe-api.test.ts",
    "tests/unit/middleware/role.middleware.test.ts",
    "tests/unit/middleware/auth.middleware.test.ts",
    "tests/unit/controllers/user.controller.test.ts",
    "tests/unit/controllers/purchase.controller.test.ts",
    "tests/unit/controllers/payment.controller.test.ts",
    "tests/unit/controllers/lottery-flow-comprehensive.test.ts",
    "tests/unit/controllers/purchase-flow-comprehensive.test.ts",
    "tests/unit/controllers/auth-flow-comprehensive.test.ts",
    "tests/unit/controllers/admin-management-comprehensive.test.ts"
)

$failedTests = @()
$passedTests = @()

foreach ($file in $testFiles) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "Testing: $file" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    
    $output = npx jest $file --no-coverage 2>&1 | Out-String
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "PASSED: $file" -ForegroundColor Green
        $passedTests += $file
    } else {
        Write-Host "FAILED: $file" -ForegroundColor Red
        Write-Host $output -ForegroundColor Red
        $failedTests += $file
        Write-Host "`nStopping at first failure. Please fix the issue before continuing." -ForegroundColor Yellow
        break
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Passed: $($passedTests.Count)" -ForegroundColor Green
Write-Host "Failed: $($failedTests.Count)" -ForegroundColor Red

if ($failedTests.Count -gt 0) {
    Write-Host "`nFailed Tests:" -ForegroundColor Red
    foreach ($test in $failedTests) {
        Write-Host "  - $test" -ForegroundColor Red
    }
}
