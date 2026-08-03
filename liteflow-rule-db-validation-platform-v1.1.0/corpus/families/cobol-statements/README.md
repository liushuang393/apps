# family: cobol-statements（COBOL 文単位変換・単一ファイル）

**このファミリは凍結されている。** 新しいCOBOL構文への対応は
[`../cobol-programs/`](../cobol-programs/) へ追加すること。

## 何を証明しているか

1行1文のCOBOL断片を `compilable-v1` のルール表で変換し、

1. 生成されたJavaが**実際に javac でコンパイルできる**
2. **実際に実行して**、`output/behaviour.json` の期待値と一致する
3. 未対応の文は捨てずに**未カバー行として計上**される

という閉ループが動くことを示す。ルール表エンジンそのものの回帰テストである。

## なぜ凍結なのか

このファミリの**未対応範囲そのものが品質ゲートの試験体**になっている。

- `11-uncovered-statements` は `PERFORM` / `EVALUATE` が未対応であることを使って
  「未カバー率でゲートが落ちる」ことを証明している
- `TransformPipelineTest.qualityGateRejectsUncoveredStatements` は
  `unrecognisedLines == 2` を直接アサートしている

`compilable-v1` に `PERFORM` や `EVALUATE` のルールを足すと、この2つのゲートが**同時に退行する**。
だから足さない。新しい構文は別プロファイル・別ファミリへ。

## ケースの構成

```text
cases/<ケースID>/
  meta.json              目的・対象文形式・既知の穴・期待するゲート結果
  input/source.cbl       COBOL文。1行1文（PROCEDURE DIVISION の断片）
  output/behaviour.json  振る舞い期待値。入力データ項目 → 期待するデータ項目
```

`input/` は変換元、`output/` は**期待する正解**。
実際の実行結果は常に `reports/corpus-report.md` / `.json` にしか出ない。

### `output/behaviour.json`

```json
[
  {
    "name": "ケースの説明",
    "given":  { "WS-A": 5, "WS-B": 0 },
    "expect": { "WS-B": 5 },
    "expectDisplay": ["任意。期待するDISPLAY出力"]
  }
]
```

値は両辺が数値なら数値として（誤差 1e-9）、そうでなければ文字列として比較する。
`expectDisplay` は任意で、省略するとDISPLAYの検査を行わない。

### `meta.json`

```json
{
  "title": "…",
  "purpose": "…",
  "covers": ["MOVE", "ADD"],
  "knownGaps": ["このケースが意図的に扱っていないもの"],
  "maxUncoveredRate": 0.0,
  "expectQualityGate": "PASS"
}
```

`expectQualityGate` が `FAIL` のものは**負例**で、拒否されるのが正しい。

## 負例2件（落ちるのが正しい）

| ケース | 落ちる理由 | これが検出できる唯一の手段 |
|---|---|---|
| `11-uncovered-statements` | `PERFORM` / `EVALUATE` 未対応 → 未カバー率 80% | カバレッジ計上 |
| `12-alphanumeric-if-gap` | **コンパイルは通るのに実行時に壊れる** | 振る舞いテスト |

この2件が PASS に変わったらゲートの退行である。

## 実行

```powershell
scripts\corpus-run.cmd -Family cobol-statements
powershell -File scripts\corpus-run.ps1 -Family cobol-statements -BaseUrl http://localhost:8082
powershell -File scripts\corpus-run.ps1 -Family cobol-statements -Profile readable-v1   # 別プロファイル（コンパイルは落ちる）
```

**合格基準**: 12/12 as expected、正例コンパイル 10/10、振る舞い 17/17、未カバー率 8.00%。
