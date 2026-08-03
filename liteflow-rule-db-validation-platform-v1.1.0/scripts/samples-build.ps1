param(
    [int]$Port = 8099,
    [switch]$SkipRun
)
$ErrorActionPreference = "Stop"
trap {
    $RootForTrap = Split-Path -Parent $PSScriptRoot
    $ReportsForTrap = Join-Path $RootForTrap "reports"
    New-Item -ItemType Directory -Force -Path $ReportsForTrap | Out-Null
    $FailurePath = Join-Path $ReportsForTrap "samples-build-failure.txt"
    $Lines = @(
        "status=FAIL",
        "failedAt=$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))",
        "message=$($_.Exception.Message)",
        "log=reports\samples-build.log"
    )
    Set-Content -Encoding UTF8 -Path $FailurePath -Value $Lines
    [Console]::Error.WriteLine("Operation failed. See $FailurePath")
    exit 1
}
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
New-Item -ItemType Directory -Force -Path "reports" | Out-Null

# Struts→Spring Boot ファミリの「変換元」と「変換先」を、実際にビルドできる本物の
# プロジェクトとして組み立てて確かめる。
#
#   1. ケースの input/ を Struts 1.3.10 プロジェクトへ配置して mvn package
#   2. ケースの output/（期待する正解）を Spring Boot 4.1 プロジェクトへ配置して mvn package
#   3. Spring Boot 側を実際に起動し、ログイン画面と検索一覧画面が HTTP 200 を返すことを確認
#
# ケースの input/ output/ が唯一の真実であり、apps/ 配下には骨組みだけを置いてある。
# コピーを2重管理しないための構成。
#
# 重要: ここで起動して見せる画面は「人手で書いた目標プロジェクト」である。
# 生成物そのものを起動しているのではない。生成物について言えるのは
# 「ゴールデンと一致した」「実際にコンパイルできた」までである。

$FamilyDir = Join-Path $Root "corpus\families\struts-springboot"
$CaseRoot = Join-Path $FamilyDir "cases"
$LegacyApp = Join-Path $FamilyDir "apps\legacy-struts1"
$TargetApp = Join-Path $FamilyDir "apps\target-springboot41"
$LogFile = Join-Path $Root "reports\samples-build.log"
$ReportPath = Join-Path $Root "reports\samples-build.json"
Set-Content -Path $LogFile -Value ""

function Invoke-Logged([string]$Label, [scriptblock]$Command) {
    $global:LASTEXITCODE = 0
    Write-Host "  - $Label"
    & $Command 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "$Label に失敗しました（exit=$LASTEXITCODE）。reports\samples-build.log を確認してください。" }
}

if (-not (Get-Command mvn -ErrorAction SilentlyContinue)) {
    throw "Maven が見つかりません。ホストに Maven 3.9 以上をインストールしてください。"
}

$caseDirs = @(Get-ChildItem -Path $CaseRoot -Directory | Sort-Object Name)
if ($caseDirs.Count -eq 0) { throw "ケースがありません: $CaseRoot" }

