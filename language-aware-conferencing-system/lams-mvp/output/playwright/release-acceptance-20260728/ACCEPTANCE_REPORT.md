# リリース受入レポート（2026-07-28）

## 判定

**NO-GO**

3 ユーザーの LiveKit 同時接続と双方向の音声→字幕→翻訳字幕は実証できたが、以下のリリースブロッカーがある。

1. Alembic が `012_default_mode_a` のままで、`013_training_data` 適用時に既存 `asr_correction` テーブルと衝突する。
2. 実音声処理中、`transcript_segment.speaker_label` 列欠落により字幕履歴の DB 保存が継続的に失敗する。
3. full pytest は `29 failed, 624 passed, 2 skipped`。うち 24 件は `aiosqlite` 未導入、4 件は `google.cloud` 未導入時の Google provider、1 件は数字保持率 Golden Test の実失敗。
4. release runtime では partial 字幕が無効（`enable_partial_subtitles=False`）。
5. 翻訳音声は生成されず、全クライアントが「翻訳音声の品質が低下しています。字幕を優先して利用してください。」へ縮退した。

## リリース対象

- 対象: `/mnt/d/apps/language-aware-conferencing-system/lams-mvp`
- 実行: `HOST_IP=192.168.210.2 ./scripts/start-docker.sh --build`
- Windows LAN IP 実測: `192.168.210.2`
- WSL 内部 IP: `172.17.125.207`（公開 IP として不使用）
- LiveKit 起動ログ: `nodeIP=192.168.210.2`
- `.env` / `.env.example`: 編集していない

`start-with-keys.sh` は `.env` の `HOST_IP` を書き換える実装のため、編集禁止条件に従い、同じ公式 Docker 起動スクリプトへ `HOST_IP` を inline で渡した。

## 静的・テスト・ビルド

| 項目 | 結果 | 証拠 |
|---|---|---|
| `./scripts/check.sh` | PASS | Ruff、format、構文、ESLint、TypeScript が成功 |
| frontend type-check | PASS | exit 0 |
| frontend lint | PASS | exit 0 |
| frontend build | PASS | exit 0。834.61 kB chunk 警告あり |
| focused Output Manager/QoE/runtime/ingress/revision/legacy tests | PASS | 212 passed |
| backend full pytest | FAIL | 29 failed, 624 passed, 2 skipped |
| migration | FAIL | `DuplicateTableError: relation "asr_correction" already exists` |
| Alembic revision | FAIL | current `012_default_mode_a` / head `016_experiment_metric` |

## 3 ユーザー E2E

| シナリオ | 結果 | 詳細 |
|---|---|---|
| A(ja) / B(en) / C(zh) 独立登録 | PASS | 3 独立 Playwright session。現在の console error は各 0 |
| A が room 作成、B/C join | PASS | `Release Acceptance 20260728` |
| 3 人同時接続 | PASS | 3 ブラウザすべて参加者 3 を表示 |
| UI 表示言語変更 | PASS | A=ja、B=en、C=zh |
| 字幕 ON/OFF、原音/翻訳音声、翻訳先変更 | PASS | A=en、B=zh、C=vi への変更を画面で確認 |
| A→B/C マイク publish | PASS | 日本語 WAV fixture、A は「発話中」 |
| A→B/C final 字幕 | PASS | A/B に日本語原文、C にベトナム語翻訳字幕 |
| B→A/C マイク publish | PASS | 英語 WAV fixture、B は「発話中」 |
| B→A/C final 字幕 | PASS | A に日本語、C にベトナム語の翻訳字幕 |
| partial/interim 字幕 | FAIL | runtime 設定が無効。focused test のみ成功 |
| 翻訳音声 | FAIL | UI 切替は成功したが、runtime は字幕縮退。音声生成の実証なし |
| B 退室→再入室 | PASS | 他 2 人は継続、B 再入室後に参加者 3 |
| C リロード | PASS（接続） | 再接続し参加者 3。音声モード/翻訳先は既定値へ戻った |
| 全員退出 | PASS | room 一覧で参加者 0 を確認 |

## QoE・縮退

- PASS: degraded UI が 3 クライアントで表示され、字幕処理は継続した。
- PASS: QoE/Output Manager focused tests 212 件が成功した。
- SKIP: 人工的な listener-local ネットワーク劣化注入。既に翻訳音声が runtime 縮退しており、追加注入は診断価値が低いため実施しなかった。
- FAIL: degraded から翻訳音声への recover は確認できなかった。

## Console / Network / Server logs

- 最終 A/B/C browser console: error 0。
- 最終 A/B/C network: 4xx/5xx なし。
- 初回登録で予約 TLD のメールを入力した際のみ 422 を確認し、有効なローカル試験用メールへ変更後は成功した。
- LiveKit: 意図的な browser 再起動・退室時に `dtls timeout` warning。各再接続は成功した。
- Backend: `transcript_segment.speaker_label` 欠落による `UndefinedColumnError` が反復し、字幕履歴保存は FAIL。
- 参加者退室後、既存字幕の話者表示が一部「不明」に変化した。
- Pipeline event と画面字幕は継続し、ASR と翻訳字幕自体は双方向で確認した。

## 主な証跡

- `user-a-three-participants.png`
- `user-b-three-participants.png`
- `user-c-three-participants.png`
- `user-a-settings.png`
- `user-b-settings.png`
- `user-c-settings.png`
- `user-a-audio-output.png`
- `user-b-received-audio.png`
- `user-c-received-audio.png`
- `user-b-audio-output.png`
- `user-a-received-b.png`
- `user-c-received-b.png`
- `user-b-left-room.png`
- `user-a-continues-after-b-left.png`
- `user-b-rejoined.png`
- `user-c-reloaded.png`
- `acceptance-ja.wav`
- `acceptance-en.wav`

## 終了状態

- NO-GO のため、今回新規に起動した `backend` と `frontend` は停止した。
- 受入前から稼働していた `postgres`、`redis`、`coturn` は停止していない。
- 受入前から稼働していた LiveKit は停止していない。今回の再生成後も `192.168.210.2` を広告している。
- 一時 room は全員退出済み（参加者 0）。試験ユーザーと room レコードは削除 API がないため残置した。

## 再現・再受入の最短手順

1. DB の実テーブルと Alembic 履歴を整合させ、`alembic upgrade head` を成功させる。
2. `transcript_segment.speaker_label` を含む head schema で音声を 1 発話し、履歴保存を確認する。
3. full pytest の依存不足と Golden Test を解消し、全件成功させる。
4. release runtime で partial を有効化し、partial→final の画面遷移を確認する。
5. 翻訳音声の degraded reason を解消し、原音/翻訳音声の実再生を 2 クライアントで確認する。
