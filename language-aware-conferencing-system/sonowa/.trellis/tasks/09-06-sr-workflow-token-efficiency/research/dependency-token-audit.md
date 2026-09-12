# SR workflow dependency / token audit

調査日: 2026-09-06  
対象 suite version: `5.2.0`  
Workspace: `/mnt/d/apps/language-aware-conferencing-system/lams-mvp`  
Original suite: `/home/liush/projects/serverlessAIAgents/tools/sr-dev-workflow-suite`  
Generated installation home: `/mnt/d/apps/language-aware-conferencing-system/lams-mvp/.agents`

## Executive summary

- `registry.json` の母集団は **9 entrypoints**、参照される canonical workflow は
  **7 files** である。`sr-plan` / `sr-build` / `sr-verify` が
  `basic-development.md` を phase 違いで共有する。
- Codex host adapter の厳密な常時閉包は、adapter、project binding、
  `local/methods/README.md`、4 common files、canonical workflow の8ファイルである。
  `basic-development` と4 specialized change workflows は workflow 先頭で
  `closeout.md` も無条件に読むため9ファイルになる。
- generated installation の常時閉包は **43,608–55,072 bytes
  (10,902–13,768 tokens)**。phase/条件付き SR-local content を全部加えた最大閉包は
  **`sr-plan`: 119,514 bytes / 115,235 Unicode characters / 2,434 lines /
  29,879 approximate tokens** である。
- 現在の12 specすべてを同時に relevant と仮定したストレス上限は
  `sr-plan` **155,965 bytes / 151,572 characters / 3,547 lines /
  38,992 tokens**。通常は relevant spec だけを読むため、これは実測常用値ではない。
- 最大の反復負担は `.agents/core/common/contract.md`:
  **14,164 bytes × 9 entrypoints = 127,476 total loaded bytes
  (31,869 tokens相当)**。1回分を残した重複超過は
  **113,312 bytes / 28,328 tokens**。次点は `.agents/local/project.md` の
  120,636 total loaded bytes。
- Original の `install.collect(src, ["cursor", "codex"], ".agents")` は73ファイルを
  期待し、manifestも73パスで missing/extraは0。**72/73がbyte完全一致**し、唯一の差分は
  repository-owned `.agents/local/project.md` である
  (expected 8,698 bytes、actual 13,404 bytes、`+4,706`)。
  `${SR_HOME}` を `.agents` にrenderしたcoreは **29/29 byte一致**した。
- 最大の単独削減候補は、`contract.md` の interruption/decision guidance
  5,787 bytesを条件付きmoduleへ分離する案。9 entrypointsを1回ずつ呼ぶ比較で、
  150-byte pointerを差し引いた **net 50,733 bytes / 約12,684 tokens**。
- 相互に重ならない5候補の保守的portfolioは **net 111,358 bytes /
  約27,840 tokens**（各entrypointを1回呼ぶ比較）。これは品質保証を削る案ではなく、
  同一governanceを必要時だけ読む構造化候補である。
- Tests はAST静的集計で **166 test functions**、instruction evalsは
  **36 scenarios**。この環境では `pytest` packageがなく、test suite自体は未実行。

## Scope & workflow census

### 母集団の定義

母集団は Original の `registry.json` の全keyとした。READMEに登場する呼称や
Trellis自身のskillsはSR workflow数に含めない。host別adapterは同じentrypointの
別表現であり、workflow数を二重計上しない。

| Entrypoint | Canonical workflow | Fixed phase | Cursor alias |
|---|---|---:|---|
| `sr-route` | `router.md` | — | `sr` |
| `sr-plan` | `basic-development.md` | `PLAN` | `sr_plan` |
| `sr-build` | `basic-development.md` | `BUILD` | `sr_build` |
| `sr-verify` | `basic-development.md` | `VERIFY` | `sr_verify` |
| `sr-refactor` | `refactor.md` | current/multi | `sr_refactor` |
| `sr-bug` | `bug-repair.md` | current/multi | `sr_bug` |
| `sr-scan` | `quality-security.md` | current/multi | `sr_scan` |
| `sr-e2e` | `e2e.md` | current/multi | `sr_e2e` |
| `sr-investigate` | `investigate.md` | current/multi | `sr_investigate` |

Canonical 7 files:

1. `core/workflows/router.md`
2. `core/workflows/basic-development.md`
3. `core/workflows/refactor.md`
4. `core/workflows/bug-repair.md`
5. `core/workflows/quality-security.md`
6. `core/workflows/e2e.md`
7. `core/workflows/investigate.md`

`tests/test_registry.py` は「全registry entryが実在workflowを指す」と
「disk上の全workflowがregistryからreachable」を別々に保証する。

## Dependency model

### 実際の生成・注入経路

1. `scripts/install.py:collect()` が `registry.json` を読む。
2. `skill_body()` が各entrypointのthin adapterへ次の順を生成する:
   nearest `${SR_HOME}/core/`、`local/project.md`、`contract.md`、
   `method-router.md`、`artifact-map.md`、`approval-gate.md`、workflow。
3. `phase` がある3 entrypointsは「そのsectionだけ実行」、ないentrypointは
   current phase/stateから進み各human gateで停止する。
4. workflow先頭の `Read ...` は無条件依存、`Per phase:` はphase-selected依存。
5. `contract.md` の companion table は明示的に “Read the ones the current phase
   needs; they are not all needed at once.” とするため、表内全fileを常時閉包へ
   展開してはならない。
6. `method-router.md` は `local/methods/` を読むよう指示する。directory index
   (`README.md`) は常時側、`python.md` / `typescript.md` は対象言語に応じる
   条件付き側とした。hostがdirectory readを全file注入と解釈する可能性は後述する。
7. `${SR_HOME}/local/checks/*.md` はcheck列挙・実行時に読む条件付きcontent。
8. `sr_guard.py` / `sr_readiness.py` は通常「実行」され、source全文をpromptへ
   読む指示ではない。従ってfile metricsには含めるがtoken closureから除外した。
   command output、task/design artifacts、raw repository sourceも量がrun依存なので
   bounded SR closureから除外した。