# ---- 1. 変換元（Struts 1.3.10）を組み立てる --------------------------------
Write-Host "[1/4] 変換元 Struts 1.3.10 プロジェクトの組み立て"
$LegacyJava = Join-Path $LegacyApp "src\main\java\jp\co\softroad\legacy"
$LegacyWeb = Join-Path $LegacyApp "src\main\webapp"
foreach ($sub in @("action", "form")) {
    $path = Join-Path $LegacyJava $sub
    if (Test-Path $path) { Remove-Item $path -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $path | Out-Null
}
New-Item -ItemType Directory -Force -Path $LegacyWeb | Out-Null
Get-ChildItem $LegacyWeb -Filter *.jsp -ErrorAction SilentlyContinue | Remove-Item -Force

$formBeans = @()
$actions = @()
foreach ($dir in $caseDirs) {
    $inputDir = Join-Path $dir.FullName "input"
    foreach ($file in (Get-ChildItem $inputDir -File | Sort-Object Name)) {
        switch -Wildcard ($file.Name) {
            "*Action.java" { Copy-Item $file.FullName (Join-Path $LegacyJava "action") -Force }
            "*Form.java"   { Copy-Item $file.FullName (Join-Path $LegacyJava "form") -Force }
            "*.jsp"        { Copy-Item $file.FullName $LegacyWeb -Force }
            "struts-config.xml" {
                # ケースごとの struts-config を1本へまとめる。
                $text = Get-Content $file.FullName -Raw -Encoding UTF8
                foreach ($m in [regex]::Matches($text, '(?s)<form-bean\b.*?/>')) { $formBeans += $m.Value }
                foreach ($m in [regex]::Matches($text, '(?s)<action\b.*?</action>')) { $actions += $m.Value }
            }
            default { }
        }
    }
}
$mergedConfig = @('<?xml version="1.0" encoding="UTF-8"?>', '<struts-config>', '  <form-beans>')
foreach ($fb in $formBeans) { $mergedConfig += "    $fb" }
$mergedConfig += @('  </form-beans>', '  <action-mappings>')
foreach ($ac in $actions) { $mergedConfig += ($ac -split "`n" | ForEach-Object { "    " + $_.TrimEnd() }) }
$mergedConfig += @('  </action-mappings>', '</struts-config>')
$mergedConfig -join "`n" | Set-Content -Encoding UTF8 (Join-Path $LegacyApp "src\main\webapp\WEB-INF\struts-config.xml")
Write-Host "    action=$($actions.Count) form-bean=$($formBeans.Count)"

Invoke-Logged "Struts プロジェクトのビルド" { mvn -B -ntp -f (Join-Path $LegacyApp "pom.xml") clean package }
$LegacyWar = Join-Path $LegacyApp "target\legacy-struts1-app.war"
if (-not (Test-Path $LegacyWar)) { throw "war が生成されませんでした: $LegacyWar" }

# ---- 2. 変換先（Spring Boot 4.1）を組み立てる ------------------------------
Write-Host "[2/4] 変換先 Spring Boot 4.1 プロジェクトの組み立て"
$TargetJava = Join-Path $TargetApp "src\main\java\generated"
$TargetViews = Join-Path $TargetApp "src\main\resources\templates"
New-Item -ItemType Directory -Force -Path $TargetJava, $TargetViews | Out-Null
Get-ChildItem $TargetJava -Filter *.java | Where-Object { $_.Name -ne "TargetApplication.java" } | Remove-Item -Force
Get-ChildItem $TargetViews -Filter *.html -ErrorAction SilentlyContinue | Remove-Item -Force

$views = @()
foreach ($dir in $caseDirs) {
    $outputDir = Join-Path $dir.FullName "output"
    if (-not (Test-Path $outputDir)) { continue }
    foreach ($file in (Get-ChildItem $outputDir -File | Sort-Object Name)) {
        if ($file.Name -like "*.java") { Copy-Item $file.FullName $TargetJava -Force }
        if ($file.Name -like "*.html") {
            # Thymeleaf のビュー名は小文字。コントローラが return する名前に合わせる。
            $viewName = $file.BaseName.ToLowerInvariant()
            Copy-Item $file.FullName (Join-Path $TargetViews "$viewName.html") -Force
            $views += $viewName
        }
    }
}
Write-Host "    java=$((Get-ChildItem $TargetJava -Filter *.java).Count) view=$($views.Count)"

Invoke-Logged "Spring Boot プロジェクトのビルド" { mvn -B -ntp -f (Join-Path $TargetApp "pom.xml") clean package }
$TargetJar = Join-Path $TargetApp "target\target-springboot41-app.jar"
if (-not (Test-Path $TargetJar)) { throw "jar が生成されませんでした: $TargetJar" }

# ---- 3. 依存jarを集める（生成コードの javac 用クラスパス） -----------------
Write-Host "[3/4] Spring Boot 4.1 依存jarの収集（生成コードのコンパイル用）"
Invoke-Logged "dependency:copy-dependencies" {
    mvn -B -ntp -f (Join-Path $TargetApp "pom.xml") dependency:copy-dependencies "-DoutputDirectory=lib" "-DincludeScope=compile"
}
$LibDir = Join-Path $TargetApp "lib"
$jarCount = @(Get-ChildItem $LibDir -Filter *.jar).Count
Write-Host "    jar=$jarCount → TRANSFORM_EXTRA_CLASSPATH に指定する"

# ---- 4. 変換先を実際に起動して画面を確認 -----------------------------------
$screens = @()
if ($SkipRun) {
    Write-Host "[4/4] 起動確認はスキップ（-SkipRun）"
} else {
    Write-Host "[4/4] Spring Boot 目標プロジェクトの起動確認 (port $Port)"
    $listener = $null
    try { $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1 } catch { }
    if ($listener) { throw "port $Port は PID $($listener.OwningProcess) が使用中です。" }

    $env:SERVER_PORT = "$Port"
    $proc = Start-Process -FilePath "java" -ArgumentList @("-jar", $TargetJar) `
        -RedirectStandardOutput (Join-Path $Root "reports\samples-app.log") `
        -RedirectStandardError (Join-Path $Root "reports\samples-app.err.log") `
        -PassThru -WindowStyle Hidden
    try {
        $ready = $false
        for ($i = 1; $i -le 60; $i++) {
            if ($proc.HasExited) { throw "目標アプリが異常終了しました（exit=$($proc.ExitCode)）。reports\samples-app.err.log を確認してください。" }
            try {
                Invoke-WebRequest -Uri "http://localhost:$Port/login" -UseBasicParsing -TimeoutSec 3 | Out-Null
                $ready = $true; break
            } catch { Start-Sleep -Seconds 2 }
        }
        if (-not $ready) { throw "目標アプリが起動しませんでした。reports\samples-app.err.log を確認してください。" }

        foreach ($path in @("/login", "/search")) {
            $res = Invoke-WebRequest -Uri "http://localhost:$Port$path" -UseBasicParsing -TimeoutSec 10
            $screens += [ordered]@{
                path = $path
                status = [int]$res.StatusCode
                bytes = $res.Content.Length
                containsForm = $res.Content.Contains("<form")
            }
            Write-Host ("    {0} -> HTTP {1} ({2} bytes)" -f $path, [int]$res.StatusCode, $res.Content.Length)
        }
    } finally {
        if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    }
}

$failedScreens = @($screens | Where-Object { $_.status -ne 200 })
$status = if ($failedScreens.Count -eq 0) { "PASS" } else { "FAIL" }
$report = [ordered]@{
    status = $status
    ranAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    legacy = [ordered]@{
        framework = "Struts 1.3.10"
        project = "corpus/families/struts-springboot/apps/legacy-struts1"
        artifact = "target/legacy-struts1-app.war"
        built = (Test-Path $LegacyWar)
        actions = $actions.Count
        formBeans = $formBeans.Count
    }
    target = [ordered]@{
        framework = "Spring Boot 4.1.0"
        project = "corpus/families/struts-springboot/apps/target-springboot41"
        artifact = "target/target-springboot41-app.jar"
        built = (Test-Path $TargetJar)
        views = $views
        dependencyJars = $jarCount
        classpathDir = $LibDir
    }
    screens = $screens
    scope = ("Proves that both the Struts 1.3.10 source project and the Spring Boot 4.1 target project " +
             "are real, buildable projects, and that the target application actually serves the login " +
             "and search screens. The screens served here come from the HAND-WRITTEN target project, " +
             "NOT from generated code. What the generator achieved is recorded separately in " +
             "reports/corpus-report.md: golden-diff match plus real javac against the Boot 4.1 classpath.")
}
$report | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $ReportPath

Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Root "reports\samples-build-failure.txt")
Write-Host ""
Write-Host "判定: $status"
Write-Host "証跡: $ReportPath"
if ($status -ne "PASS") { exit 1 }
