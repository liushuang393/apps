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

foreach ($file in $testFiles) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "Testing: $file" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    npx jest $file --no-coverage
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`nFAILED: $file" -ForegroundColor Red
        break
    } else {
        Write-Host "`nPASSED: $file" -ForegroundColor Green
    }
}
