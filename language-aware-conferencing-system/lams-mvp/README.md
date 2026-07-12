# LAMS - 言語感知型会議システム

**Language-Aware Meeting System** — 社内多言語会議の認知負荷を軽減するリアルタイム音声翻訳・字幕システム。

参加者は「原声」か「翻訳音声」を自由に選択でき、聴いている音声と同じ言語の字幕が表示される。翻訳ツールではなく「言語の壁を意識させない会議体験」を目的とする。

## 概要

| 特長 | 説明 |
|------|------|
| ユーザー主導 | 各参加者が「原声 / 翻訳音声」を自由に選択 |
| 認知負荷ゼロ | デフォルトは原声モード |
| 字幕と音声の一致 | 聴いている音声と同じ言語の字幕のみ表示 |
| 低遅延目標 | 1200ms以下（`max_latency_ms=1200`） |
| プライバシー重視 | 社内利用前提 |
| 自動会議記録 | 全発言を記録し言語別エクスポート可能 |
| 管理者機能 | ユーザー管理・統計・RBAC（admin/moderator/user） |

**対応言語**: 日本語(ja) / 英語(en) / 中国語(zh) / ベトナム語(vi)

**AIプロバイダー**（`AI_PROVIDER` で選択。モデル名は `backend/app/config.py` の既定値）:

| プロバイダー | パイプライン / モデル | 用途 |
|---|---|---|
| `gpt4o_transcribe` | GPT-4o-transcribe ASR + GPT-4o-mini 翻訳 + tts-1 | 推奨（デフォルト） |
| `gpt_realtime` | GPT-Realtime S2S（GA対応が必要な実験経路） | 最低遅延 |
| `deepgram` | Deepgram Nova-3 ASR + GPT-4o-mini 翻訳 + tts-1 | 高精度ASR |
| `google` | Google Chirp 3 ASR + Cloud Translation v3（Mode B） | 高精度・正式記録 |
| `gemini_live` | Gemini Live S2S（鍵整備後に再検証する実験経路） | S2S 代替 |

> `google` / `gemini_live` はキー・認証未整備時、起動を止めず `gpt4o_transcribe` へ自動フォールバックする。
> ASR / MT / TTS は `ASR_PROVIDER` / `MT_PROVIDER` / `TTS_PROVIDER` で独立に差し替え可能（Composite。既定 `auto`）。
> 補正・議事録用 LLM はテキスト系モデル（GPT: gpt-4o-mini / Gemini: gemini-2.5-flash）を使用する。

---

## アーキテクチャ設計（本番想定）

> 本章は設計仕様書 [`改善.md`](./改善.md)（全20章）を LAMS 実装へマッピングした本番アーキテクチャである。
> 通信は **WebRTC に統一**、翻訳は **2系統（OpenAI / Google）**、LLM は **2種（GPT / Gemini）** に限定する。

### 0. 絶対原則：2つの大主線を混ぜない

本システムは以下 **2本の独立した主線（パイプライン）** で構成する。両者はコードパスを共有せず、
**フォークは Gateway での音声複製のみ**、**収束は Output Manager と DB（provider/mode タグ付け）のみ**とする。

| 主線 | 方式 | 遅延 | 精度 | 定制能力 | 適合シーン |
|---|---|---:|---:|---:|---|
| **主線1（Mode A）** | End-to-End Speech-to-Speech（OpenAI Realtime / Gemini Live） | 最低/較低 | 中高 | 較弱 | 実時同伝・軽会議 |
| **主線2（Mode B）** | ASR → MT + 術語庫 → 字幕（Google Chirp 3 + Cloud Translation） | 較低 | 高 | 強 | **MVP 首選**・高精度・正式記録 |

- **主線1** は Google ASR / 術語庫 / Cloud Translation を**一切経由しない**。出力は翻訳音声 + transcript delta。
- **主線2** は翻訳音声を生成しない（字幕・議事録特化）。出力は字幕 + transcript log + 議事録。
- **Phase 3 ハイブリッド**は「同一マイク音声を Gateway で複製し両主線へ流す」だけで、**パイプライン同士は結合しない**
  （聞く=OpenAI、読む/残す=Google）。

