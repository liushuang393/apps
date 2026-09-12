# 本地 Docker を LAN 公開で起動する

## Goal

既存の `docker-compose.yml` を `HOST_IP=192.168.0.103` 付きで起動し、LAN 上の端末からフロントと API に届く状態にする。アプリケーションコードと `.env` は変更しない。

## Requirements

- postgres / redis / livekit / coturn / backend / frontend を Docker 上で起動する
- 起動時に `HOST_IP=192.168.0.103` を渡す（ファイルとしての `.env` は編集しない）
- 起動後に `alembic upgrade head` を backend コンテナで実行する
- WSL から Docker に届かない場合は PowerShell の `docker compose` に切り替える
- AI モード切替は管理者 UI に任せ、env を書き換えない

## Constraints

- compose / Dockerfile / 起動スクリプトを再調査・改修しない
- `.env` の内容をダンプしない
- アプリコード変更・コミットはしない

## Acceptance Criteria

- [x] `docker compose ps` で主要サービスが起動している
- [x] `http://localhost:8090/health` が成功する
- [x] localhost と LAN（`192.168.0.103`）のアクセス URL を案内する

## Notes

Lightweight / PRD-only。技術設計の変更はない。
