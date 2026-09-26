# SR workflow session token / quality audit

## 1. 結論

**トークン使用量メタデータの完全性: 欠如。**

監査対象の主トランスクリプト 1 件と、そこから直接起動された E2E 関連
サブエージェント 5 件には、`input_tokens`、`output_tokens`、
`prompt_tokens`、`completion_tokens`、`total_tokens`、usage、cost、
cache 使用量のいずれも存在しない。LAMS 内の関連レポートにも使用量記録はなく、
`.agents/state/receipts/` 自体が存在しない。

したがって、本報告の文字数・イベント数・呼出し数はすべて
**プロンプト／コンテキスト反復の代理指標であり、トークン使用量ではない**。
`.agents/core/common/receipt.md:137-148` も、ホストが公開するときだけ token/model
cost を記録し、欠落をゼロ扱いしない設計である。

主要な実測:

- 監査した E2E 会話 6 JSONL: 307 イベント、481,503 JSONL 文字、
  543,251 bytes、742 tool calls。
- `Read`: 303 回、186 distinct paths。初回以外の同一パス read は 117 回
  （38.6%）。その内訳は同一エージェント内 48 回、隔離された親／子
  コンテキスト間 69 回。
- 保守的な broad-scope search 判定: 37 回（Glob 17、Grep 20）。
- 主会話だけで Docker 関連 Shell は 22 回。明確な接続調査が集中した
  event 6-17、38-40 だけでも 13 回あり、最終的に Docker/LiveKit は
  BLOCKED のままだった。
- 同一の plan 実行指示は event 5、85、124 の 3 回
  （318 文字の query、余分な 2 回 = 636 文字）。event 60-66 は
  同一 timestamp-only 状態が 7 回。
- event 123 の dynamic tool catalog は 17,591 text characters で、
  主会話の全 user text 21,452 characters の 82.0% を単独で占める。
- SR E2E を完全に参照展開した場合の静的文書面は 79,780 characters。
  ただし実会話では `sr-e2e` / `sr-route` / `APPROVE` の実行記録は 0 であり、
  これは**潜在コスト**であって観測済みプロンプト量ではない。

品質は改善したが、SR 文書量による改善とは立証できない。A レーンは
`7 failed -> 5 failed -> 8 passed / 1 skipped -> 同結果再現`、
B Flow2 は PASS、B Flow1 と kit strict certify は BLOCKED だった。
実会話で SR workflow が起動されていないため、`.agents` の追加説明がこの結果を
生んだという因果関係はない。

## 2. 範囲と証拠

### 2.1 主対象

- 主トランスクリプト:
  `/home/liush/.cursor/projects/mnt-d-apps-language-aware-conferencing-system/lams-mvp/agent-transcripts/2eea5715-ab8b-493a-a7e3-467832d03787/2eea5715-ab8b-493a-a7e3-467832d03787.jsonl`
  （event/line 1-178）
- E2E 関連サブエージェント:
  - `subagents/0662faa6-4c87-4481-a4b7-ca4b313c4ff3.jsonl`
    （testing-kit 調査）
  - `subagents/35ca698e-95a9-4932-9b45-6fd8c20cdc6c.jsonl`
    （E2E 導線分析）
  - `subagents/45251016-4914-4da6-8423-04293fcb370d.jsonl`
    （既存テスト調査）
  - `subagents/7129f941-b811-4aa2-82cd-8370eb2e174c.jsonl`
    （E2E harness 実装）
  - `subagents/0563e91e-c7be-4086-94fa-05e21f519e59.jsonl`
    （Mock AI / testid 実装）

上記 5 件は主会話 event 3、41 の dispatch と、event 77 の成果参照から
E2E への直接関連を確認した。その他の Cursor transcript は全文走査せず、
`sr-e2e`、`.agents/core/workflows/e2e`、`Aレーン`、既知 subagent id の
メタデータ／テキスト検索だけを行った。監査開始時に生成された output なしの
research-agent transcript 2 件は E2E 実行証拠ではないため分母から除外した。

### 2.2 workflow / outcome 証拠