```text
                      ┌─ 主線1: OpenAI Realtime S2S ─→ 翻訳音声 + transcript delta
Mic ─WebRTC→ Gateway ─┤  (Mode Router が選択のみ)
                      └─ 主線2: Chirp 3 → 正規化 → 術語庫 → Cloud Translation → LLM補正 → 字幕/議事録
```

### 1. 全体構成

```text
Client (WebRTC)
  │  Audio Track(uplink) / Remote Audio Track(downlink) / DataChannel(字幕・制御)
  ▼
Realtime Gateway（音声複製の唯一のフォーク点）
  ▼
Session Orchestrator ─→ Mode Router ─→ Provider Registry
  ├── 主線1: OpenAIRealtimeS2SProcessor
  └── 主線2: GoogleAsrMtSubtitleProcessor
  ▼
Output Manager（翻訳音声 / 原文字幕 / 翻訳字幕 / transcript / 議事録）
```

### 2. クライアント通信方式（WebRTC 統一）

WebSocket・WebTransport・独自RTCは**正式設計対象外**。ただし WebRTC DataChannel は WebRTC の一部として利用する。

| トラック種別 | 用途 |
|---|---|
| Audio Track | ユーザー音声 uplink |
| Remote Audio Track | 翻訳音声 downlink（主線1のみ） |
| DataChannel | 原文/翻訳字幕・partial/final transcript・mode change・provider status・error/fallback |
| SRTP / DTLS | 暗号化通信 |
| ICE / TURN | NAT 越え |
| Jitter Buffer | 音声再生安定化 |

#### 2.1 メディア・トポロジー（主線ごとに分離）

- **主線1（Mode A / OpenAI S2S）**: ブラウザが**ephemeral key で OpenAI Realtime へ直接 WebRTC**接続するのが最低遅延。
  サーバーは ephemeral token 発行のみを担い、transcript delta を DataChannel 経由でログへミラーする。
- **主線2（Mode B / Google）**: 音声はサーバー側 ASR に届ける必要があるため、**SFU + サーバー側エージェント**構成。
  エージェントが各話者トラックを購読 → Opus を PCM へデコード → Chirp 3 ストリーミング ASR へ投入する。

#### 2.2 SFU 選定

| 選択肢 | 位置づけ | 理由 |
|---|---|---|
| **LiveKit（推奨・本番）** | Realtime Gateway / SFU | OSS(Apache-2.0)・自前ホスト/Cloud両対応・Python Agent SDK で server-side 参加が容易・TURN同梱 |
| **aiortc（移行ブリッジ）** | FastAPI 内 WebRTC peer | 新インフラ不要で既存 backend に同居でき、WS→WebRTC の段階移行に使える。大規模 fan-out には不向き |

> 本番（上線・販売）は **LiveKit SFU** を基盤とし、Phase 2 の検証は **aiortc ブリッジ**で先行する。

#### 2.3 シグナリング・NAT 越え

- LiveKit: サーバーが room/identity スコープの access token を発行（既存 JWT と対応付け）、ICE/SDP は LiveKit SDK が処理。
- OpenAI 直結: サーバーが ephemeral session token を発行し、クライアントが SDP offer/answer を OpenAI と交換。
- TURN: 本番は **coturn**（または LiveKit 同梱 TURN）+ TLS。STUN はパブリック/自前を併用。

#### 2.4 LiveKit イベント ↔ クライアント配信（実装済み）

WebSocket は廃止済みで、トランスポートは LiveKit へ一本化済み（旧 `websocket/handler.py` / `useWebSocket.ts` は削除済み）。
フロントは `useLiveKit.ts` で接続し、バックエンドは参加トークン発行 + LiveKit Agent（`webrtc/agent.py` 音声フォーク Gateway）でのみ LiveKit と通信する。
字幕・制御は LiveKit のデータ配信、翻訳音声は Remote Audio Track で送る。

