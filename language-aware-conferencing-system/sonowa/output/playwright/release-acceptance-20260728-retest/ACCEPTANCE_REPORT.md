# リリース受入レポート（再検証 / 2026-07-28）

## 判定

**CONDITIONAL GO**

前回 NO-GO の 5 ブロッカーはすべて解消し、静的解析・full pytest・frontend build・
実起動スモーク（2 クライアント / 実 LiveKit / 実 OpenAI）が緑になった。
条件は下記「残リスクと条件」の 2 点（いずれもランタイム挙動には影響しない）。

| # | ブロッカー | 結果 |
|---|---|---|
| 1 | Alembic schema drift | 解消（DB は `016_experiment_metric` = head） |
| 2 | 字幕履歴保存の列欠落 | 解消（`speaker_label` 付きで実 DB 保存に成功） |
| 3 | partial 字幕が無効 | 仕様どおりの既定 OFF と確認。有効化導線は動作を検証済み |
| 4 | 翻訳音声が字幕へ縮退 | 解消（2 クライアントで翻訳音声を受信、`degraded=false`） |
| 5 | full pytest 29 failed | 解消（666 passed / 2 skipped / 0 failed） |

---

## ブロッカー1: Alembic schema drift

- **フィードバックループ**: `repro/loop_a_schema_drift.py`（scratch DB に `alembic upgrade 012` →
  `create_all` → `upgrade head` を実行し、head 到達と `speaker_label` 有無を判定）
- **最小再現**: 「012 まで適用済みの DB に `Base.metadata.create_all` を 1 回実行する」だけで
  `DuplicateTable: asr_correction` が再現。`create_all` を除くと緑になり、load-bearing 要素は
  `create_all` のみと確定した。
- **検証した仮説**: ①migration 自体の不備 ②`create_all` と migration の二重権威
  ③alembic_version の手動改変 ④モデルと migration の乖離 → **正解は②**。
- **根本原因**: 起動時 `init_db()` の `create_all` が「未適用 migration のテーブルだけ先に作る」
  一方で「既存テーブルへ列は追加しない」。この非対称性で alembic_version が 012 のまま
  新テーブルだけ存在するドリフトが生じ、以降の `create_table` が必ず衝突して
  列追加（015）が永久に適用されない。
- **設計修正**: スキーマ権威を Alembic 単独に一元化する。起動時は `alembic upgrade head` を
  実行し、`create_all` は使わない。既存ボリュームを壊さず収束させるため、衝突しうる
  migration に冪等ガード（存在すれば skip）を入れる。
- **変更ファイル**: `backend/app/db/database.py`、`backend/app/db/migration_guards.py`（新規）、
  `backend/alembic/versions/013,014,015,016`
- **回帰テスト**: `backend/tests/test_schema_migration_drift.py`（ドリフト状態からの収束と
  モデル列の網羅を scratch DB で検証）
- **実 DB 確認**: `alembic current` = `016_experiment_metric (head)`。既存データは破壊せず、
  非破壊（列追加と欠落テーブル作成のみ）で収束した。

## ブロッカー2: 字幕履歴保存の列欠落

- **フィードバックループ**: `repro/smoke_transcript_persistence.py`
  （実 DB に `save_transcript_segment` を実行し、`speaker_label` と翻訳行の永続化を判定）
- **最小再現**: 1 発話の保存呼び出しだけで `UndefinedColumnError` が発生。
- **根本原因**: ブロッカー1 と同一（015 の `add_column` が未適用のまま）。保存側は例外を
  warning に落として続行する設計のため、症状は「静かなデータ欠落」として現れていた。
- **結果**: `speaker_label='受入再検証ユーザー'` と翻訳行 1 件の永続化に成功（`smoke_transcript_persistence.log`）。
  実スモークでも ASR 原文「今日は会議のテストです。」と英訳が `transcript_segment` /
  `translation_segment` に保存された。
- **補足**: 実スモークの `speaker_label` は NULL。これは `enable_diarization=False`（既定）で
  話者ラベルを付与しない仕様であり、列欠落ではない（値を渡せば保存されることは上記で実証）。

## ブロッカー3: partial 字幕が無効

- **フィードバックループ**: `backend/tests/test_partial_subtitle_enablement.py`
  （設定を有効化したとき既定 segmenter が暫定イベントを実際に切り出すかを判定）
- **切り分け結果**: コード不備ではなく**意図された既定 OFF**。`config.py` に
  「既定 False（従来どおり final のみ。有効化は本地/低遅延 ASR 環境向け）」と根拠が明記され、
  Ingress 配線（`build_default_segmenter`）・OM 配線（`process_partial` → interim 配信）は
  いずれも実装済みで、既存テストが配信面を担保している。
