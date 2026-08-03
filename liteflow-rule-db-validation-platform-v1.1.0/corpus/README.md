# 変換コーパス

ルール駆動の変換に対する回帰コーパス。**ファミリ**という単位でまとまっており、
ファミリごとに変換元の言語・使うルールプロファイル・判定方法が違う。

## ⚠ ここにあるのは手書きの合成fixtureであり、実資産ではない

同梱の全ケースは**ルール表を動かすために手で書いたもの**であり、実際の業務システムから抽出したものではない。
これらが示すのは**機構が動くこと**だけである。
**あなたの実プログラムをルールライブラリが扱えるかどうかについては、何も示していない。**

## ファミリ一覧

| ファミリ | 変換元 → 変換先 | ルールプロファイル | 判定方法 | 詳細 |
|---|---|---|---|---|
| [`cobol-statements`](families/cobol-statements/) | COBOL 1文 → Java（単一ファイル） | `compilable-v1`（**凍結**） | 振る舞い（実コンパイル＋実行） | [README](families/cobol-statements/README.md) |
| [`cobol-programs`](families/cobol-programs/) | COBOL プログラム群 → Java（主1＋従2、分岐/ループ/GO TO/CALL） | `cobol-programs-v1` | 振る舞い（実コンパイル＋実行） | [README](families/cobol-programs/README.md) |
| [`struts-springboot`](families/struts-springboot/) | Struts 1.3.10 → Spring Boot 4.1 | `struts-to-boot-v1` | ゴールデン差分＋実コンパイル | [README](families/struts-springboot/README.md) |

## 共通のディレクトリ構成

```text
corpus/
  README.md                         ← このファイル（ファミリ索引）
  families/
    <ファミリ名>/
      family.json                   ファミリ既定のプロファイル・チェーンEL・入力方式・判定方式
      README.md                     このファミリが何を証明しているか
      cases/
        <ケースID>/
          meta.json                 目的・既知の穴・期待するゲート結果
          input/                    ★変換元ファイル一式
          output/                   ★期待する正解
```

**`input/` は変換元、`output/` は期待する正解。**
実際の実行結果は `output/` には**絶対に書かない**。実結果は常に `reports/corpus-report.md` / `.json` だけに出る。

### `family.json`

```json
{
  "family": "cobol-programs",
  "title": "…",
  "purpose": "…",
  "templateProfile": "cobol-programs-v1",
  "chainEl": "THEN(validate,analyze,transform,compile,test,qualityGate,report)",
  "inputMode": "multi",
  "grading": "behaviour"
}
```

| キー | 意味 |
|---|---|
| `templateProfile` | ケースが `meta.json` で上書きしなければこれを使う |
| `chainEl` | このファミリが通すチェーン。ゴールデン差分を使うファミリは `goldenDiff` を含める |
| `inputMode` | `single` = `input/` の1ファイルを `sourceLines` で送る（既存12ケース互換）／ `multi` = `input/` 全ファイルを `sourceFiles` で送る |
| `grading` | `behaviour` / `golden` / `both`。レポートの見出しに出るだけで、実際の判定はサーバ側の品質ゲートが行う |

### `meta.json`（ケース単位）

```json
{
  "title": "…",
  "purpose": "…",
  "covers": ["MOVE", "PERFORM"],
  "knownGaps": ["このケースが意図的に扱っていないもの"],
  "maxUncoveredRate": 0.0,
  "expectQualityGate": "PASS",
  "templateProfile": "任意。family.json の既定を上書きする",
  "entryProgram": "任意。複数プログラムのときの実行開始プログラム名"
}
```

`expectQualityGate` は `PASS` または `FAIL`。`FAIL` は**負例**を意味する。
すなわち**拒否されるのが正しい**ケースである（未対応の文が含まれる、またはルールが誤ったコードを生成する）。
負例が通り始めたらゲートの退行なので、両方向を検査している。

### `output/` の中身

| ファイル | 意味 |
|---|---|
| `behaviour.json` | 振る舞い期待値。生成コードを**実際に実行**して突き合わせる |
| それ以外の全ファイル | ゴールデン成果物。生成された同名の成果物と**テキスト差分**を取る |

## 実行

```powershell
scripts\corpus-run.cmd                                                  # 全ファミリ
scripts\corpus-run.cmd -Family cobol-statements                         # 1ファミリだけ
powershell -File scripts\corpus-run.ps1 -Family cobol-programs -BaseUrl http://localhost:8082
powershell -File scripts\local-corpus.ps1 -Port 8091 -Family all        # Docker不要版
```

出力: `reports/corpus-report.md` と `reports/corpus-report.json`（ファミリ別サマリ＋ケース別明細）

## 実資産へ置き換えるには

このコーパスを意味あるものにするには、実物へ置き換え・拡張すること。

- 実プログラム50本以上。対象資産の文出現頻度分布に合わせて抽出する
- 業務ロジックを理解している担当者が確認した期待出力
- 実行実績から採取した入出力データセット（できれば本番バッチから）
- 面倒なものを意図的に含める: COMP-3、REDEFINES、OCCURS、FILE SECTION、
  PERFORM VARYING の多重、レベル88条件、英数字比較、ON SIZE ERROR、
  Struts側なら DynaActionForm・Tiles・カスタムタグ・複数モジュール

`scripts/corpus-run.cmd` はファミリごとと全体の**未カバー率**を報告する。
この数字が、ルールライブラリが対象資産にどれだけ届いていないかを示す正直な指標である。
**注視すること。隠さないこと。**

自分でケースやファミリを足す手順は README.md の「手順N」を参照。
