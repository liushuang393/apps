# 逐个运行测试文件并显示结果
$testFiles = @(
    'tests/unit/utils/crypto.test.ts',
    'tests/unit/utils/position-calculator.test.ts',
    'tests/unit/middleware/auth.middleware.test.ts',
    'tests/unit/middleware/role.middleware.test.ts',
    'tests/unit/services/user.service.test.ts',
    'tests/unit/services/campaign.service.test.ts',
    'tests/unit/services/lottery.service.test.ts',
    'tests/unit/services/purchase.service.test.ts',
    'tests/unit/services/payment.service.test.ts',
    'tests/unit/services/notification.service.test.ts',
    'tests/unit/services/idempotency.service.test.ts',
    'tests/unit/controllers/user.controller.test.ts',
    'tests/unit/controllers/purchase.controller.test.ts',
    'tests/unit/controllers/payment.controller.test.ts',
    'tests/unit/controllers/auth-flow-comprehensive.test.ts',
    'tests/unit/controllers/purchase-flow-comprehensive.test.ts',
    'tests/unit/controllers/lottery-flow-comprehensive.test.ts',
    'tests/unit/controllers/admin-management-comprehensive.test.ts',
    'tests/integration/auth-flow.test.ts',
    'tests/integration/campaigns.test.ts',
    'tests/integration/lottery-flow.test.ts',
    'tests/integration/payment-webhook.test.ts',
    'tests/integration/purchase-validation.test.ts',
    'tests/integration/purchase-flow.test.ts',
    'tests/contract/stripe-api.test.ts',
    'tests/contract/stripe-webhook.test.ts'
)

$results = @()
$failedTests = @()

Write-Host "`n=== 开始逐个运行测试 ===`n" -ForegroundColor Green

foreach ($file in $testFiles) {
    Write-Host "`n测试文件: $file" -ForegroundColor Cyan
    Write-Host "----------------------------------------" -ForegroundColor Gray
    
    $output = npx jest $file --no-coverage --no-watchman 2>&1 | Out-String
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 通过" -ForegroundColor Green
        $results += [PSCustomObject]@{
            File = $file
            Status = "PASS"
        }
    } else {
        Write-Host "✗ 失败" -ForegroundColor Red
        Write-Host $output
        $results += [PSCustomObject]@{
            File = $file
            Status = "FAIL"
            Output = $output
        }
        $failedTests += $file
    }
}

Write-Host "`n=== 测试结果汇总 ===`n" -ForegroundColor Green
Write-Host "总计: $($results.Count) 个测试文件" -ForegroundColor White
Write-Host "通过: $($results | Where-Object { $_.Status -eq 'PASS' } | Measure-Object | Select-Object -ExpandProperty Count) 个" -ForegroundColor Green
Write-Host "失败: $($failedTests.Count) 个" -ForegroundColor Red

if ($failedTests.Count -gt 0) {
    Write-Host "`n失败的测试文件:" -ForegroundColor Red
    foreach ($file in $failedTests) {
        Write-Host "  - $file" -ForegroundColor Yellow
    }
}

# 保存结果到文件
$results | ConvertTo-Json -Depth 3 | Out-File -FilePath "test-results-individual.json" -Encoding utf8
Write-Host "`n结果已保存到: test-results-individual.json" -ForegroundColor Cyan
