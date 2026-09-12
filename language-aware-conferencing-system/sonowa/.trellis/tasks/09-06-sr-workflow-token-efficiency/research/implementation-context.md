# SR token efficiency — implementation context

## Baseline

- Suite: `/home/liush/projects/serverlessAIAgents/tools/sr-dev-workflow-suite` v5.2.0
- 9 entrypoints／7 canonical workflows
- strict closure: 43,608–55,072 bytes（約10,902–13,768 tokens）
- 最大 union: `sr-plan` 119,514 bytes（約29,879 tokens）
- estimate: `ceil(UTF-8 bytes / 4)`。請求token実測ではない。
- generated 73 files中72 byte一致。差分はrepository-owned
  `.agents/local/project.md`のみ。

## 最大負担

- `contract.md`: 14,164 bytes × 9
- `local/project.md`: 13,404 bytes × 9
- `artifact-map.md`: 6,263 bytes × 9
- `method-router.md`: 4,429 bytes × 9
- `closeout.md`: 4,541 bytes × 7（非finalでも常時）
- `basic-development.md`: 9,554 bytes × 3 fixed phase

## 採用する削減

1. `contract.md` の interruption／decision 詳細を on-demand `interaction.md` へ分離。
2. `basic-development` を shared common + PLAN/BUILD/VERIFY viewへ分割。
3. specialized workflow の `closeout.md` を final phaseまで遅延。
4. router adapter から不要な `artifact-map`／`approval-gate` 常時読込を外す。
5. adapterとworkflowのbase common重複指示を除く。
6. static context budget tool／JSON出力／threshold testを追加。

## 実セッションからの改善

- 6 JSONLに実token metadataなし。
- 742 tool calls、303 reads、同一path再読117、broad search 37。
- Docker接続調査は初期13 callsでも未解決。
- 品質向上は短い runtime loop と相関。SR invocationは0で因果なし。
- 同じ failure signature は新証拠なしに2回まで。以後fallback／blocked。
- dispatchはrevision／paths／evidence／hash／unresolved／stop boundaryを共有する。

## 必ず維持する保証

- Trellisが唯一のlifecycle authority
- required human approvalとapproval invalidation
- R2/R3 security trigger、prohibited/external/destructive action
- evidence truthfulness、not-runの正直な記録
- Author/Reviewer独立
- acceptance criterion↔task、RED before GREEN
- final receipt／guard／module design disposition
- installer idempotency、local never-overwrite、ablate/restore、custom home

## 対象外

- LAMSの`.agents`直接編集
- gate policyの弱体化
- local project briefの自動移行
- host非公開token/costの推測
- Trellis内部またはhost hidden contextの変更

詳細:

- `research/dependency-token-audit.md`
- `research/session-token-quality-audit.md`