- **今回の追加**: 「既定 OFF」と「有効化しても動かない」を区別できなかった点が受入の弱点だった
  ため、有効化導線そのものの回帰テストを追加した（有効時は partial が出る／既定では出ない）。
- **リリース判断**: 既定 OFF のまま出す。partial を使う場合は `ENABLE_PARTIAL_SUBTITLES=true`
  （+ `PARTIAL_MS`）を設定する。発話中に追加 ASR 呼び出しが発生するため、雲 ASR 構成では
  コストと遅延が増える点が既定 OFF の理由である。

## ブロッカー4: 翻訳音声が字幕へ縮退

- **フィードバックループ**:
  1. `repro/loop_b3_inflight_interrupt.py`（進行中の聞く主線に interrupt を重ね、翻訳音声の
     破棄＝`hearing_failed_runtime_fallback_reading` を検出）
  2. `repro/loop_b2_hearing_degrade.py`（実 provider で 4 発話連続。音声到達と hearing 可用性を判定）
  3. `repro/smoke_two_clients.py`（実 LiveKit で話者 publish → 聞き手の英語字幕と翻訳音声受信を判定）
- **最小再現**: 「聞く主線の実行中（ASR+MT+TTS で約 2.4 秒）に次発話受理相当の
  `interrupt_speaker` が 1 回入る」だけで、その発話の翻訳音声が破棄される。
- **検証した仮説**: ①TTS 未生成 ②QoE の誤判定 ③producer 側 barge-in が進行中世代を破棄
  ④p95 latch による復帰不能 ⑤OM 配線欠落 → **正解は③と④の複合**（①⑤は loop_b で否定：
  provider は翻訳音声を正常生成していた）。
- **根本原因**:
  - ③ `LiveKitAgent` が `on_final_accepted`（＝発話を queue へ積んだ時点）で
    `interrupt_speaker` を呼び、まだ実行中の**直前**発話の世代を無効化して翻訳音声を捨てていた。
    配信側 barge-in は `GenerationGate` がフレーム単位で既に担保しており、この producer 側
    interrupt は重複かつ有害だった。
  - ④ `HybridQoSMonitor` の p95 が件数窓のみだったため、hearing 停止後は新規サンプルが
    途絶えて古い遅い観測が窓から出て行かず、超過判定が永久に成立して復帰できなかった。
- **設計修正**: barge-in の責務を配信側（`GenerationGate`）単独に寄せ、producer 側の
  先回り interrupt を撤去。縮退判定は `QoEStateMachine` を単一権威に保ったまま、観測側に
  有効期間（`LATENCY_WINDOW_SECONDS=60`）を導入して自然復帰可能にした。
- **変更ファイル**: `backend/app/webrtc/agent.py`、`backend/app/ai_pipeline/qos.py`
- **回帰テスト**: `backend/tests/test_agent_barge_in_timing.py`（進行中世代を無効化しないこと）、
  `backend/tests/test_qos_latency_recovery.py`（窓経過後に超過判定が復帰すること）
- **実測**: 実 provider 4 発話すべてで翻訳音声 2/2 配信・`hearing_available=True`・
  hearing p95 ≒ 2.4 秒（目標 5 秒以内）。実 LiveKit 2 クライアントでも翻訳音声受信を 2 回連続で確認、
  `pipeline_event.degraded` は全件 false、`fallback_reading` ログはゼロ。

## ブロッカー5: full pytest 29 failed

内訳を「環境起因」と「実バグ」に分離した。**実バグは 2 件あり、いずれも修正した。**

| 分類 | 件数 | 内容 | 対応 |
|---|---|---|---|
| 環境（依存欠落） | 24 | `aiosqlite` 未導入で DB テストが全滅 | venv に `aiosqlite` を導入（pyproject は未編集） |
| 実バグ | 1 | 数字保持率 Golden Test が正しい ja→zh 訳を不合格判定 | 修正（下記） |
| 実バグ | 4 | Google provider の SDK 未導入時の扱い | 修正 + 2 件は SDK 必須のため skip 化 |

- **実バグ①（数字保持率の誤検知）**: 通貨単位表が ja/en（`万円` / `million yen`）のみで
  zh（`万元` / `亿元`）を持たず、`1,200 万円` → `1,200 万元` という**正しい訳**が
  保持率 0.5 と判定されていた。zh は正式対応言語であり、品質ゲートの誤検知は
  無用な警告や誤った縮退判断につながる。通貨は言語ごとに名称が異なるため、
  言語非依存の金額印（`_CURRENCY`）へ正規化して比較する方式に修正した。
  - 変更: `backend/app/ai_pipeline/qos.py` / 回帰テスト: `backend/tests/test_qos.py`
    （`test_number_retention_normalizes_chinese_money_units`。改変検知は従来どおり赤になることも確認）
  - 既知の限界: vi の数量語（`triệu` 等）は未対応。誤検知の可能性は残るが、字幕・音声の
    生成には影響せず観測値のみに効く。
