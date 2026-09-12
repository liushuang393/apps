# testing-kit 改善バックログ

対象: `/home/liush/projects/serverlessAIAgents/testing-kit` v0.3.0  
目的: **手順は共通、差分は契約で宣言**できるようにする。  
作成日: 2026-09-06

> Sonowa 側から見た摩擦に基づく。kit ツリーが書込不可な環境では、本バックログを正とし、書込可能時に還元する。

## 優先度凡例

- P0: 一歩一通るを阻む
- P1: 再利用／正式方針整合
- P2: 体験向上

---

## P0

### K1. AuthMode プラグイン

**問題**: `python-react-fastapi` 生成 helper が BFF Cookie＋他 PJ の `SEED_USERS` 前提。Sonowa のような JWT + localStorage（zustand persist）と不一致。

**設計**:

```text
auth.mode =
  jwt-localstorage | bff-cookie | session-cookie | api_key | none
```

- init が mode に応じた helper テンプレを生成
- 他 PJ の credential を誤流用しない（app 固有 seed／self-register）
- bypass／stub-token は全 mode で禁止のまま

**受入**: Sonowa で `mode=jwt-localstorage` を宣言するだけで AUTH-001 が通る（手書き helper 不要）。

### K2. doctor の Docker／WSL 診断

**問題**: Docker Desktop の proxy sock に write 権限が無いと connect が Permission denied。doctor が「エンジン未起動」と誤診しやすい。

**設計**:

- sock の存在／mode／uid／write 可否を検査
- WSL + Docker Desktop の典型修復を表示（PowerShell `docker info`、Integration、再起動）
- installed-kit でも同一出力

**受入**: 権限問題と「未起動」を区別したメッセージが出る。

**Sonowa 実測（2026-09-06）**: `docker info` は Client 情報まで出るが `docker.proxy.sock` で Permission denied。B レーン preflight はこれを `BLOCKED` として記録（失敗にしない）。

### K3. identity probe の汎用化

**問題**: `/__testing_kit_identity` 固定は多くの実アプリに無い。

**設計**:

```toml
[browser.identity_probe]
kind = "health_json" | "http_status" | "none"
path = "/health"
```

**受入**: Sonowa は `GET /health` だけで probe 合格可能。

### K4. init 後ゲートの分離

**問題**: SAMPLE-001（起動疎通）緑 ≠ 業務認証完了。

**設計**:

- `SAMPLE` = 起動
- `P0_MIN` = AUTH／ROOM 最小（adapter が要求）
- `certify-project --strict` は P0_MIN 無しで不合格

---

## P1

### K5. AI HTTP stub を kit 資産化

**問題**: 文書は release=HTTP stub container、process Fake 禁止。アプリごとに process mock が生えると方針と乖離。

**設計**:

- OpenAI 互換 stub image（固定応答＋ request/response hash）
- `e2e-lane.sh release` が stub を起動し `*_BASE_URL` を差し替え
- evidence に image digest 必須

**受入**: Sonowa A レーンが process `MockAIProvider` なしで通る。

### K6. installed-kit 正式化

**問題**: editable install が kit 側書込権限で失敗。wheel 経路が第二級扱い。

**設計**:

- `pip install testing-kit-py==x.y.z`（または dist wheel）を正本
- doctor が kit 書込不可でも wheel 利用可と明示
- `certify-project` を installed-kit で完走（`--copy-isolated` 以外）

### K7. Realtime capability 骨格

**問題**: `media_capture`／`participants=2` は宣言できるが、2 browser context＋fake media の共通枠が無い。

**設計**:

- kit: 2 context 起動、権限 grant、成功条件型
- app: LiveKit 接続・track 名など固有実装

### K8. existing-server を first-class

**問題**: portable では Docker 必須ではないが、実運用の「既に compose 済み」が第一級でない。

**設計**:

- `deployment.default_mode=existing-server` をテンプレ選択肢に
- health 待ちを lane 入口に標準同梱

---

## P2

### K9. Playwright ブラウザ取得の堅牢化

- CDN／キャッシュ済み chromium の再利用
- `--with-deps` 失敗時のフォールバックメッセージ
- **Sonowa 実測（2026-09-06）**: グローバル `~/.cache/ms-playwright` が root 所有だと symlink 不可。プロジェクトローカル `PLAYWRIGHT_BROWSERS_PATH=.scratch/ms-playwright` と revision alias（1208→1200）＋ ffmpeg 同梱が有効。kit doctor に「writable browsers path」検査を追加したい。

### K10. レポート鮮度 API の portable 同梱

- installed-kit でも `docs/testing/report/` 生成が一コマンド

### K12. installed-kit Spec C（AI manifest）と doctor ratchet

**Sonowa 実測（2026-09-06）**:

- `testing-kit doctor`: `project root contract` が `legacy=41 > baseline=40`（kit ソース側 `check_frontend_auth_contract.py`）
- `certify-project`: `spec_c_ai_manifest_missing`（portable_preflight）。`ai-install` 実施後も installed-kit / ソース kit の境界で不合格
- デモ Django の evidence にも同エラーが残存 → アプリ固有ではない

**受入**: installed wheel だけで `doctor` + `certify-project` が Sonowa の A レーン証拠と独立に緑になる。

---

## Sonowa から kit への還元メモ

| Sonowa で暫定実装したもの | kit へ移す単位 |
|-------------------------|----------------|
| `e2e/helpers/auth.ts`（JWT persist） | AuthMode=`jwt-localstorage` テンプレ |
| `scripts/e2e_run_a_lane.sh` の health 待ち | lane 入口標準 |
| process `MockAIProvider` | 廃止し K5 stub へ |
| identity_probe 削除 | K3 の `kind=none|health_json` |

## 非目標（kit）

- アプリ業務シナリオの自動発明を合格扱い
- auth bypass の再導入
- 決済／メール等 unsupported 副作用の黙認
