# SR workflow token efficiency audit

## 目的

`/home/liush/projects/serverlessAIAgents/tools/sr-dev-workflow-suite` が生成する
`.agents` ワークフローについて、品質に寄与しないコンテキスト反復を測定可能にし、
安全性・承認・証拠・Trellis lifecycle の保証を維持したまま、原始スイート側で
トークン効率を改善する。

## 背景と確認済み事実

- 対象は suite v5.2.0、9 entrypoint／7 canonical workflow。
- 生成済みワークフローの常時参照閉包は約 10,902–13,768 tokens 相当、
  最大閉包は `sr-plan` 約 29,879 tokens 相当（UTF-8 bytes / 4 の比較用概算）。
- 最大の常時負担は `contract.md`、`local/project.md`、`artifact-map.md`、
  `method-router.md`、早期の `closeout.md`、3 phase が共有する
  `basic-development.md` 全文である。
- 監査した実セッションには host の token/cache/cost metadata がなく、
  実請求 token は測定不能。代理指標では 742 tool calls、303 reads、
  同一 path 再読 117 回、broad search 37 回だった。
- 今回の E2E 改善は SR workflow を実行せず達成されており、SR 文書量と品質改善の
  因果は確認できない。短い「実行→失敗分類→局所修正→再実行」が成果に直結した。
- 原始 suite を含む上位 repository には既存の未コミット変更があるが、対象
  `tools/sr-dev-workflow-suite` 以外は本作業の範囲外である。

## 要件

### R1. 変更境界

- 原始スイート `tools/sr-dev-workflow-suite` のみを変更する。
- LAMS の生成済み `.agents`、`.cursor`、`.claude` は直接変更しない。
- `.env`、アプリケーションコード、Trellis 本体、上位 repository の別領域を変更しない。

### R2. 測定可能性

- workflow／phase ごとの静的 prompt surface を再現可能に測定できること。
- bytes、characters、lines、`ceil(bytes/4)` の比較用 token estimate を出力し、
  estimate を実測 token と表示しないこと。
- host が usage を公開しない場合は `absent` と扱い、ゼロや推定 cost を実測値として
  receipt に書かないこと。

### R3. コンテキスト削減

- `sr-plan`／`sr-build`／`sr-verify` は、その invocation に不要な別 phase 本文を
  常時読まない構造にする。
- router は分類・推奨・停止に不要な artifact／gate 文書を常時読まない。
- interruption／mid-phase decision の詳細は必要時のみ読む。
- closeout の詳細は最終 phase でのみ読む。
- 同じ read 指示を adapter と canonical workflow の両方で重複させない。

### R4. 実行時浪費の抑制

- 同一 failure signature の環境調査を、新しい証拠なしに反復しない。
- 2 回失敗したら blocker を記録し、既知 fallback または人間に必要な action へ移る。
- sub-agent dispatch は最初に bounded evidence manifest を作り、後続 agent へ
  path／revision／unresolved を渡して重複探索を減らす。

### R5. 品質保証

- Trellis を唯一の lifecycle authority とする。
- human approval、scope invalidation、R2/R3 security trigger、prohibited actions、
  evidence truthfulness、independent reviewer、RED-before-GREEN、final guard、
  module design disposition を削除・弱体化しない。
- source と phase view の drift をテストで検出する。
- 既存 166 test functions と 36 manual eval scenarios の意図を維持し、
  token効率に対する自動テスト／eval を追加する。

### R6. 互換性

- registry の 9 entrypoint 名、host alias、既存 invocation 方式を維持する。
- installer の idempotency、local never-overwrite、ablate/restore、doctor、
  custom `--home` を維持する。
- 変更後の再インストールで生成済み managed core／adapter が更新されるが、
  repository-owned local binding は上書きされないこと。

## 受入条件

- [ ] AC1: 静的 budget command が全 9 entrypoint の phase-aware surface を
  text／JSON で再現し、実測と estimate を区別する。
- [ ] AC2: `sr-plan`／`sr-build`／`sr-verify` の各 strict closure が現状比で減り、
  3 invocation 合計で少なくとも 15,000 bytes 削減される。
- [ ] AC3: `sr-route` の strict closure が少なくとも 6,000 bytes 削減され、
  classify→recommend→stop／no-write を維持する。
- [ ] AC4: specialized workflow の非最終 phase で `closeout.md` を常時要求しない。
- [ ] AC5: interruption／decision 詳細は on-demand module へ移り、scope-change、
  stop/resume、question-vs-approval の保証を eval が検証する。
- [ ] AC6: 同一 failure signature 2 回の circuit breaker と bounded dispatch
  manifest のルールを eval が検証する。
- [ ] AC7: installer／registry／guard／readiness／template の全自動テストが合格する。
- [ ] AC8: instruction eval 36件の既存ケースを保持し、追加 token-efficiency eval と
  critical-invariant golden test が合格する。
- [ ] AC9: throwaway repository への install／doctor／reinstall／ablate→restore が
  合格し、custom local binding が保持される。
- [ ] AC10: LAMS の `.agents` を直接変更せず、原始スイートからの更新手順と
  before/after budget report を提示する。

## 対象外

- Cursor／Claude／Codex が公開しない token usage の推測請求額。
- gate policy を一律 `minimal` に変更すること。
- Trellis 内部実装や host の hidden context／dynamic tool catalog の変更。
- LAMS アプリケーションの追加修正。
- repository-owned `local/project.md` section 11 の自動分割・破壊的移行。
