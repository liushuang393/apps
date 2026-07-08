#!/usr/bin/env bash
# 社内LANのWindowsホストIPを .env の HOST_IP に反映し、frontend/backend を再起動する。
# WSL2 + Docker Desktop 前提（host.docker.internal = Windows の LAN IP）。
# DHCPでIPが変わって動かなくなったら、このスクリプトを1回実行するだけで復旧する。
#
# 使い方:
#   ./scripts/set-host-ip.sh            # 自動検出して反映
#   ./scripts/set-host-ip.sh 192.168.x.y # IPを明示指定して反映
set -euo pipefail
cd "$(dirname "$0")/.."

IP="${1:-$(getent hosts host.docker.internal 2>/dev/null | awk '{print $1}')}"
if [ -z "${IP:-}" ]; then
  echo "エラー: ホストIPを検出できません。引数でIPを渡してください: ./scripts/set-host-ip.sh 192.168.x.y" >&2
  exit 1
fi

# .env の HOST_IP 行を置換（行が無ければ追記）
if grep -qE '^HOST_IP=' .env; then
  sed -i -E "s|^HOST_IP=.*|HOST_IP=${IP}|" .env
else
  printf '\nHOST_IP=%s\n' "${IP}" >> .env
fi

echo "HOST_IP=${IP} に更新しました。"
echo "------------------------------------------------------------"
echo "他マシンからのアクセスURL:  http://${IP}:5273"
echo "※ 他マシンの Chrome/Edge では chrome://flags の"
echo "   'Insecure origins treated as secure' に http://${IP}:5273 を登録してください。"
echo "   （マイク許可に必要。このWindows機で話す場合は http://localhost:5273 でOK）"
echo "------------------------------------------------------------"

# シェルに無効な OPENAI_API_KEY/OPENAI_BASE_URL が export されていると compose の
# ${OPENAI_API_KEY} がそれを拾い、.env の有効キーを上書きしてしまう。ここで除去し .env を使わせる。
unset OPENAI_API_KEY OPENAI_BASE_URL

# livekit も再生成する（--node-ip ${HOST_IP} がメディア候補に使われるため、IP変更時は必須）。
docker compose up -d --force-recreate frontend backend livekit
echo "再起動完了。会議室には入り直してください（Agent はトークン発行＝入室時に起動します）。"