| イベント / トラック | 配信経路（`webrtc/sink.py` ほか） | 内容 |
|---|---|---|
| `subtitle` / `subtitle_interim` | LiveKit data（`deliver_subtitle`） | 原文/翻訳字幕・partial/final |
| `qos_warning` | LiveKit data（`deliver_event`） | §9 QoS 目標逸脱通知 |
| 翻訳音声（PCM） | Remote Audio Track（`publisher.py`） | 聞く主線の翻訳音声 24kHz |

### 3. モード / Provider 切替

- **Mode Router**：`if` 文の羅列を避け、Session Orchestrator 配下で主線を選択する単一責務。
- **切替単位は3つに限定**：会議単位 / ユーザー単位（翻訳音声 ON/OFF）/ 言語ペア単位（`language_routes`）。
- **Provider Registry**（`registry.py`）：ASR（GPT-4o / Deepgram Nova-3 / Chirp 3）・MT（OpenAI / Cloud Translation）・
  TTS（OpenAI / none）をステージ単位のカタログで集中管理し、`*_PROVIDER` env で差し替える。S2S は OpenAI Realtime / Gemini Live。
- **既定は `AI_PROVIDER=gpt4o_transcribe`**（カスケード ASR→MT→TTS、標準 REST で安定）。`gpt_realtime` は
  OpenAI Realtime **GA プロトコル**へ移行済みの低遅延オプション（beta 形状は 2025 年に廃止され `beta_api_shape_disabled` になる）。
  ただし現状は発話ごとに WebSocket を張り直すため、接続ハンドシェイク分の遅延が乗る点に注意。

### 4. Provider Interface ↔ 既存 `AIProvider` 抽象の対応

`改善.md` 8.3 の4インターフェースを、既存 `app/ai_pipeline/providers/base.py::AIProvider` と整合させる。

| 改善.md Interface | 既存抽象との関係 | 実装状況 |
|---|---|---|
| `SpeechToSpeechProvider` | `gpt_realtime` / `gemini_live` | 実装済み（主線1。OpenAI Realtime + Gemini Live） |
| `ASRProvider` | `AIProvider.transcribe_*` を分離 | 実装済み（`stages.py` でステージ化。Chirp 3 / Deepgram / GPT-4o） |
| `TranslationProvider` | Composite MT ステージ | 実装済み（`OpenAIMTStage` / `GoogleMTStage` + 術語庫連携） |
| `LLMCorrectionProvider` | `correction.py` / `minutes.py` | 実装済み（補正=Gemini / 議事録=GPT優先・Gemini fallback） |

### 5. 術語庫（Glossary）・精度向上

精度競争力はモデルではなく**企業ごとの用語資産**で決まる（主線2の中核）。適用順序：

```text
ASR transcript → 人名/会社名補正 → 数字/日付/金額正規化 → 用語候補抽出
→ Cloud Translation glossary/adaptive → LLM による最終表記統一
```

`glossary_term`（tenant 単位・source/target・priority・`do_not_translate`・enabled）を新設し、CRUD API と
翻訳パイプラインの pre/post 処理として統合する。

### 6. LLM 補正

LLM は翻訳の主役ではなく**補正・整形・会議理解**に使う（表記統一/文脈補正/敬語/数字保持/議事録/ToDo抽出）。
`config.py` で次の2スロットを制御する（モデルは GPT=`gpt-4o-mini` / Gemini=`gemini-2.5-flash`）:

```bash
LLM_CORRECTION_PROVIDER=off       # off（既定・非介入） / gemini（翻訳校正）
LLM_MINUTES_PROVIDER=auto         # auto（GPT優先・Gemini fallback） / gpt / gemini / off
```

補正プロンプト原則：数字/日付/金額/固有名詞を変更しない・術語庫の指定訳を必ず使う・意味を追加しない・
推測補完しすぎない・target_language のみ出力。

### 7. データ設計 ↔ 既存モデル

