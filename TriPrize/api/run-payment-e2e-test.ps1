# 支付 E2E 测试运行脚本
$env:USE_MOCK_PAYMENT = "true"
$env:NODE_ENV = "test"
$env:DATABASE_URL = $env:DATABASE_URL ?? "postgresql://triprize:triprize_password@localhost:5432/triprize"
$env:REDIS_URL = $env:REDIS_URL ?? "redis://localhost:6379"

Write-Host "Running Payment E2E Comprehensive Tests..." -ForegroundColor Green
Write-Host "USE_MOCK_PAYMENT: $env:USE_MOCK_PAYMENT" -ForegroundColor Yellow
Write-Host "NODE_ENV: $env:NODE_ENV" -ForegroundColor Yellow

npx jest tests/integration/payment-e2e-comprehensive.test.ts --verbose --no-coverage --detectOpenHandles
