# SR workflow token efficiency — implementation plan

## Stage 1: Baseline と回帰テスト

**Goal**: 現状の prompt surface と重要保証を executable baseline にする。  
**Success Criteria**: 9 entrypoint の baseline JSON と critical-invariant test が赤になる。  
**Tasks**:

- target file の UTF-8／BOM を編集前に確認
- `scripts/sr_context_budget.py` のテストを先に追加
- adapter dependency／phase isolation／closeout timing の赤テストを追加
- `evals/token-efficiency.md` の6ケースを追加

**Tests**:

```bash
python3 -m pytest tests/test_context_budget.py tests/test_registry.py tests/test_install.py
```

**Status**: 完了

## Stage 2: Phase-aware loading

**Goal**: 不要な常時文書読込を構造的に除く。  
**Success Criteria**: AC2–AC5 を満たし、critical invariants が緑。  
**Tasks**:

- registry に `base_common` を追加
- `skill_body()` を dependency profile 対応
- basic workflow を common + PLAN/BUILD/VERIFY に分割
- `interaction.md` を追加し contract を短縮
- specialized workflow の closeout を最終 phaseへ遅延
- adapter／workflow の重複 read 指示を削除

**Tests**:

```bash
python3 -m pytest tests/test_registry.py tests/test_install.py tests/test_context_budget.py
```

**Rollback point**: registry／adapter の生成差分が想定外なら Stage 1 baselineへ戻す。

**Status**: 完了

## Stage 3: Runtime-loop efficiency

**Goal**: 実セッションで観測された retry／重複探索を抑える。  
**Success Criteria**: AC6 の eval／golden test が緑。  
**Tasks**:

- failure-signature 2-attempt circuit breaker を contract／該当 workflow に追加
- `dispatch.md` に bounded evidence manifest と再探索条件を追加
- E2E／investigate の runtime-first、fallback／blocked 分類を明示

**Tests**:

```bash
python3 -m pytest tests/test_registry.py tests/test_context_budget.py
```

**Status**: 完了

## Stage 4: Full regression と throwaway install

**Goal**: token削減が installer／guard／readiness の品質を壊していないことを証明する。  
**Success Criteria**: AC7–AC9、before/after budget report。  
**Tasks**:

- 隔離 venv または既存環境で全 pytest
- throwaway repository へ全 host install／doctor
- reinstall idempotency、custom local preservation、ablate→restore
- context budget text／JSONを保存し閾値を確認
- manual eval 既存36 + 新規6をレビュー

**Tests**:

```bash
python3 -m pytest
python3 scripts/install.py --repo <tmp-repo> --hosts cursor,codex
python3 scripts/install.py --repo <tmp-repo> --doctor
python3 scripts/sr_context_budget.py --source . --json
```

**Status**: 完了

## Stage 5: Documentation と handoff

**Goal**: 原始 source だけの変更と更新手順を明確にする。  
**Success Criteria**: AC10、source diff review、LAMS `.agents` が未変更。  
**Tasks**:

- VERSION／README／AUDIT を更新
- 変更前後の token estimate と品質保証表を記録
- LAMS へ適用する将来の installer command を提示（この作業では実行しない）
- 対象 directory 外の既存変更を分離して報告

**Tests**:

```bash
git diff -- tools/sr-dev-workflow-suite
git status --short -- <LAMS>/.agents <LAMS>/.cursor <LAMS>/.claude
```

**Status**: 完了

## Review gates

1. 本計画のユーザー承認後に `task.py start`
2. Stage 2 完了後に budget と invariant の中間レビュー
3. 全テスト後に独立 check agent

## Risky files

- `scripts/install.py`
- `registry.json`
- `core/common/contract.md`
- `core/workflows/*.md`

これらは entrypoint 全体へ波及するため、変更ごとに生成 snapshot と full test を行う。


## Implementation result (2026-09-06)

- RED: token-efficiency 回帰テスト10件が未実装状態で全て失敗することを確認。
- GREEN: implement run は full pytest `187 passed`、独立 check 後は
  `192 passed`。Ruff `All checks passed`。
- Throwaway: custom `.agents/sr` へ Cursor+Codex 78 files を install、
  reinstall は 0 writes / 78 kept、doctor は 0 errors、budget は 9 entrypoints。
  ablate / restore は 79 files を byte-preserving 復元し custom local sentinel を保持。
  別 repository の Claude 60 files install / doctor も 0 errors。
- Static strict budget (UTF-8 bytes, parentheses are `ceil(bytes/4)` estimates):
  - `sr-plan`: 49,932 (12,483) -> 34,637 (8,660)
  - `sr-build`: 49,933 (12,484) -> 34,555 (8,639)
  - `sr-verify`: 49,945 (12,487) -> 33,483 (8,371)
  - three-phase total: 149,810 -> 102,675 bytes (-47,135)
- `sr-route`: 38,448 (9,612) -> 26,264 (6,566), -12,184 bytes
- Host measured token/cost metadata: `absent`; estimate を実測値として記録していない。
- LAMS `.agents` / `.cursor` / `.claude`: `git status --short -- ...` は空で、直接変更なし。
- Independent check: budget parser の phase 誤認、adapter/profile drift の黙認、
  installed entrypoint 欠落の黙認、router の task mutation 曖昧性を修正し、
  registry alias、managed legacy workflow 除去、各 phase 個別削減を回帰テストで固定。
- Remaining verification boundary: 新規 instruction eval 6件は仕様ケースとして追加済み。
  manual eval の実モデル実行は未実施。
- Commit blocker: ユーザー承認後に原始 repository で2回 commit を試行したが、
  sandbox が `/home/liush/projects/serverlessAIAgents/.git/index.lock` の作成を
  `Permission denied` で拒否した。staged path は0、無関係変更は未stageのまま。
  実行待ち command:
  `git add -- tools/sr-dev-workflow-suite && git commit -m "feat(sr-suite): reduce phase context overhead"`