| 改善.md テーブル | 既存モデル（`app/db/models.py`） | 方針 |
|---|---|---|
| `meeting` | `Room` + `MeetingSession` | 既存流用（`default_mode` 等を拡張） |
| `participant` | Redis（`rooms/manager.py`）+ 一部DB | 永続化が必要な項目のみDB化 |
| `transcript_segment` | `Subtitle.original_*` | provider/confidence/is_final を追加 or 新表 |
| `translation_segment` | `Subtitle.translations(JSON)` | provider/llm_provider/glossary_version/quality_score を分離 |
| `glossary_term` | **新規** | 多テナント術語庫 |

> 既存 `Subtitle` データは非破壊。Alembic migration で追加し、後方互換を維持する。

### 8. 主要 API（追加・拡張）

| メソッド・パス | 用途 |
|---|---|
| `POST /api/meetings` | 会議作成（source/target languages, `default_mode`, `enable_openai_s2s`） |
| `PATCH /api/meetings/{id}/mode` | モード切替（主線の選択） |
| `PATCH /api/meetings/{id}/participants/{pid}/voice-translation` | ユーザー単位の翻訳音声 ON/OFF |
| `POST /api/rooms/{id}/token` | LiveKit 参加トークン発行（WebRTC 接続用） |
| `GET /api/rooms/{id}/transcript` | 会議記録取得（`session_id` 指定で会議回単位に絞込可能） |
| `GET /api/rooms/{id}/minutes` | 議事録生成（`session_id` 指定で会議回単位に絞込可能） |
| `POST/GET/PATCH/DELETE /api/glossaries/terms` | 術語庫 CRUD（要admin） |

### 9. 品質ゲート（最低基準）

| 指標 | 目標 |
|---|---:|
| 用語命中率 | 95% 以上 |
| 数字・日付保持 | 98% 以上 |
| 翻訳字幕 P95 遅延（主線2） | 4 秒以内 |
| 音声翻訳 P95 遅延（主線1） | 5 秒以内 |
| 重大誤訳 | 0 件 |
| 会後議事録可用率 | 95% 以上 |

### 10. 障害時 Fallback（主線間の縮退）

| 障害 | 対応 |
|---|---|
| OpenAI Realtime 障害 | 主線2（Google 字幕）へ切替 |
| Google ASR 障害 | 主線1の transcript を暫定利用 |
| Google Translation 障害 | GPT で翻訳 |
| GPT 障害 / Gemini 障害 | 相互 fallback |
| 翻訳音声障害 / 字幕障害 | 片方を継続 |
| WebRTC 切断 | 再接続、失敗時は一時離脱扱い |

### 11. セキュリティ

- 通信は SRTP/DTLS（WebRTC）で暗号化。シグナリングは TLS。
- ルーム参加は JWT 由来の短命トークン（LiveKit access / OpenAI ephemeral）でスコープ制限。
- API キー・認証情報は環境変数のみ（コード・ログ・URL・引数に出さない）。多テナント分離を術語庫/データに徹底。

### 12. 実装ロードマップと現状ギャップ

| Phase | 内容 | 現状 |
|---|---|---|
| **Phase 1（MVP・主線2優先）** | Chirp 3 ASR → Cloud Translation + 術語庫 → 字幕 → 議事録 | 実装済み（現行の出荷基線） |
| **Phase 2（主線1追加）** | OpenAI Realtime S2S + ユーザー翻訳音声 ON/OFF + Mode Router | 実装あり（`mode1` は再検証/再設計対象） |
| **Phase 3（ハイブリッド）** | 同一音声を両主線へ複製（聞く=S2S / 読む=ASR+MT） | 実装あり（QoS・実機検証は継続中） |

> **通信レイヤー**：WebRTC（LiveKit）へ一本化済み（詳細は §2.4）。

---

## セットアップと起動

ローカル開発と Docker 起動は混在させず、以下のどちらか一方を選ぶ。

### 共通準備（初回のみ）

- WSL2 + Docker Desktop（Docker Compose v2）
- ローカル開発のみ Python 3.10+、Node.js 20+

環境変数ファイルを用意する。

```bash
cd lams-mvp
cp .env.example .env
```

**手で記入するのは API キーだけ**でよい。起動スクリプトは `.env` を変更しない。

