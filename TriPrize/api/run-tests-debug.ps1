$ErrorActionPreference = "Continue"
$output = & npx jest --testPathPattern=tests/unit --no-coverage 2>&1
$output | Out-File -FilePath "test-results.txt" -Encoding utf8
Get-Content "test-results.txt" | Select-Object -Last 300