### Strict always base

`B(entrypoint)` は以下の8ファイル:

- `.agents/skills/<entrypoint>/SKILL.md`
- `.agents/local/project.md`
- `.agents/local/methods/README.md`
- `.agents/core/common/contract.md`
- `.agents/core/common/method-router.md`
- `.agents/core/common/artifact-map.md`
- `.agents/core/common/approval-gate.md`
- `.agents/core/workflows/<registry workflow>`

さらに `basic-development.md`、`refactor.md`、`bug-repair.md`,
`quality-security.md`, `e2e.md` は先頭で `closeout.md` も読む。
このため `sr-plan/build/verify/refactor/bug/scan/e2e` は `B + closeout`。

### Edge classification

- **A (always)**: adapterまたはworkflow先頭が無条件 `Read`。
- **P (phase-selected)**: `Per phase` により、fixed phase entrypointでは決定的、
  multi/current workflowでは現在phase次第。
- **T (triggered)**: “if”, “when relevant”, sub-agent利用、対象言語、check種別、
  relevant spec等による。
- **X (executed, not injected)**: runtime script source。実行結果だけがcontextへ戻る。

## Methodology

### Context/spec

workspace rootで実行:

```text
python3 ./.trellis/scripts/get_context.py --mode packages
```

結果:

```text
Single-repo project (no packages configured)

Spec layers: backend, frontend
```

調査したspecは次の12件（全件UTF-8）:

- `.trellis/spec/backend/index.md`
- `.trellis/spec/backend/transport-adapter.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/hook-guidelines.md`
- `.trellis/spec/frontend/type-safety.md`
- `.trellis/spec/frontend/directory-structure.md`
- `.trellis/spec/guides/index.md`
- `.trellis/spec/guides/code-reuse-thinking-guide.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`

このauditに直接関係するのは guides のreuse/cross-layer、generated-runtime整合、
backend/frontend layer情報である。frontendの6詳細specは大半が未記入templateで、
workflow token governanceの正本とはみなしていない。

### Encoding

編集前に Original、`.agents`、`.cursor/skills`、`.cursor/commands`、
`.trellis/spec` の対象拡張子をPython UTF-8 strict decodeで走査した。
**255 files、decode errors 0、UTF-8 BOM 0**。本report新規作成前には対象fileが
存在しないことも確認した。

### Size/token formula

- bytes: `len(path.read_bytes())`
- Unicode characters: `len(data.decode("utf-8"))`
- lines: `len(text.splitlines())`
- approximate tokens: `ceil(bytes / 4)`
- hash: `sha256(raw bytes)`
- closure metrics: 重複pathを1回だけ数え、結合bytesに対して `ceil(total_bytes/4)`

`tiktoken`, `tokenizers`, SentencePiece等の実tokenizer libraryは利用環境にない。
よって再現可能性を優先してbytes/4を採用した。日本語・Markdown表・codeでは
実model tokenizerとの差が大きくなり得るため、この値は請求token実測ではなく
比較用近似値である。

## Per-file metrics

列は `bytes / Unicode chars / lines / ceil(bytes/4) / SHA-256 prefix`。

### Generated core（29 files）

| Path | Bytes | Chars | Lines | Tokens | SHA-256 |
|---|---:|---:|---:|---:|---|
| `.agents/core/common/anti-fake.md` | 2,663 | 2,659 | 64 | 666 | `0ba0a8faf7e2` |
| `.agents/core/common/approval-gate.md` | 1,070 | 1,060 | 45 | 268 | `210c772ef06a` |
| `.agents/core/common/artifact-map.md` | 6,263 | 6,257 | 95 | 1,566 | `19e13d962edb` |
| `.agents/core/common/change-envelope.md` | 9,195 | 9,183 | 196 | 2,299 | `01f073064fc9` |
| `.agents/core/common/closeout.md` | 4,541 | 4,541 | 71 | 1,136 | `b44afa42dc98` |
| `.agents/core/common/contract.md` | 14,164 | 14,142 | 248 | 3,541 | `2a212268f210` |
| `.agents/core/common/decomposition.md` | 2,049 | 2,041 | 59 | 513 | `b2e5ec71297d` |
| `.agents/core/common/design-artifacts.md` | 3,645 | 3,631 | 72 | 912 | `5c4262b74e9` |
| `.agents/core/common/dispatch.md` | 2,664 | 2,662 | 65 | 666 | `930d2c07c534` |
| `.agents/core/common/guard.md` | 5,791 | 5,771 | 85 | 1,448 | `56c8cd8244b4` |
| `.agents/core/common/impact.md` | 6,123 | 6,111 | 148 | 1,531 | `baf85c162503` |
| `.agents/core/common/method-router.md` | 4,429 | 4,413 | 74 | 1,108 | `a67f24a89736` |
| `.agents/core/common/readiness.md` | 13,912 | 13,841 | 244 | 3,478 | `49f0c40eb35f` |
| `.agents/core/common/receipt.md` | 6,533 | 6,507 | 158 | 1,634 | `e81fcd019450` |
| `.agents/core/common/requirement-interaction.md` | 2,201 | 2,195 | 50 | 551 | `bd15b2f80c29` |
| `.agents/core/common/review.md` | 6,707 | 6,693 | 132 | 1,677 | `69bf5d802534` |
| `.agents/core/common/test-evidence.md` | 12,551 | 12,513 | 224 | 3,138 | `96432592ce8a` |
| `.agents/core/common/zones.md` | 2,924 | 2,914 | 65 | 731 | `33d28c386dfa` |
| `.agents/core/templates/README.md` | 1,446 | 1,442 | 36 | 362 | `0d8a1b161326` |
| `.agents/core/templates/jp-si/00-requirements.md` | 1,363 | 849 | 55 | 341 | `b76fe26f5fee` |
| `.agents/core/templates/jp-si/01-basic-design.md` | 2,389 | 1,473 | 106 | 598 | `8e5695814e32` |
| `.agents/core/templates/jp-si/02-detailed-design.md` | 2,951 | 1,889 | 102 | 738 | `75ad836a3175` |
| `.agents/core/workflows/basic-development.md` | 9,554 | 9,534 | 127 | 2,389 | `c6cbe0aa9c1e` |
| `.agents/core/workflows/bug-repair.md` | 4,421 | 4,419 | 64 | 1,106 | `fcebdb66a00b` |
| `.agents/core/workflows/e2e.md` | 4,447 | 4,437 | 55 | 1,112 | `a61f88df0f7e` |
| `.agents/core/workflows/investigate.md` | 8,208 | 8,182 | 123 | 2,052 | `9a51ad996f1d` |
| `.agents/core/workflows/quality-security.md` | 3,942 | 3,938 | 50 | 986 | `ac990f21d0b2` |
| `.agents/core/workflows/refactor.md` | 5,745 | 5,725 | 59 | 1,437 | `eb958d72834f` |
| `.agents/core/workflows/router.md` | 2,670 | 2,662 | 63 | 668 | `65e1adfbb458` |