| 変数 | 記入 | 自動設定のされ方 |
|---|---|---|
| `OPENAI_API_KEY` | **必須** | 自動化なし。`.env` に記入するか `export OPENAI_API_KEY=sk-xxx`（シェル環境変数が `.env` より優先） |
| `AI_PROVIDER` | 任意 | 既定 `gpt_realtime`。`gpt4o_transcribe` / `deepgram` / `google` / `gemini_live` |
| `DEEPGRAM_API_KEY` | `deepgram` 使用時のみ | — |
| `GEMINI_API_KEY` | `gemini_live` / LLM補正・議事録(Gemini) 使用時のみ | 未設定なら該当機能は自動無効化 |
| `GOOGLE_PROJECT_ID` ほか | `google` 使用時のみ | 未設定なら `gpt4o_transcribe` へ自動フォールバック |
| `DATABASE_URL` / `REDIS_URL` | **不要** | Docker: compose がコンテナ内向けに自動注入 / ローカル: 起動スクリプトが `localhost:5433` / `localhost:6380` を既定設定 |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | 開発では不要 | dev 既定値（`devkey` / `devsecret...`）が `.env.example` と compose で一致済み。**本番では必ず変更** |
| `JWT_SECRET` | 開発では不要 | dev 既定値あり。**本番では必ず変更** |
| `HOST_IP` | 通常は不要 | 起動時に Windows の LAN IPv4 を自動検出。誤検出時だけコマンドで明示する |
| `BACKEND_PORT` / `FRONTEND_PORT` | 不要 | 既定 `8090` / `5273`。ここを変えるだけで compose・CORS・nginx が追随 |
| `ASR_PROVIDER` / `MT_PROVIDER` / `TTS_PROVIDER` | 任意 | 既定 `auto`（ステージ別差し替え用） |

> **優先順位**: シェル環境変数 > `.env`。`.env` は `.gitignore` 済みでコミットされない。
> 起動スクリプトは API キーや検出 IP を `.env` へ書き戻さない。
> 本番ではクラウドの環境変数 / Docker secrets を使用し、キーをディスクに置かないこと。

## Docker 起動（WSL2 へのローカル配備）

frontend / backend / PostgreSQL / Redis / LiveKit / coturn をすべてコンテナで起動する。通常の動作確認と複数端末での会議テストはこちらを使用する。

```bash
./scripts/start-docker.sh --build  # 初回、Dockerfile・依存変更後
./scripts/start-docker.sh          # 2回目以降
```

スクリプトは Docker、Compose、API キー、ポート値を事前検証し、LAN IP を自動検出して LiveKit の ICE 候補へ渡す。起動後は backend のヘルスチェックを待ち、localhost と LAN の両 URL を表示する。

```bash
# IP を誤検出する場合
./scripts/start-docker.sh --host-ip 192.168.1.20

# ログを前面に表示する場合（終了は Ctrl+C）
./scripts/start-docker.sh --foreground

# 停止（データは保持）/ 停止してデータも削除
docker compose down
docker compose down -v
```

> `docker compose down -v` は PostgreSQL と Redis の永続データを削除するため、必要な場合だけ実行する。

## ローカル開発起動

backend と frontend は WSL 上、PostgreSQL / Redis / LiveKit / coturn は Docker で起動する。コードのホットリロードが必要な開発時だけ使用する。

```bash
./scripts/start-local.sh
```

この 1 コマンドで依存コンテナと前後端を起動し、終了時には前後端の子プロセスも停止する。初回のみ `frontend/node_modules` がなければ `npm ci` を自動実行する。

```bash
# IP を明示する場合
./scripts/start-local.sh --host-ip 192.168.1.20

# node_modules を自動インストールさせない場合
./scripts/start-local.sh --skip-install
```

ローカル開発を終了した後、依存コンテナも不要なら停止する。

```bash
docker compose stop postgres redis livekit coturn
```

### アクセス URL

| サービス | URL |
|---|---|
| フロントエンド | http://localhost:5273 |
| バックエンドAPI | http://localhost:8090 |
| API ドキュメント | http://localhost:8090/docs |