- `.agents/skills/sr-e2e/SKILL.md:11-23`
- `.agents/core/workflows/e2e.md:3-10,12-26,28-41,43-55`
- `.agents/local/project.md:63-80,269-289`
- `.agents/core/common/method-router.md:6-23,47-65`
- `.agents/core/common/approval-gate.md:1-45`
- `.agents/core/common/receipt.md:137-155`
- `docs/testing/report/failure-classification.md:3-31`
- `docs/testing/report/a-lane-summary.md:1-11`
- `docs/testing/report/quality-verdict.md:8-67`
- `docs/testing/report/e2e-b-lane-20260906T101254Z.md:1-21`

## 3. 代理指標の方法

### 3.1 分母と単位

1. **JSONL characters / bytes**
   - UTF-8 decode 後の Python `len(text)` と raw byte length。
   - JSON 構文、escaped newline、tool input、会話 text を含む。
2. **event**
   - JSONL の 1 行を 1 event とする。
3. **tool call**
   - `message.content[].type == "tool_use"` を 1 call とする。
4. **duplicate-path read**
   - 6 transcript 全体で同じ `Read.input.path` の 2 回目以降。
   - 各 transcript 内の重複と、別 transcript 間の重複を分けた。
5. **broad-scope search**
   - Glob: repo/kit/backend/frontend root から `**/` で始まる pattern。
   - Grep:同じ root から glob 未指定または `**/` で始まる glob。
   - 機械的で保守的な候補数であり、「37 回すべて不要」という判定ではない。
6. **workflow prompt surface**
   - SR E2E adapter から明示参照される文書と、E2E の phase 文書を
     UTF-8 characters で合計した静的上限。

### 3.2 限界

- 文字と tokenizer token は一致しない。日本語、英語、JSON、コードで比率が
  大きく違うため、文字数から token 数への換算は行わない。
- ホストが各 turn で過去会話をどこまで再送したか、cache hit、system prompt、
  hidden context、model 名は JSONL から分からない。
- 同一パス read には、正当なページング、編集後の再確認、独立レビューも含む。
- tool input character はモデル入力にそのまま再送された量とは限らない。
- 品質への因果は A/B 実験がないため推定できない。本報告は時系列上の関連だけを
  示す。

## 4. 実測結果

### 4.1 会話面

主 transcript:

- 178 events、234,947 characters、270,090 bytes。
- assistant 155 events、user 21 events、`turn_ended` 2 events。
- tool calls 319、assistant text 15,694 characters、
  user text 21,452 characters。
- token/usage/cost に相当する JSON key: 0。

E2E 関連 subagent 5 件:

- 129 events、246,556 characters、273,161 bytes。
- tool calls 423、初回 task prompt 合計 10,117 characters。
- token/usage/cost に相当する JSON key: 0。

合算:

- 307 events、481,503 characters、543,251 bytes。
- 742 tool calls。
- tool input JSON 338,355 characters。そのうち Shell 122,996、
  Write 90,393、StrReplace 47,418、合計 260,807 characters（77.1%）。
  大きな command、全ファイル Write、old/new code の再掲が主要因である。
- text payload は 91,251 characters
  （assistant 59,682、user 31,569）。

### 4.2 read / search の反復

- `Read` 303 calls / 186 distinct paths。
- duplicate-path excess 117:
  - 同一エージェント内 48。
  - 親・子または子同士の隔離 context 間 69。
- 主 transcript 内だけでは 107 reads / 80 paths / excess 27。
- 主な合算再読:
  - `backend/tests/integration/test_livekit_two_clients.py`: 7 calls。
  - `frontend/src/pages/RoomListPage.tsx`: 6 calls。
  - `frontend/src/pages/RoomPage.tsx`: 6 calls。
  - `.gitignore`、`IMPLEMENTATION_PLAN.md`、`backend/app/auth/routes.py`、
    `e2e/helpers/auth.ts`: 各 5 calls。
- broad-scope search proxy は 37 calls
  （primary 7、test-inventory agent 14、journey agent 8、
  Mock agent 4、harness agent 3、kit agent 1）。
  代表例は `45251016...` event 2-4 の `**/*test*`、`**/*smoke*`、
  `**/*.{yml,yaml}`、`**/tests/**` と、event 8 の
  `backend/tests/**` に対する pattern `.` である。

3 initial research agents のうち、kit 専用 1 件は境界が異なるが、
LAMS 導線分析と既存テスト分析の 2 件は App/auth/LiveKit/test paths を
重複して読んだ。さらに実装 agents が同じ task PRD、画面、API helper を再読した。
独立 context の性質上ゼロにはできないが、69 cross-context duplicate-path reads は
共有 evidence manifest がないコストを示す。

