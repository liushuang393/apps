# install.ps1 / validate.ps1 が共用する事前確認ヘルパ。
# ドットソースで読み込むこと。関数を定義するだけで副作用は無い。

function Assert-DockerReady {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker CLI が見つかりません。Docker Desktop をインストールしてください。"
    }

    docker compose version 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose v2 が利用できません。Docker Desktop を最新版へ更新してください。"
    }

    # `docker --version` と `docker compose version` は daemon が停止していても成功する。
    # エンジンを実際に必要とする最初のコマンドが `docker info` なので、ここで明示的に確認する。
    # そうしないと後続の `docker compose pull` が npipe/socket の生メッセージで失敗するだけになる。
    $info = docker info --format '{{.ServerVersion}}' 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ("Docker daemon に接続できません。Docker Desktop を起動し、" +
               "鯨アイコンが緑になってから再実行してください。`n  detail: " + ($info | Out-String).Trim())
    }
    Write-Host "  - Docker daemon READY (server $($info | Select-Object -First 1))"

    docker compose config 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "docker-compose.yml が不正です。"
    }
}

function Assert-PortsFree {
    param([int[]]$Ports = @(3307, 8081, 8082, 9090, 3000))

    # 本プロジェクト自身のコンテナが使っているポートは問題ない。他プロセスのリッスンだけが問題で、
    # 検出しないと3分間ヘルスチェックが空回りしてから失敗することになる。
    #
    # 保持プロセス名では判定できない。Docker Desktop のバックエンドによって
    # com.docker.backend だったり wslrelay（WSL2バックエンド）だったりするためである。
    # 代わりに compose 自身へ「このプロジェクトが公開しているホストポート」を問い合わせる。
    $ourPorts = @()
    $psJson = docker compose ps --format json 2>&1
    if ($LASTEXITCODE -eq 0) {
        foreach ($line in @($psJson)) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try { $entry = $line | ConvertFrom-Json } catch { continue }
            foreach ($pub in @($entry.Publishers)) {
                if ($pub.PublishedPort -gt 0) { $ourPorts += [int]$pub.PublishedPort }
            }
        }
    }
    $ourPorts = @($ourPorts | Select-Object -Unique)

    $conflicts = @()
    foreach ($port in $Ports) {
        if ($ourPorts -contains $port) {
            Write-Host "  - port $port は本プロジェクトのコンテナが使用中のため続行します"
            continue
        }

        $listener = $null
        try {
            $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1
        } catch {
            continue  # ポート空き、またはこのホストで Get-NetTCPConnection が使えない
        }
        if (-not $listener) { continue }

        $name = "unknown"
        try {
            $proc = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
            $name = $proc.ProcessName
        } catch { }

        $conflicts += "  port $port -> $name (PID $($listener.OwningProcess))"
    }

    if ($conflicts.Count -gt 0) {
        throw ("必要なポートが他プロセスに使用されています。停止してから再実行してください。`n" +
               ($conflicts -join "`n"))
    }
    $free = @($Ports | Where-Object { $ourPorts -notcontains $_ })
    if ($free.Count -gt 0) { Write-Host "  - ports $($free -join ', ') FREE" }
}

function Test-DockerImageExists {
    param([Parameter(Mandatory = $true)][string]$Image)
    docker image inspect $Image 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}
