$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
$Python = Get-Command python -ErrorAction SilentlyContinue
if ($Python) {
    & python (Join-Path $Root "tools\preflight.py")
    exit $LASTEXITCODE
}
$Py = Get-Command py -ErrorAction SilentlyContinue
if ($Py) {
    & py -3 (Join-Path $Root "tools\preflight.py")
    exit $LASTEXITCODE
}
throw "Python 3 が見つかりません。事前確認は省略できます（install.cmd はDockerビルドとJUnitを実行します）。"