### 4.3 繰り返された attached/session state

**実測:**

- plan 実行指示: primary event 5、85、124 の 3 occurrences。
  timestamp を除く query は各 318 characters。余分な 2 occurrences は
  636 characters。
- timestamp-only event: primary event 60-66 に完全一致で 7 occurrences
  （text 59 characters x 7、初回以外 354 repeated characters）。
- auto follow-up instruction: event 67（query 667 characters）と
  event 174（152 characters）。同文ではないが、ユーザー価値を増やさない
  host/session coordination text である。
- dynamic tool catalog: event 123、17,591 text characters、1 occurrence。
  重複ではないが巨大 user/session context である。
- stale active task:
  `.trellis/tasks/09-06-architecture-deepening` が E2E 関連 5 subagent 全ての
  task prompt に付与された。E2E 専用 task は作成されず、event 79-82 で
  Trellis なし継続へ切り替わった。

保存 JSONL には git status や workspace rules の turn ごとの再添付は見えない。
hidden host context の反復回数は測定不能であり、0 とは結論しない。

## 5. framework overhead と重複統制

### 5.1 静的 workflow 面（実測 characters、潜在 input）

SR E2E adapter が最初に要求する adapter + local project + contract +
method router + artifact map + approval gate + E2E workflow は
43,755 characters。E2E が後続 phase で参照する closeout、test-evidence、
review、receipt、guard まで含めると 79,780 characters。

内訳で大きいもの:

- `.agents/core/common/contract.md`: 14,142 characters。
- `.agents/core/common/test-evidence.md`: 12,513。
- `.agents/local/project.md`: 12,402。
- `.agents/core/common/review.md`: 6,693。
- `.agents/core/common/receipt.md`: 6,507。

これは参照ファイル全文を毎回読む実装の場合の静的面であり、主 transcript では
これらを `Read` した証拠がない。

### 5.2 repeated workflow instructions

**実測:**

- 9 個の `.agents/skills/sr-*/SKILL.md` adapter が同じ 8 boilerplate
  directives（repo discovery、project/contract/method/artifact/gate 読込、
  Trellis authority、APPROVE gate）を持つ: 72 static directive instances。
  これは disk repetition であり、一つの skill だけを使う session では
  72 個すべてが input になるわけではない。
- `sr-e2e/SKILL.md:11-18` と
  `core/workflows/e2e.md:3-6` は contract、method-router、artifact-map、
  approval-gate の 4 read directives を重ねて要求する。
- 参照 closure 内の exact lexical counts は `APPROVE` 6、`gate` 46、
  `phase` 55。語彙出現数であり、実行 gate 数ではない。

### 5.3 supervisors と gates

**生成設計の事実:**

- Trellis と SR の 2 層が存在するが、SR は
  `sr-e2e/SKILL.md:20-23` と `method-router.md:6-9,47-65` で
  Trellis を唯一の lifecycle authority と明記する。従って設計上の
  lifecycle owner は 1、SR は phase workflow である。
- E2E は JOURNEY DESIGN / IMPLEMENT / VERIFY の 3 phases。
- local policy は `gates: all`
  (`.agents/local/project.md:70-80`) なので hard approval points は 3。
  E2E 本文の停止点も `e2e.md:25,40,52-55` の 3。

**実会話の事実:**

- `sr-e2e`、`sr-route`、literal `APPROVE`: 各 0 occurrences。
- よって Trellis-vs-SR の同時実行 supervisor duplication は 0。
- Trellis references は 15 occurrences
  （primary events 2、3、79-84）。task/lifecycle 選択は event 2 と 79 の
  2 回質問され、event 81-82 で「Trellis なし」に決定した。
- その後も host plan/todo orchestration は CreatePlan 1 call、
  TodoWrite 11 calls。SR/Trellis ではなく host todo が実質 supervisor になった。
- 実行された SR approval gate は 0。一方、plan 指示は 3 回とも
  “Don't stop until ... all to-dos” を要求しており、SR を同時に起動していれば
  `gates: all` と衝突する。

**推論:**

現設計は権限の二重化を言葉で否定できているが、Trellis task、SR phase、
host plan/todo の状態を自動的に一つへ投影しないため、運用上は supervisor
選択の再質問と stale task injection が残る。

## 6. E2E outcome との関連

### 6.1 改善に結び付いた事実