### Generated local/runtime

| Path | Bytes | Chars | Lines | Tokens | SHA-256 |
|---|---:|---:|---:|---:|---|
| `.agents/local/checks/README.md` | 1,429 | 1,425 | 38 | 358 | `8d3328b08a89` |
| `.agents/local/checks/build.md` | 204 | 204 | 8 | 51 | `e13d8ac8d802` |
| `.agents/local/checks/format.md` | 185 | 185 | 8 | 47 | `d833f0ddd760` |
| `.agents/local/checks/lint.md` | 251 | 251 | 8 | 63 | `d377bb884c61` |
| `.agents/local/checks/types.md` | 237 | 237 | 8 | 60 | `def03d9bd0f6` |
| `.agents/local/checks/unit.md` | 186 | 186 | 8 | 47 | `2ec3d9288c2d` |
| `.agents/local/methods/README.md` | 569 | 567 | 13 | 143 | `5e2db30c357e` |
| `.agents/local/methods/python.md` | 715 | 437 | 11 | 179 | `c25d40200154` |
| `.agents/local/methods/typescript.md` | 710 | 452 | 11 | 178 | `f71683bc214b` |
| `.agents/local/project.example.md` | 3,067 | 3,059 | 82 | 767 | `4d82e7b3829d` |
| `.agents/local/project.md` | 13,404 | 12,402 | 289 | 3,351 | `87a30922e1ed` |
| `.agents/local/templates/README.md` | 444 | 442 | 11 | 111 | `0ee053672104` |
| `.agents/local/zones/README.md` | 639 | 635 | 13 | 160 | `0f5d6418a7aa` |
| `.agents/runtime/sr_guard.py` | 27,492 | 27,460 | 622 | 6,873 | `f829e587ce97` |
| `.agents/runtime/sr_readiness.py` | 21,777 | 21,757 | 577 | 5,445 | `92dd6b0d43a2` |

`runtime` 2件はX（実行依存）。`project.example.md` と各READMEのうち
参照されないものはinstall/doctor資産で、通常workflow closureには入らない。

### Host adapters

| Path group | Individual bytes (entrypoint順) | Total bytes | Token role |
|---|---|---:|---|
| `.agents/skills/sr-*/SKILL.md` | route 1,039; plan 1,065; build 1,066; verify 1,078; refactor 1,079; bug 1,059; scan 1,050; e2e 1,044; investigate 1,090 | 9,570 | Codex実行時に該当1件 |
| `.cursor/skills/sr-*/SKILL.md` | route 1,070; plan 1,096; build 1,097; verify 1,109; refactor 1,110; bug 1,090; scan 1,081; e2e 1,075; investigate 1,121 | 9,849 | Cursor実行時に該当1件 |
| `.cursor/commands/sr*.md` | sr 370; plan 396; build 396; verify 407; refactor 405; bug 388; scan 372; e2e 380; investigate 410 | 3,524 | command alias; skillへ委譲 |

Codex各`agents/openai.yaml`はdiscovery metadataでありworkflow本文ではない。
9ファイルの合計2,186 bytesで、各default promptは該当skillを選ぶだけである。

### Original source metrics

Raw Original は`${SR_HOME}` placeholderを保持するため、render後とはbytes/hashが
異なる。主要生成入力を全件列挙する。

