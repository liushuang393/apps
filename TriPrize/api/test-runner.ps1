param(
    [Parameter(Mandatory=$true)]
    [string]$TestFile
)

Write-Host "Running test: $TestFile" -ForegroundColor Cyan
Write-Host ""

$output = & npx jest $TestFile --no-coverage --verbose 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Test PASSED" -ForegroundColor Green
} else {
    Write-Host "`n❌ Test FAILED" -ForegroundColor Red
}

Write-Host "`nOutput:" -ForegroundColor Yellow
$output

exit $LASTEXITCODE
