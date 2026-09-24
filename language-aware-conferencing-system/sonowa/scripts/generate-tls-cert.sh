#!/usr/bin/env bash
# 社内 LAN 用の TLS 証明書を certs/ に作成する。
# 使い方: scripts/generate-tls-cert.sh <HOST_IP>
#   - certs/ca.crt : 社内ローカル CA（初回のみ作成）。各参加端末はこれを「信頼されたルート証明機関」に一度だけ登録する
#   - certs/tls.crt: CA が署名したサーバー証明書（SAN に HOST_IP・127.0.0.1・localhost）。HOST_IP が変わったときだけ作り直す
# CA 証明書をそのままサーバー証明書に使うと rustls（LiveKit SDK）等が CaUsedAsEndEntity で拒否するため分ける。
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IP="${1:?HOST_IP を指定してください}"
DIR="${ROOT}/certs"
CA_CRT="${DIR}/ca.crt"
CA_KEY="${DIR}/ca.key"
CRT="${DIR}/tls.crt"
KEY="${DIR}/tls.key"
CA_DAYS=3650
LEAF_DAYS=825  # ブラウザが受け付けるサーバー証明書の最長有効期間

mkdir -p "$DIR"
if [[ ! -f "$CA_CRT" || ! -f "$CA_KEY" ]]; then
    openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days "$CA_DAYS" \
        -keyout "$CA_KEY" -out "$CA_CRT" -subj "/CN=Sonowa Local CA" \
        -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
    chmod 600 "$CA_KEY"
    echo "[tls] 社内ローカル CA を作成しました: ${CA_CRT}（各端末で信頼登録が必要）"
fi

if [[ -f "$CRT" ]] \
    && openssl verify -CAfile "$CA_CRT" "$CRT" >/dev/null 2>&1 \
    && openssl x509 -in "$CRT" -noout -ext subjectAltName 2>/dev/null | grep -q "IP Address:${IP}\b"; then
    echo "[tls] 既存のサーバー証明書を使用します（${IP}）"
    exit 0
fi

EXT="$(mktemp)"
trap 'rm -f "$EXT" "${DIR}/tls.csr"' EXIT
cat > "$EXT" <<CONF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:${IP},IP:127.0.0.1,DNS:localhost
CONF
openssl req -newkey rsa:2048 -sha256 -nodes -keyout "$KEY" -out "${DIR}/tls.csr" \
    -subj "/CN=${IP}" 2>/dev/null
openssl x509 -req -in "${DIR}/tls.csr" -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial \
    -days "$LEAF_DAYS" -sha256 -extfile "$EXT" -out "$CRT" 2>/dev/null
chmod 600 "$KEY"
echo "[tls] サーバー証明書を作成しました: ${CRT}（${IP}、${LEAF_DAYS}日）"