| Original path | Bytes | Chars | Lines | Tokens | SHA-256 |
|---|---:|---:|---:|---:|---|
| `core/common/anti-fake.md` | 2,663 | 2,659 | 64 | 666 | `0ba0a8faf7e2` |
| `core/common/approval-gate.md` | 1,076 | 1,066 | 45 | 269 | `28a158a6c7df` |
| `core/common/artifact-map.md` | 6,278 | 6,272 | 95 | 1,570 | `e719419bdca1` |
| `core/common/change-envelope.md` | 9,204 | 9,192 | 196 | 2,301 | `e220559a3039` |
| `core/common/closeout.md` | 4,553 | 4,553 | 71 | 1,139 | `49228c89a970` |
| `core/common/contract.md` | 14,173 | 14,151 | 248 | 3,544 | `75c9ba32ebdc` |
| `core/common/decomposition.md` | 2,049 | 2,041 | 59 | 513 | `b2e5ec71297d` |
| `core/common/design-artifacts.md` | 3,657 | 3,643 | 72 | 915 | `6dd0b7f9e000` |
| `core/common/dispatch.md` | 2,664 | 2,662 | 65 | 666 | `930d2c07c534` |
| `core/common/guard.md` | 5,803 | 5,783 | 85 | 1,451 | `36332e1c9f94` |
| `core/common/impact.md` | 6,129 | 6,117 | 148 | 1,533 | `d6cb676bda8c` |
| `core/common/method-router.md` | 4,438 | 4,422 | 74 | 1,110 | `a0d19e5f47ae` |
| `core/common/readiness.md` | 13,933 | 13,862 | 244 | 3,484 | `b861581f6be0` |
| `core/common/receipt.md` | 6,542 | 6,516 | 158 | 1,636 | `c2d227de792a` |
| `core/common/requirement-interaction.md` | 2,201 | 2,195 | 50 | 551 | `bd15b2f80c29` |
| `core/common/review.md` | 6,716 | 6,702 | 132 | 1,679 | `ffeb09bb0b35` |
| `core/common/test-evidence.md` | 12,569 | 12,531 | 224 | 3,143 | `a9c4367ddebc` |
| `core/common/zones.md` | 2,927 | 2,917 | 65 | 732 | `2bc01c77d7a3` |
| `core/templates/README.md` | 1,455 | 1,451 | 36 | 364 | `5a783c9d8d2a` |
| `core/templates/jp-si/00-requirements.md` | 1,363 | 849 | 55 | 341 | `b76fe26f5fee` |
| `core/templates/jp-si/01-basic-design.md` | 2,392 | 1,476 | 106 | 598 | `8e4280f99b3f` |
| `core/templates/jp-si/02-detailed-design.md` | 2,951 | 1,889 | 102 | 738 | `75ad836a3175` |
| `core/workflows/basic-development.md` | 9,578 | 9,558 | 127 | 2,395 | `139cbc52e22d` |
| `core/workflows/bug-repair.md` | 4,427 | 4,425 | 64 | 1,107 | `0bf861ea7a7c` |
| `core/workflows/e2e.md` | 4,456 | 4,446 | 55 | 1,114 | `8e56df75eb4c` |
| `core/workflows/investigate.md` | 8,235 | 8,209 | 123 | 2,059 | `b94c545fb217` |
| `core/workflows/quality-security.md` | 3,954 | 3,950 | 50 | 989 | `642ab3072eaf` |
| `core/workflows/refactor.md` | 5,760 | 5,740 | 59 | 1,440 | `b38cf5d65c3e` |
| `core/workflows/router.md` | 2,673 | 2,665 | 63 | 669 | `d5cccafb620d` |
| `local-template/checks/README.md` | 1,438 | 1,434 | 38 | 360 | `934cb4236f88` |
| `local-template/methods/README.md` | 572 | 570 | 13 | 143 | `3ce9aa626434` |
| `local-template/project.example.md` | 3,085 | 3,077 | 82 | 772 | `dce78371e0f1` |
| `local-template/project.md` | 8,740 | 8,704 | 221 | 2,185 | `36ef9d84686a` |
| `local-template/templates/README.md` | 444 | 442 | 11 | 111 | `0ee053672104` |
| `local-template/zones/README.md` | 645 | 641 | 13 | 162 | `56ab9026f64d` |
| `registry.json` | 2,841 | 2,841 | 56 | 711 | `8129a4819f49` |
| `scripts/install.py` | 36,819 | 36,785 | 944 | 9,205 | `48580f65d1d2` |
| `scripts/sr_init.py` | 19,649 | 19,317 | 519 | 4,913 | `96fcbabd0be7` |
| `scripts/sr_guard.py` | 27,472 | 27,440 | 621 | 6,868 | `5b7722169268` |
| `scripts/sr_readiness.py` | 21,757 | 21,737 | 576 | 5,440 | `690b76ec753a` |

### Trellis spec metrics

| Path | Bytes | Chars | Lines | Tokens |
|---|---:|---:|---:|---:|
| `.trellis/spec/backend/index.md` | 653 | 651 | 16 | 164 |
| `.trellis/spec/backend/transport-adapter.md` | 3,442 | 3,434 | 88 | 861 |
| `.trellis/spec/frontend/component-guidelines.md` | 878 | 878 | 59 | 220 |
| `.trellis/spec/frontend/directory-structure.md` | 745 | 733 | 54 | 187 |
| `.trellis/spec/frontend/hook-guidelines.md` | 745 | 745 | 51 | 187 |
| `.trellis/spec/frontend/index.md` | 1,318 | 1,318 | 39 | 330 |
| `.trellis/spec/frontend/quality-guidelines.md` | 748 | 748 | 51 | 187 |
| `.trellis/spec/frontend/state-management.md` | 796 | 796 | 51 | 199 |
| `.trellis/spec/frontend/type-safety.md` | 741 | 741 | 51 | 186 |
| `.trellis/spec/guides/code-reuse-thinking-guide.md` | 7,381 | 7,375 | 223 | 1,846 |
| `.trellis/spec/guides/cross-layer-thinking-guide.md` | 15,324 | 15,266 | 333 | 3,831 |
| `.trellis/spec/guides/index.md` | 3,680 | 3,652 | 97 | 920 |
| **Total** | **36,451** | **36,337** | **1,113** | **9,113** |

## Per-workflow closures (ALL workflows)

### Closure metric table

“Original” は `collect()` expected adapter/core/local-template render、
“Generated” は現在のrepository bindingを使う。Unionは下記P/Tの既知SR filesを
全部含む上限であり、repository source、task/design/evidence、spec、runtime sourceを
含まない。