- `failure-classification.md:3-20`:
  4 iterations で browser/ffmpeg、auth race、register 500、room name、
  create status を分類して解消。
- `a-lane-summary.md:1-11`:
  8 passed / 1 skipped / 0 failed を 2 回再現、Mock provider unit 7 passed。
- `quality-verdict.md:8-55`:
  A PASS、B Flow2 GREEN、frontend/backend static checks OK。
- 安全策として実 JWT、no auth bypass、Mock A lane、失敗分類、flaky 再実行、
  secret 非記録が成果物に残った。これらは主 transcript event 4 の plan と
  events 45、48 の設計説明に現れ、その後の実行と整合する。

### 6.2 workflow text が改善しなかった／立証できない部分

- `.agents` SR workflow の観測 invocation は 0。従って SR の 79,780-character
  closure が上記 PASS に寄与したとは言えない。
- 早期 Docker 接続調査 13 calls
  （primary events 6-17、38-40）は接続を回復せず、
  `quality-verdict.md:41-47,60-65` でも LiveKit と kit certify は BLOCKED。
  event 88 以降の SQLite/Redis local-stack への方針転換は A lane を進めた。
- 3 initial “very thorough” research agents は設計資料を増やしたが、
  runtime で最初に出た 7 failures を予防しなかった。最終修正は
  event 119-140 の実行証拠と局所診断から得られた。
- events 45 と 48 は合計 9,470 assistant text characters の設計説明で、
  event 56 では同内容域を文書へ再掲した。責務分離と安全境界の記録価値はあるが、
  同じ情報を chat と durable artifact の両方へ長文展開する必要性は未立証。
- `quality-verdict.md:60-65` の kit doctor ratchet と Spec C manifest 問題、
  LiveKit blocker は残った。「管理可能失敗 0」は全 E2E 完了ではない。

**評価:** 品質改善に効いた強い証拠は短い runtime loop
（実行 -> 分類 -> 局所修正 -> 再実行）である。長い upfront workflow/
architecture text は安全境界と記録品質には寄与した可能性があるが、
欠陥検出率、修正回数、到達時間を改善した測定はない。

## 7. overhead の帰属

### Framework overhead

- 潜在 E2E reference closure 79,780 characters。
- 9 adapters x 8 boilerplate = 72 static directive instances。
- 4 duplicate read directives、3 mandatory phase gates、
  closure 内 `gate` 46 occurrences。
- ただし今回の実消費としては観測されていない。

### Agent behavior

- 742 tool calls、303 reads、117 duplicate-path excess、
  37 broad-scope searches。
- 5 isolated E2E subagents、10,117 task-prompt characters、
  69 cross-context duplicate-path reads。
- Shell/Write/StrReplace tool input が 260,807 characters。
- Docker-focused retries 22 calls（初期接続調査 13）と
  Playwright-related Shell 17 calls。
- Trellis task 選択の再質問 2、CreatePlan 1、TodoWrite 11。

### Giant user/session context

- event 123 dynamic catalog 17,591 characters。
- 同じ plan 指示 3 occurrences、timestamp-only 7 occurrences、
  auto follow-up 2 occurrences。
- hidden system/workspace context の再送は transcript にないため測定不能。

最大の**観測済み**負荷は agent tool payload と分散 read であり、
最大の**潜在 framework**負荷は phase ごとの全文参照である。巨大 catalog は
単一 event として大きいが、今回の全 6 JSONL 文字分母では 3.7% である。

## 8. 優先改善案

### P0-1. host-native usage metadata を local receipt に保存

- 変更: turn ごとの model、input/output/cache tokens、tool-result bytes、
  cost（公開される場合のみ）を receipt schema の optional measurement に記録。
  非公開値は `absent` とする。
- 期待影響: **最高**。代理指標ではなく workflow 別の実コストを比較可能。
- effort: 中。risk: 低〜中（privacy/secret）。local-only、redaction、
  opt-in export が必要。

### P0-2. phase capsule / lazy loading に変更

- 変更: adapter は task state と current phase を解決し、全文 contract ではなく
  その phase に必要な短い compiled capsule と canonical path/line を返す。
  4 duplicate read directives を除去し、`local/project.md` は該当 section だけ読む。
- 期待影響: **高**。潜在 43,755〜79,780-character surface を直接縮小。
- effort: 中。risk: 中（安全規則の脱落）。golden tests で禁止事項・gate・
  artifact destination の包含を検証する。