> ブラウザが直接叩くのは 5273 のみ（API は Vite が `/api` を backend へプロキシするため、CORS・LAN 公開時のポート問題を回避できる）。

---

## 複数マシンでの LAN 連動テスト

1 台の Windows + WSL2 マシンをホストにし、参加端末は同じ LAN からホストの Windows IPv4 へ接続する。ホスト IP は起動時に自動検出され、起動完了メッセージに表示される。

```bash
./scripts/start-docker.sh --build
# 表示例: LAN 内の他マシン: http://192.168.1.20:5273
```

各参加端末で `http://<表示されたIP>:5273` を開く。全端末で同じ IP を使用し、`localhost` や WSL 内部 IP は使用しない。DHCP で IP が変わった場合は、Docker 起動スクリプトを再実行すれば LiveKit も新しい IP で再構成される。

> **注意（IP 自動検出）**:
> - `.env` に `HOST_IP` を固定値で書くと自動検出より**優先**され、IP 変更時に「画面は開くが音声が届かない」原因になる。`.env` の `HOST_IP` は通常コメントアウトのままにする。
> - Windows に複数の LAN アダプタ（Wi-Fi + 有線、テザリング等）がある場合、自動検出が参加者と異なるサブネットの IP を選ぶことがある。その場合は `./scripts/start-docker.sh --host-ip <参加者と同じネットワークのIP>` で明示する。

**Windows 側の初回設定**（PowerShell 管理者権限、1回だけ）:

```powershell
New-NetFirewallRule -DisplayName "LAMS Frontend" -Direction Inbound -LocalPort 5273 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "LAMS Backend" -Direction Inbound -LocalPort 8090 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "LAMS LiveKit TCP" -Direction Inbound -LocalPort 7880,7881 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "LAMS TURN" -Direction Inbound -LocalPort 3478 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "LAMS TURN UDP" -Direction Inbound -LocalPort 3478 -Protocol UDP -Action Allow
New-NetFirewallRule -DisplayName "LAMS LiveKit UDP" -Direction Inbound -LocalPort 50000-50039 -Protocol UDP -Action Allow
```

他PCのブラウザから `http://<WindowsのLAN IP>:5273` でアクセスする。

> - HTTP の LAN IP はブラウザ上の安全なコンテキストではない。検証時は各参加端末の Chrome/Edge で `chrome://flags/#unsafely-treat-insecure-origin-as-secure` に `http://<IP>:5273` を登録してブラウザを再起動する。これは検証専用であり、実運用は HTTPS 化する。
> - Docker Desktop 利用時は公開ポートが Windows 側で直接 listen されるため `netsh portproxy` は**不要**。
>   WSL 内で非Docker のローカル起動をした場合のみ、以下のポート転送が必要（WSL の IP が変わったら再実行）:
>
>   ```powershell
>   $wslIp = (wsl hostname -I).Trim().Split(' ')[0]
>   netsh interface portproxy reset
>   netsh interface portproxy add v4tov4 listenport=5273 listenaddress=0.0.0.0 connectport=5273 connectaddress=$wslIp
>   netsh interface portproxy add v4tov4 listenport=8090 listenaddress=0.0.0.0 connectport=8090 connectaddress=$wslIp
>   ```

接続確認は参加端末から次を実行する。

```text
http://<Windows LAN IP>:5273
http://<Windows LAN IP>:8090/health
```

画面は開くが音声が届かない場合は、Windows Firewall の TCP 7880/7881、UDP 50000-50039 と、起動ログの公開 IP が実際の Windows LAN IP と一致しているかを確認する。

---

## 開発コマンド

```bash
# 静的解析（コミット前必須）
./scripts/check.sh            # 全チェック
./scripts/check.sh --fix      # 自動修正付き
./scripts/check.sh --backend  # / --frontend

# テスト
cd backend && pytest

# DBマイグレーション（Alembic）
docker compose exec backend alembic upgrade head                       # 適用
docker compose exec backend alembic revision --autogenerate -m "説明"  # 作成
docker compose exec backend alembic downgrade -1                       # ロールバック
```

詳細なコーディング規約・品質管理は [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) を参照。