| Entrypoint | A files | Original A bytes/chars/lines/tokens | Generated A bytes/chars/lines/tokens | A+P/T files | Original union bytes/chars/lines/tokens | Generated union bytes/chars/lines/tokens |
|---|---:|---|---|---:|---|---|
| `sr-route` | 8 | 38,902 / 38,802 / 783 / 9,726 | 43,608 / 42,542 / 851 / 10,902 | 11 | 49,522 / 48,874 / 1,001 / 12,381 | 54,228 / 52,614 / 1,069 / 13,557 |
| `sr-plan` | 9 | 50,353 / 50,241 / 918 / 12,589 | 55,059 / 53,981 / 986 / 13,765 | 28 | 114,808 / 111,495 / 2,366 / 28,702 | **119,514 / 115,235 / 2,434 / 29,879** |
| `sr-build` | 9 | 50,354 / 50,242 / 918 / 12,589 | 55,060 / 53,982 / 986 / 13,765 | 21 | 93,883 / 93,092 / 1,746 / 23,471 | 98,589 / 96,832 / 1,814 / 24,648 |
| `sr-verify` | 9 | 50,366 / 50,254 / 918 / 12,592 | 55,072 / 53,994 / 986 / 13,768 | 22 | 91,384 / 90,591 / 1,728 / 22,846 | 96,090 / 94,331 / 1,796 / 24,023 |
| `sr-refactor` | 9 | 46,558 / 46,446 / 850 / 11,640 | 51,264 / 50,186 / 918 / 12,816 | 24 | 112,521 / 111,676 / 2,163 / 28,131 | 117,227 / 115,416 / 2,231 / 29,307 |
| `sr-bug` | 9 | 45,214 / 45,120 / 855 / 11,304 | 49,920 / 48,860 / 923 / 12,480 | 23 | 108,514 / 107,691 / 2,104 / 27,129 | 113,220 / 111,431 / 2,172 / 28,305 |
| `sr-scan` | 9 | 44,726 / 44,630 / 841 / 11,182 | 49,432 / 48,370 / 909 / 12,358 | 22 | 81,027 / 80,309 / 1,603 / 20,257 | 85,733 / 84,049 / 1,671 / 21,434 |
| `sr-e2e` | 9 | 45,225 / 45,123 / 846 / 11,307 | 49,931 / 48,863 / 914 / 12,483 | 21 | 93,207 / 92,400 / 1,751 / 23,302 | 97,913 / 96,140 / 1,819 / 24,479 |
| `sr-investigate` | 8 | 44,491 / 44,373 / 843 / 11,123 | 49,197 / 48,113 / 911 / 12,300 | 20 | 91,684 / 90,887 / 1,782 / 22,921 | 96,390 / 94,627 / 1,850 / 24,098 |

### File closure by entrypoint

共通略記:

- `C5` = `local/checks/{build,format,lint,types,unit}.md`
- `M2` = `local/methods/{python,typescript}.md`
- `T3` = `core/templates/jp-si/{00-requirements,01-basic-design,02-detailed-design}.md`
- A欄は前述の`B`、必要なentrypointは`+ closeout.md`

| Entrypoint | A | P/T additions and condition |
|---|---|---|
| `sr-route` | `B` | T: `change-envelope.md` only if code/change dimensions apply. Adapterが`artifact-map`と`approval-gate`を読むがrouter本文は参照しない。 |
| `sr-plan` | `B + closeout` | P(PLAN): `impact`, `change-envelope`, `requirement-interaction`, `design-artifacts`, `decomposition`, `test-evidence`; T/direct: `zones`, `readiness`, `dispatch` if sub-agent, `C5`, `T3` selected by binding, `M2` by language. |
| `sr-build` | `B + closeout` | P(BUILD): `guard`; T/direct: `impact`, `test-evidence`, `readiness`, `dispatch`, `C5`, `M2`. Approved design/specはrun-dependent external content。 |
| `sr-verify` | `B + closeout` | P(VERIFY): `review`, `anti-fake`, `receipt`; T/direct: `zones`, `readiness`, `guard`, `C5`, `M2`. |
| `sr-refactor` | `B + closeout` | P(CHARACTERIZE): `impact`, `change-envelope`, `test-evidence`; P(TRANSFORM): `review`, `anti-fake`; P(VERIFY): `receipt`; T/direct: `readiness`, `guard`, `C5`, `M2`. |
| `sr-bug` | `B + closeout` | P(DIAGNOSE): `impact`, `change-envelope`, `test-evidence`; P(REPAIR): `review`; P(VERIFY): `receipt`; T/direct: `readiness`, `guard`, `C5`, `M2`. |
| `sr-scan` | `B + closeout` | P(SCOPE): `change-envelope`; P(REMEDIATE): `review`, `anti-fake`; P(VERIFY): `receipt`; T/direct: `zones`, `guard`, `C5`, `M2`. Scanner fileは存在時のみ。 |
| `sr-e2e` | `B + closeout` | P(DESIGN): `test-evidence`; P(IMPLEMENT): `review`; P(VERIFY): `receipt`; T/direct: `readiness`, `guard`, `C5`, `M2`. このrepositoryにはe2e check fileがない。 |
| `sr-investigate` | `B` | P(INVESTIGATE): `impact`, `zones`; P(SYNTHESIZE): `change-envelope`; T/direct: `test-evidence`, `readiness`, `C5`, `M2`. Production implementationは禁止。 |

### Phase-known nuance

`sr-plan/build/verify` はadapter選択時点でphaseが固定されるため、上表Pは実運用では
そのentrypointに対して決定的である。ただしinstallerのhost adapter自身はP filesを
列挙せず、workflowを1ファイル読んだ後にその指示へ到達する。本reportは
「注入の厳密な常時境界」と「phase選択後のrequired境界」を混同しないため、
metric tableではPをunion側へ置いた。

## Always vs conditional

### 主要所見

1. `contract.md` (14,164 bytes)、repository-specific `project.md`
   (13,404)、`artifact-map.md` (6,263)、`method-router.md` (4,429)、
   `approval-gate.md` (1,070) は9 entrypointsすべてで常時読まれる。
2. `closeout.md` (4,541) は7 entrypointsで常時読まれるが、実際に必要なのは
   最終phaseである。特にphase固定の`sr-plan`/`sr-build`では早すぎる。
3. `sr-route` はrecommend-and-stopでwriteしないにもかかわらず、
   generic adapterにより `artifact-map.md + approval-gate.md =
   7,333 bytes / 約1,834 tokens` を常時読む。
4. `basic-development.md`全9,554 bytesをPLAN/BUILD/VERIFYの各adapterが読む。
   phase instructionは実行範囲を制限するが、読込tokenを制限しない。
5. Conditional最大値にはlocal checks 1,063 bytes、M2 1,425 bytes、
   PLAN template 6,703 bytesを含む。runtime source 49,269 bytesは実行依存であり
   promptへ全文注入する必要はない。