### P0-3. environment retry budget と circuit breaker

- 変更: 同じ Docker/Playwright failure signature は 2 回で打ち切り、
  known fallback（PowerShell または local stack）へ遷移する。attempt、
  signature、next action を task state に保存する。
- 期待影響: **高**。今回の未解決 Docker 調査 13-call cluster を削減。
- effort: 低〜中。risk: 低。新 evidence があるときだけ retry を再許可する。

### P0-4. Trellis/SR/host todo の state adapter を一つにする

- 変更: Trellis task を唯一の state とし、SR phase と host todo は派生表示にする。
  task 選択済み／“Trellis なし”を session state に固定し、再質問しない。
  stale active task を subagent prompt に注入しない。
- 期待影響: **高**。supervisor churn、矛盾する stop 条件、5 prompt の stale task
  を除去。
- effort: 中。risk: 中（resume/interrupt）。状態遷移 test が必要。

### P1-1. discovery manifest を共有して dispatch を段階化

- 変更: 最初は 1 discovery agent が path/revision/evidence map だけを返す。
  後続 agent は明示 path list を読み、同じファイルは hash + snippet reference
  で共有する。最初から 3 “very thorough” agents を並行起動しない。
- 期待影響: 高。69 cross-context duplicate reads と broad searches を削減。
- effort: 中。risk: 低〜中（見落とし）。unresolved 欄から追加 discovery 可。

### P1-2. runtime-first E2E loop

- 変更: 最小 preflight 後、まず 1 critical journey を実行し、失敗 signature から
  調査範囲を決める。architecture 文書は evidence を得た後に差分だけ永続化。
- 期待影響: 高。今回最も成果のあった event 119-140 の loop を早める。
- effort: 低。risk: 中（安全前提不足）。secret/destructive/external gate だけは
  preflight から外さない。

### P1-3. outcome telemetry を receipt に追加

- 変更: workflow variant、decision count、reads/searches、rework cycles、
  defects found before runtime、runtime failures、flake reruns、blocked reasons を記録。
  短い capsule と現行全文 workflow を複数 task で比較する。
- 期待影響: 高。品質向上が「感じられない」を検証可能にする。
- effort: 中。risk: 低。生産性目標にはせず、repository history 内比較に限定。

### P2-1. adapter boilerplate を生成時共有化

- 変更: 9 skill adapters の共通 8 directives を 1 loader/capsule に集約。
- 期待影響: 中（保守性は高、session token 効果は skill loader 次第）。
- effort: 低。risk: 低。

### P2-2. patch/evidence reference を優先

- 変更: full-file `Write` と大きい old/new `StrReplace` を避け、line-bounded patch、
  artifact path、revision、digest を使う。subagent return は conclusion/evidence/
  unresolved に制限する。
- 期待影響: 中。今回の Write + StrReplace 137,811 input characters を削減可能。
- effort: 低〜中。risk: 低。

### gate policy に関する注意

`gates: all` を一律に `minimal` へ変えるのは token 削減にはなるが、
外部 AI、credentials、production 相当 E2E の安全性を落とす。先に
state adapter と phase capsule を実装し、その後 R0/R1 のみ自動継続する
`risk-based` を評価する。expected impact は中、effort 低、risk は高。

## 9. measured facts と inference の境界

**Measured facts:** 本報告の event/character/byte/tool/read/path/search/term count、
workflow file character count、report の PASS/BLOCKED、明示された phase/gate 数。

**Estimates / inference:** 79,780 characters が実際に一度の model input へ
全量入ること、37 broad searches のうち不要な割合、長い設計文が品質へ与えた効果、
改善案の expected impact。これらは token usage として扱わない。

## 10. encoding・変更範囲

- report は作成前には存在しなかった。
- 親 task の `prd.md`（514 bytes）と `task.json`（726 bytes）を byte read 後に
  UTF-8 strict decode し、両方 `UTF-8 valid / BOMなし` を確認した。
- 本 report も UTF-8 / BOMなしで作成済み。
- `.env` は読み出し・変更しておらず、秘密値を記載していない。
- product/source、suite、task context、spec、testing report は変更していない。
- **変更ファイルは本ファイル 1 件のみ**:
  `.trellis/tasks/09-06-sr-workflow-token-efficiency/research/session-token-quality-audit.md`
- commit は行っていない。