- **実バグ②（Google provider の縮退不能）**: `find_spec("google.cloud.speech")` は親名前空間
  `google.cloud` を import しようとするため、`google-genai` のみを導入した**既定構成**では
  `ModuleNotFoundError` を送出していた。`AI_PROVIDER=google` は「未整備なら
  gpt4o_transcribe へフォールバック」と設計されているが、この例外で縮退できず起動が失敗する。
  probe を非例外化した。
  - 変更: `backend/app/ai_pipeline/providers/google.py`（`speech_lib_available`）
  - 回帰テスト: `backend/tests/test_google_provider.py`
    （`test_runtime_unavailable_when_google_namespace_missing`）
  - 残る 2 件は SDK 型の構築が必須のため `skipif` で明示 skip（環境要件）。

---

## テスト・ビルド・スモーク結果

| 項目 | 結果 | 証拠 |
|---|---|---|
| full pytest | PASS | `666 passed, 2 skipped`（`full_pytest.log`） |
| `./scripts/check.sh` | PASS | Ruff lint / format / 構文 / ESLint / TypeScript すべて OK |
| frontend build | PASS | `built in 8.58s`（834.61 kB chunk 警告は前回同様） |
| health | PASS | `GET /health` → `{"status":"ok","service":"lams"}` |
| Alembic | PASS | `current` = `heads` = `016_experiment_metric` |
| 字幕履歴保存 | PASS | `smoke_transcript_persistence.log` |
| 翻訳音声（実 provider 4 発話） | PASS | `smoke_hearing_audio.log`（p95 ≒ 2.4 秒、縮退なし） |
| 2 クライアント E2E（実 LiveKit） | PASS | `smoke_two_clients.log`（英語字幕 + 翻訳音声、2 回連続緑） |
| 縮退ログ / DB フラグ | PASS | `fallback_reading` ゼロ、`pipeline_event.degraded` 全件 false |

実行環境: `HOST_IP=192.168.210.2`（Windows LAN 実測）。`.env` / `.env.example` は未編集。

## 残リスクと条件

1. **テスト依存の宣言漏れ（条件）**: `pyproject.toml` の dev extra は `ruff` のみで、
   `pytest` / `aiosqlite` を含まない。今回は venv へ `aiosqlite` を導入して緑にしたが、
   クリーン環境では再現しない。CI 再現性のため dev extra への追加を推奨する
   （リポジトリ規則により `pyproject.toml` は未編集。追加可否の判断を依頼する）。
2. **partial 字幕の方針確認（条件）**: 既定 OFF のまま出荷する判断でよいかの確認。
   有効化する場合は低遅延 ASR 構成とコスト増の受容が前提。
3. Google provider の 2 テストは `google-cloud-speech` 未導入のため skip（optional 依存）。
4. 縮退からの自然復帰には最大 60 秒（`LATENCY_WINDOW_SECONDS`）かかる。
5. `speaker_label` は `enable_diarization=true` のときのみ充填される（既定 OFF）。
6. 数字保持率の vi 数量語は未対応（観測値のみに影響）。

## 稼働中サービス

スモーク成功のため稼働を維持している。

| サービス | 状態 |
|---|---|
| backend | 稼働（今回の修正を反映して再作成） |
| frontend | 稼働（今回起動） |
| livekit | 稼働（受入前から。`192.168.210.2` を広告） |
| postgres / redis / coturn | 稼働（受入前から） |

## 証跡

- `full_pytest.log`
- `smoke_two_clients.log`
- `smoke_hearing_audio.log`
- `smoke_transcript_persistence.log`
- `repro/smoke_two_clients.py`（実 LiveKit 2 クライアント E2E）
- `repro/smoke_transcript_persistence.py`（実 DB 字幕履歴保存）
- `repro/loop_a_schema_drift.py`、`repro/loop_b_hearing_audio.py`、
  `repro/loop_b2_hearing_degrade.py`、`repro/loop_b3_inflight_interrupt.py`
  （いずれも冒頭に `[debug harness]` と明記したデバッグ用の使い捨てループ）

デバッグログ（`[DEBUG-` 接頭辞）の残骸は 0 件（`rg` で確認）。