6. `method-router.md` の “Read local/methods/” はhost実装により
   directory listingだけか全file readかが曖昧。全fileなら各entrypointへ
   最大1,425 bytesが追加される。本表はREADME常時、M2条件付きとした。

## Original-vs-generated

### Byte/hash comparison

再現対象:

```text
version, expected, once = install.collect(
    original_root, ["cursor", "codex"], ".agents"
)
```

- `len(expected) = 73`
- manifest `files` keys = 73
- expected−manifest missing = `[]`
- manifest−expected extra = `[]`
- actual file missing = `[]`
- byte-identical = **72**
- divergent = **1**

Category別:

| Category | Expected | Byte-identical | Expected bytes |
|---|---:|---:|---:|
| `.agents/core` | 29 | 29 | 154,561 |
| `.agents/local` template set | 6 | 5 | 14,846 |
| `.agents/runtime` | 2 | 2 | 49,269 |
| `.agents/skills` (SKILL + YAML) | 18 | 18 | 11,756 |
| `.cursor` (skills + commands) | 18 | 18 | 13,373 |

唯一の差分:

| Metric | Expected rendered project.md | Actual project.md | Delta |
|---|---:|---:|---:|
| bytes | 8,698 | 13,404 | +4,706 |
| characters | 8,662 | 12,402 | +3,740 |
| lines | 221 | 289 | +68 |
| approximate tokens | 2,175 | 3,351 | +1,176 |
| full SHA-256 | `8bb24a5135e9c937d451699825bc4ae3c09811e6dde59e7c992b4b010bd5cacb` | `87a30922e1ed9e653b0811b70b34b42199d3e3601af26eda1a83baeb0ecd3357` | different |

Raw Original `local-template/project.md` は8,740 bytesである。8,698との差42 bytesは
`${SR_HOME}` → `.agents` renderによる。actual差分はinstaller defectではなく、
`local/`をrepository-ownedかつnever-overwriteとする設計どおりのbinding充実である。
manifest hashもactual hashを記録している。

### Core render equivalence

Original `core/**/*.md` の`${SR_HOME}`を`.agents`へ置換しgeneratedとbyte比較した結果は
**29/29一致**。従ってraw hash相違はplaceholder由来でありcore driftではない。
runtimeは先頭へ`# sr-managed v5.2.0`を挿入する生成規則込みで2/2一致。

## Duplication

### Exact repetition

- Cursor/Codexの同一entrypoint adapter bodyは**9 pairsすべて同一**。
  frontmatter後bodyの重複片側合計は **7,510 bytes**。ただし通常は1 hostだけが
  1 adapterを読むためdisk duplicationであり、runtime tokenを単純に7,510削減
  できるわけではない。
- workflow先頭の
  `Read contract, method-router, artifact-map` 88-byte lineは6 filesに出現
  （528 loaded bytes、1 copyを除くexact duplicate 440 bytes）。
- `approval-gate + closeout` 58-byte lineは5 filesに出現
  （290 loaded bytes、1 copyを除く232 bytes）。
- `basic-development.md` は3 entrypointsに同一全文が常時現れ、
  **9,554 × 3 = 28,662 bytes / 約7,166 tokens**。
- 最大常時反復。`Total loaded` は全出現を含む実ロード量、
  `Duplicate excess` は比較用に1回分だけ残した超過量であり、その全量が
  削減可能という意味ではない:

| File | Occurrences | Bytes/file | Total loaded | Duplicate excess | Excess tokens |
|---|---:|---:|---:|---:|---:|
| `contract.md` | 9 | 14,164 | **127,476** | **113,312** | 28,328 |
| `local/project.md` | 9 | 13,404 | 120,636 | 107,232 | 26,808 |
| `artifact-map.md` | 9 | 6,263 | 56,367 | 50,104 | 12,526 |
| `method-router.md` | 9 | 4,429 | 39,861 | 35,432 | 8,858 |
| `closeout.md` | 7 | 4,541 | 31,787 | 27,246 | 6,812 |
| `basic-development.md` | 3 | 9,554 | 28,662 | 19,108 | 4,777 |
| `approval-gate.md` | 9 | 1,070 | 9,630 | 8,560 | 2,140 |

### Conceptual overlap（責務を区別）

- approval/governance: `contract` Human approval 1,063 bytes +
  `local/project` gate policy 469 + `approval-gate` 1,070。これはdefault rule、
  repository choice、gate artifact shapeという別責務を持つため全文統合は危険。
- artifact ownership: `artifact-map` 6,263 + project destination section 1,870 +
  contract knowledge ownership 714。logical taxonomy、real path binding、
  ownership principleを保ったまま参照化できる余地がある。
- evidence/readiness: `readiness` 13,912 + `test-evidence` 12,551 +
  contract quality baseline 697 + project verification 387。
  state machine、test oracle、global prohibition、repository commandsは同義ではない。
- `closeout.md` と `receipt.md` はModule disposition table rowをexact共有するが、
  前者は手順、後者はschemaであり、schema vocabularyを失ってはならない。

## Quantified reduction candidates

数値はgenerated bytesを基準とし、候補間の重複を避けるため適用順と対象を分離した。
“Gross” は現状から条件外runで不要となる既存payload、“Net” は明示したpointer
overheadを差し引く。実tokenizer値ではなく `ceil(bytes/4)`。

### R1. Contract interaction guidanceを条件付きmodule化（最大）

- 対象: `contract.md` の `Out-of-band requests` 3,531 bytes +
  `Handing a decision to a person` 2,256 = **5,787 bytes**。
- 適用: 9 entrypoints。interruptionまたはmid-phase human decision時だけ読む。
- Gross: **52,083 bytes** (`5,787 × 9`)。
- Pointer: 150 bytes/entrypoint相当。
- Net: **50,733 bytes / 約12,684 tokens**。
- 残すgovernance: scope changeでPLANへ戻る、safe default、stop/switchのresume記録、
  approvalとquestionの区別、out-of-bandでproduction changeをしない。
