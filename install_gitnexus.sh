#!/bin/bash
# GitNexus インストールスクリプト
set -e

# Node.js がインストールされているか確認
if ! command -v node >/dev/null 2>&1; then
  echo "[INFO] Node.js が見つかりません。インストールを開始します。"
  # apt を使って Node.js 18.x をインストール
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# npm がインストールされているか確認
if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm が見つかりません。Node.js のインストールに問題があります。"
  exit 1
fi

# npm の絶対パスを取得（sudo 実行時に PATH が引き継がれない場合に備える）
NPM_BIN="$(command -v npm)"

# GitNexus をグローバルインストール
sudo env PATH="$PATH" "$NPM_BIN" install -g gitnexus@latest

# MCP 設定を実行（ユーザー権限で）
npx gitnexus setup

echo "[SUCCESS] GitNexus のインストールとセットアップが完了しました。"
