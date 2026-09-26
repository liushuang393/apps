# SR workflow token efficiency — technical design

## 1. 境界

変更対象は次だけとする。

```text
/home/liush/projects/serverlessAIAgents/tools/sr-dev-workflow-suite/
  core/
  evals/
  scripts/
  tests/
  registry.json
  VERSION
  README.md / AUDIT.md（必要な契約説明のみ）
```

LAMS の `.agents` は比較対象であり、書き込み対象ではない。検証用生成物は
一時 directory に install する。

## 2. 現行データフロー

```text
registry.json
  -> install.py skill_body()
  -> host adapter
  -> local/project.md 全文
  -> contract + method-router + artifact-map + approval-gate
  -> canonical workflow 全文
  -> phase companion
```

固定 phase の `sr-plan/build/verify` でも `basic-development.md` 全文を読む。
router も write／gate 用文書を読む。specialized workflow は最初から
`closeout.md` を読む。

## 3. 変更後データフロー

```text
registry.json
  -> install.py dependency profile
  -> host adapter
  -> local/project.md
  -> entrypoint に必要な base common のみ
  -> phase view または specialized workflow
  -> phase-selected / triggered module
```

### 3.1 Registry dependency profile

registry entry に次の宣言を持たせる。

- `workflow`: 実際に読む phase-specific／specialized workflow
- `phase`: 既存互換の固定 phase
- `base_common`: adapter が常時読む common module の論理名

router は `contract` と `method-router` のみ。変更 workflow は原則
`contract`、`method-router`、`artifact-map`、`approval-gate`。
workflow 本文側では同じ base common の再読指示を削除する。

### 3.2 Basic workflow phase split

`basic-development.md` を shared preamble と3 phase viewへ分離する。

```text
basic-common.md
basic-plan.md
basic-build.md
basic-verify.md
```

registry は各 entrypoint を対応 view に直接向ける。共通 artifact 名や
approval invalidation は `basic-common.md` へ置き、各 view は自 phase の
手順と companion だけを持つ。手書き drift を防ぐため、cross-reference と
critical invariant を test する。

### 3.3 Conditional interaction module

`contract.md` の out-of-band／resume／human decision 詳細を
`interaction.md` へ移す。`contract.md` には trigger と fail-safe invariant を残す。

```text
質問・割込み・scope correction・stop/switch が発生
  -> interaction.md を読む
通常 phase
  -> 読まない
```

### 3.4 Deferred closeout

workflow 冒頭の `closeout.md` 参照を削除し、最終 phase の step からのみ参照する。
final receipt／guard の順序は変更しない。

### 3.5 Retry circuit breaker

`contract.md` に短い共通 invariant を置き、詳細は既存 workflow の該当 stepへ
最小限追加する。

- failure signature（command／exit／主要 error）を記録
- 同じ signature は新 evidence 無しで最大2回
- 3回目の同一試行は禁止し、fallback／blocker／human actionへ遷移
- signature が変わる、または新 evidence がある場合だけ budget を再開

### 3.6 Bounded dispatch manifest

`dispatch.md` の入力契約を、最初の discovery が返す manifest に統一する。

```text
revision
scope/path list
evidence refs
already-read hashes
unresolved
stop boundary
```

後続 agent は manifest の path だけを読み、追加探索は unresolved を閉じる場合に限定する。

## 4. 測定

`scripts/sr_context_budget.py` を追加する。

- source tree または installed `--home` を入力
- registry と明示 reference を解析
- entrypoint ごとに strict／phase-required／triggered の bytes、chars、linesを出力
- `estimated_tokens = ceil(bytes / 4)` は `estimate_method` とともに出力
- `--json` を提供
- budget baseline を test fixture として保持し、閾値超過を fail させる

host usage metadata は suite が取得できないため、自動取得しない。receipt の既存
optional measurement 契約を保ち、公開されない値は `absent` とする。

## 5. 品質保護

### 自動テスト

- registry 全 entrypoint と workflow file の reachability
- adapter dependency profile snapshot
- critical invariant golden test
- phase view に他 phase の実行 step が混入しない
- final phase だけ closeout／receipt／guard を要求
- router が artifact write／approval gate を要求しない
- context budget before/after threshold
- install／reinstall／local preservation／ablate restore／custom home

### Instruction eval

`evals/token-efficiency.md` に次を追加する。

1. 通常 phase は interaction 詳細を読まない
2. scope correction／stop は interaction を読む
3. 同一 environment error 2回後に circuit break
4. 新 evidence があれば別 hypothesis を許可
5. sub-agent は manifest 外を再探索しない
6. usage metadata 欠落を 0 としない

## 6. 互換性と rollout

- entrypoint／alias は不変。
- managed core／adapter は次回 installer 実行で置換される。
- local files は従来どおり never-overwrite。
- LAMS には本作業で installer を実行しない。検証は throwaway repository で行う。
- source version を minor 更新し、AUDIT に before/after と非採用案を記録する。

## 7. Rollback

原始 suite の変更ファイルだけを revert すれば戻せる。LAMS 生成物は未変更なので
rollback 不要。throwaway install は一時 directory ごと削除する。

## 8. 採用しない案

- gate を削る／`minimal` を既定化: 安全性低下が token削減を上回る。
- local project brief 自動移行: repository-owned file を installer が再編集するため危険。
- Trellis／host todo の統合: Trellis 内部依存となり suite の portability 契約に反する。
- 実 token／cost の推定記録: host metadata 不在時の偽計測になる。