- Risk: 条件判定自体を忘れるとgovernanceが消える。
- Verification: `test_core_cross_references_resolve`、全workflowがcontractへ到達するtestに加え、
  interruption/new requirement/stopの3 instruction evalを追加し、conditional moduleが
  必ずloadされることをtranscript assertionする。

### R2. Repository project briefをon-demand分離

- 対象: `.agents/local/project.md` section 11 = **3,256 bytes**。
- 適用: 9 entrypoints。保守的にroute/PLAN/investigateの3回ではloadし、
  build/verify/refactor/bug/scan/e2eの6回では不要と仮定。
- Gross: **19,536 bytes** (`3,256 × 6`)。
- Pointer: 144 bytes × 9 = 1,296。
- Net: **18,240 bytes / 約4,560 tokens**。
- 最大条件外ならnet 28,008 bytesだがportfolioには保守値18,240だけを計上。
- 残すgovernance: destinations、language、checks、gate policy、prohibitions、
  risks、readiness profile、phase companionsは常時bindingに残す。
- Risk: architecture/startup contextが必要なrepairでloadされない。
- Verification: `test_init` のbrief生成/answered-cell/idempotency保証、
  local binding survives reinstall、doctor、route/PLAN/investigate evalを維持。
  抽出fileも`local/` never-overwrite対象であることを追加testする。

### R3. basic-developmentのphase view生成

- 対象: `basic-development.md` 9,554 bytesを3 adaptersが全文読む反復。
- 実測section: preamble 984、PLAN 3,244、BUILD 3,269、VERIFY 2,057 bytes。
- 現状: **28,662 bytes** (`9,554 × 3`)。
- phase view合計: `3 × 984 + 3,244 + 3,269 + 2,057 = 11,522 bytes`。
- Gross/Net: **17,140 bytes / 約4,285 tokens**。
  registry path以外のadapter長は変わらない前提。
- 適用: `sr-plan`, `sr-build`, `sr-verify`。
- 残すgovernance: canonical sourceは1つ、phase順、approval invalidation、
  design/TDD/review/receipt/finishの全規則。
- Risk: canonical sourceとgenerated phase viewのdrift。
- Verification: sourceからviewを生成し手書きcopyを禁止。既存registry reachability、
  install idempotency、all-host generationに加え、3 viewsを再構成すると
  canonical preamble+各sectionとbyte一致するtestを追加する。

### R4. Specialized closeoutを最終phaseまで遅延

- 対象: R3と重複しない specialized 4 entrypoints
  (`refactor`, `bug`, `scan`, `e2e`) の `closeout.md`。
- Gross: **18,164 bytes** (`4,541 × 4`)。
- Pointer: 63 bytes × 4 = 252。
- Net: **17,912 bytes / 約4,478 tokens**（非final phaseを各1回呼ぶ比較）。
- `sr-plan/build`の同種削減はR3に含め、二重計上しない。
- 残すgovernance: module design disposition、human docs/spec reconciliation、
  lessons criteria、ticket follow-up、final guard。
- Risk: current phase detection不良でfinal closeoutが抜ける。
- Verification: final-phase evalでcloseout/receipt/guard順をassert。
  guard testsのmodule disposition、design artifact、receipt schemaを全維持。

### R5. Router adapterをread-only専用化

- 対象: generic adapterがrouterにも強制する `artifact-map.md` 6,263 +
  `approval-gate.md` 1,070。
- Gross/Net保守値: **7,333 bytes / 約1,834 tokens**。
  adapterから2 read linesを消す追加約95 bytesは数えず、過大評価を避けた。
- 適用: `sr-route` のみ。
- 残すgovernance: `contract`, `method-router`, project binding、risk table、
  change-envelope conditional、recommend-and-stop/no implementation。
- Risk: router将来拡張でartifact write/gateを始めた際に依存追加を忘れる。
- Verification: registry descriptionとrouter evalで「分類・推奨して停止、writeなし」をassert。
  adapter snapshotで必要4要素（binding/contract/method-router/router）を固定する。

### Disjoint portfolio

R1 50,733 + R2 18,240 + R3 17,140 + R4 17,912 + R5 7,333 =
**111,358 bytes / 約27,840 tokens**。

これは9 entrypointsを各1回、R2を3 context-heavy/6 context-light、
R4を4 non-final specialized callsとして比較したもの。実run頻度やhost prompt cacheを
加味していない。adapter bodyのCursor/Codex disk重複7,510 bytesはruntime netへ
算入しない。

### 未計上の曖昧候補

`local/methods/python.md + typescript.md = 1,425 bytes`。
hostが `Read local/methods/` を全file loadと解釈すれば9回で最大12,825 bytes
（約3,207 tokens）の余地があるが、本auditのstrict AではREADMEだけを数えたため
portfolioへ含めない。method indexにlanguage→file mappingを置くA/B traceで先に
実load behaviorを測るべきである。

## Tests-evals guarantees

### Inventory

ASTでmodule/class内を含む `test_*` functionを数えた結果:

| Test file | Functions |
|---|---:|
| `test_doctor.py` | 12 |
| `test_guard.py` | 20 |
| `test_guard_compat.py` | 13 |
| `test_guard_failopen.py` | 21 |
| `test_guard_v4.py` | 23 |
| `test_home.py` | 12 |
| `test_init.py` | 12 |
| `test_install.py` | 11 |
| `test_readiness.py` | 18 |
| `test_receipt_schema.py` | 11 |
| `test_registry.py` | 6 |
| `test_templates.py` | 7 |
| **Total** | **166** |

Instruction evals:

