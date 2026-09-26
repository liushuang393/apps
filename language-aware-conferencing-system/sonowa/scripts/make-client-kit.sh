#!/usr/bin/env bash
# 参加端末（Windows）に配る設定キットを output/sonowa-client-kit.zip に作る。
# 中身: install-client.bat（ダブルクリックで実行）・setup-windows.ps1・ca.crt・はじめにお読みください.txt
# ca.key（秘密鍵）は入れない。
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "${ROOT}/certs/ca.crt" ]] || { echo "certs/ca.crt がありません。先に本番構成で起動してください" >&2; exit 1; }
HOST_IP="$(sed -n 's/^HOST_IP=//p' "${ROOT}/.env" | tail -1)"
OUT="${ROOT}/output"
mkdir -p "$OUT"
python3 - "$ROOT" "$OUT/sonowa-client-kit.zip" "${HOST_IP:-<ホストのIP>}" <<'PY'
import sys, zipfile
root, dest, ip = sys.argv[1:]
readme = f"""Sonowa 会議システム 参加端末の設定（Windows・1台につき1回）

1. この zip を展開する（右クリック →「すべて展開」）
2. 展開したフォルダの install-client.bat をダブルクリックする
3. 「このアプリがデバイスに変更を加えることを許可しますか？」→「はい」
4. 「[OK] 完了」と表示されたら、その青い画面を閉じる
5. Chrome または Edge を一度すべて閉じて開き直し、次の URL を開く
   https://{ip}
6. 鍵マークが表示され、警告が出なければ設定完了。アカウントを登録してログインする

うまくいかないとき: 管理者に「はじめにお読みください.txt の手順 2 で失敗した」と伝えてください。
"""
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(f"{root}/scripts/install-client.bat", "sonowa-client-kit/install-client.bat")
    z.write(f"{root}/scripts/setup-windows.ps1", "sonowa-client-kit/setup-windows.ps1")
    z.write(f"{root}/certs/ca.crt", "sonowa-client-kit/ca.crt")
    z.writestr("sonowa-client-kit/はじめにお読みください.txt", "﻿" + readme.replace("\n", "\r\n"))
print(dest)
PY