| Eval | Scenarios | Intended guarantee |
|---|---:|---|
| `impact.md` | 5 | bounded evidence cone、contract/cross-cutting reach、unknown、stale revision |
| `measurement.md` | 5 | local receipt、no upload、missing cost許容、no productivity fiction、product untouched |
| `multi-requirement.md` | 5 | interaction classification、single writer、conflict/unknown stop |
| `readiness.md` | 7 | admission、failure identity、stale baseline、brownfield、discovery、differential、legacy |
| `review.md` | 6 | domain/security/consumer lens、risk-based gate、filled sheet、capability unknown |
| `test-governance.md` | 8 | cheapest seam、oracle ownership、production authorization、no invented E2E、honest not-run、legacy/differential |
| **Total** | **36** | |

### Proposal-to-guarantee mapping

| Proposal | Must preserve |
|---|---|
| R1 contract split | all workflow→contract reachability; phase companions start/gate; multi-requirement conflict/unknown; review risk/security; scope-change invalidation; no unauthorized external action |
| R2 project brief split | local never overwritten/uninstall preserved; init only fills blanks/idempotent upgrade; real destinations/language/checks/gates/prohibitions remain authoritative; readiness project_kind/truth order |
| R3 phase views | 9 registry entrypoints and 7 canonical-source semantics; PLAN design/decomposition/test matrix; BUILD RED→GREEN/checkpoint; VERIFY independent review/receipt/closeout; all host adapters versioned |
| R4 deferred closeout | module disposition, three design artifacts, receipt schema/vocabulary, baseline delta, no self-review, final guard and final APPROVE |
| R5 router specialization | risk/change-dimension/unknown classification, companions surfaced, recommends and stops, no implementation or artifact write |

特に削ってはならないruntime-enforced guarantees:

- pass claimには実行checkとopenable evidenceが必要
- stale revision、forbidden path、empty table、unknown vocabularyをfail closed
- Author/Reviewer独立
- one acceptance criterion ↔ one task、RED revision before GREEN
- module design dispositionとdesign artifacts
- suppression/TODOの説明
- test strategy vocabulary、differential evidence
- baselineはfailure countでなくidentity比較、stale fingerprint、rebaseline reason
- legacy schemaを勝手にcurrent解釈しない

テスト実行試行:

```text
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider -q
```

結果は `/usr/bin/python3: No module named pytest`。Originalを汚さないためcache providerを
無効化していたが、collection前に終了した。従って166はAST inventoryでありpass数ではない。

## Reproducibility

使用したのはworkspace外へもfileを残さない `python3 - <<'PY' ... PY` inline scripts。
要点:

```python
data = path.read_bytes()
text = data.decode("utf-8")
metrics = (
    len(data),
    len(text),
    len(text.splitlines()),
    math.ceil(len(data) / 4),
    hashlib.sha256(data).hexdigest(),
)
```

生成比較:

```python
spec = importlib.util.spec_from_file_location("sr_install", original / "scripts/install.py")
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)
version, expected, once = install.collect(
    original, ["cursor", "codex"], ".agents"
)
same = {
    rel for rel, content in expected.items()
    if (workspace / rel).read_bytes() == content.encode("utf-8")
}
```

Core render比較:

```python
rendered = original_file.read_text(encoding="utf-8").replace("${SR_HOME}", ".agents")
assert rendered == generated_file.read_text(encoding="utf-8")
```

Test inventory:

```python
tree = ast.parse(path.read_text(encoding="utf-8"))
count = sum(
    isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    and node.name.startswith("test_")
    for node in ast.walk(tree)
)
```

Eval inventoryは各`evals/*.md`（README除外）の
`^## (Case )?[A-Z]( space or em-dash)`を数えた。

推奨再現command:

```text
cd /mnt/d/apps/language-aware-conferencing-system/lams-mvp
python3 ./.trellis/scripts/get_context.py --mode packages
python3 -c "import pathlib; [p.read_bytes().decode('utf-8') for p in pathlib.Path('.agents').rglob('*') if p.is_file()]"
cd /home/liush/projects/serverlessAIAgents/tools/sr-dev-workflow-suite
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider -q
```

最後のcommandはpytestをinstallした隔離環境で実行すること。Original suiteへ
`.pytest_cache` / `__pycache__`を新規作成しない設定を維持する。

## Limitations

1. bytes/4はmodel固有tokenizerではない。特に日本語の`project.md`では誤差があり得る。
2. hostのprompt cache、skill discovery metadata、tool output framingは測定していない。
3. “Read directory” がlistingか全file本文かはhost contractに明記されず、M2を条件付きとした。
4. P filesはphase固定entrypointでは実質requiredだが、adapterの直接注入ではないため
   strict Aと分離した。
5. Spec/task/design/source/check outputはtaskごとに変わる。12 spec全件加算値は
   stress upper scenarioであり、通常runの期待値ではない。
6. Specialized workflowは1 invocationで複数phaseを進めることも、gateごとに再invokeする
   こともあり得る。R4の削減はnon-final invocation前提。
7. Testsはpytest不在で実行できず、166 functionsの存在とassertion内容を静的調査した。
8. Instruction evalsは意図的にmanualで、36 scenariosをこのauditでmodel実行していない。
9. Report作成時点のrepositoryには多数の先行変更がある。本調査はそれらを編集していない。

## Validation record

- report target encoding: UTF-8
- Original/source/generated encoding preflight: 255 files、decode error 0、BOM 0
- workflow census: 9 entrypoints / 7 canonical files
- manifest set: expected 73 / manifest 73 / missing 0 / extra 0
- byte comparison: 72 same + 1 divergent = 73
- core render: 29 same + 0 divergent = 29
- tests: per-file sum 166
- evals: 5 + 5 + 5 + 7 + 6 + 8 = 36
- generated maximum bounded closure:
  `sr-plan` 119,514 bytes → `ceil(119514/4) = 29,879`
- spec aggregate:
  36,451 bytes → `ceil(36451/4) = 9,113`
- maximum with all specs:
  119,514 + 36,451 = 155,965 bytes → 38,992 tokens
- disjoint reduction portfolio:
  50,733 + 18,240 + 17,140 + 17,912 + 7,333 = 111,358 bytes
- 通常書き込み先: 本reportのみ
