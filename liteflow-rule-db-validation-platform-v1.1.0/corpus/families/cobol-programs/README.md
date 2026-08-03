# family: cobol-programs（COBOL プログラム変換・複数ファイル）

旧システム刷新で最初にぶつかる形 — **1本の主プログラムが複数の従プログラムを CALL し、
段落と GO TO で流れを作る** — をルール表だけでJavaへ落とせるかを確かめる。

判定は `cobol-statements` と同じく**振る舞い**である。生成物を実際に `javac` し、
実際に実行して期待値と突き合わせる。テキスト比較ではない。

## 対応しているCOBOL構文

| 分類 | 構文 |
|---|---|
| プログラム構造 | `PROGRAM-ID`、`DATA DIVISION`、`WORKING-STORAGE SECTION`（`VALUE` 句つき）、`LINKAGE SECTION`、`PROCEDURE DIVISION USING`、段落 |
| 分岐 | `IF` / `ELSE` / `END-IF`（数値比較・英数字比較の両方）、`EVALUATE` / `WHEN` / `WHEN OTHER` / `END-EVALUATE` |
| ループ | `PERFORM <段落>`、`PERFORM <段落> THRU <段落>`、`PERFORM <段落> UNTIL`、`PERFORM <段落> THRU <段落> UNTIL`、`PERFORM <n> TIMES`、行内 `PERFORM UNTIL ... END-PERFORM`、`PERFORM VARYING ... END-PERFORM` |
| 分岐（無条件） | `GO TO <段落>` |
| プログラム間 | `CALL '<名前>' USING <項目>...`（引数の数は可変）、`GOBACK`、`STOP RUN` |
| 演算・入出力 | `MOVE`、`ADD`、`ADD ... GIVING`、`SUBTRACT`、`MULTIPLY`、`DIVIDE`、`COMPUTE`、`DISPLAY`、`CONTINUE`、`EXIT` |

## 生成されるJavaの形（重要）

1プログラム = 1クラス。段落は**ラベル配列とディスパッチャ**で表現する。
この形でないと GO TO と PERFORM THRU を同時に正しく扱えない。

```java
public final class MAINPGM {
    private static final String[] PARAS = {"MAIN-PARA", "ACCUM-PARA", ..., "__END"};
    private static final String[] LINKAGE = {...};

    public static Map<String,Object> runAsMain(...)   // STOP RUN をここで受け止める
    public static Map<String,Object> run(...)         // GOBACK をここで受け止める
    public static void call(callerVars, out, args...) // LINKAGE を位置で束縛 → 実行 → 書き戻し
    static void perform(vars, out, from, until)       // 範囲内の段落を順に実行
    private static String P_MAIN_PARA(vars, out)      // null なら次の段落へ、ラベルなら GO TO
}
```

| COBOL | 生成されるJava |
|---|---|
| `GO TO X.` | `return "X";`（`perform()` が範囲内か判定し、範囲外なら外側へ解いていく） |
| `PERFORM X THRU Y.` | `perform(vars, out, "X", "Y");` |
| `PERFORM X UNTIL c.` | `while (!(c)) { perform(vars, out, "X", "X"); }` |
| `CALL 'SUB' USING A B.` | `generated.SUB.call(vars, out, "A", "B");` |
| `STOP RUN.` | `stopRun();`（全プログラム共有の信号。副プログラムの中からでも全体を止める） |
| `GOBACK.` | `goback();`（呼び出し元へ戻るだけ。STOP RUN と**別の信号**にしてある） |

`EVALUATE` は `switch` にしない。Javaは `double` で `switch` できず、`WHEN` にフォールスルーも無く、
`EVALUATE TRUE` に対応物も無いためである。`if (false) {` を種にした `else if` 連鎖にしている。

生成骨格そのものは `app/src/main/java/.../transform/GeneratedProgramCompiler.java` の
`buildProgramSource()` にあり、`app/src/test/java/.../GeneratedProgramHarnessTest.java` が
ルール表を通さずに直接検証している（GO TO、PERFORM THRU、PERFORM 内の STOP RUN、
LINKAGE 束縛、暴走ループの停止など15項目）。

## ケース一覧

| ケース | 何を見ているか | 期待 |
|---|---|---|
| `01-main-calls-two-subs` | **代表ケース。** 主1＋従2。CALL・GO TO・PERFORM UNTIL・EVALUATE・IF/ELSE を1本に集約。4通りの入力で実行 | PASS |
| `02-perform-thru-and-goto` | PERFORM THRU の範囲、行内 PERFORM VARYING / TIMES、範囲内 GO TO | PASS |
| `03-unsupported-statements` | **負例。** SORT / STRING / INSPECT / SEARCH 未対応 → 未カバー率で落ちる | **FAIL** |
| `04-alphanumeric-branch` | 英数字比較。`cobol-statements` の負例 `12-alphanumeric-if-gap` と同じ題材を、ルール1件で塞いだ確認 | PASS |

## ケースの構成

```text
cases/<ケースID>/
  meta.json              +templateProfile +entryProgram（実行開始プログラム名）
  input/*.cbl            ★変換元。複数ファイルをそのまま置く
  output/behaviour.json  ★期待する正解（入力データ項目 → 期待するデータ項目）
```

`input/` の**全ファイル**が `sourceFiles` としてまとめて1回のリクエストで送られる。
`meta.json` の `entryProgram` が、どのプログラムから実行を始めるかを決める。

## 既知の穴（ケースごとの `meta.json` にも書いてある）

- **数値はすべて `double`。** `PIC 9(7)` の桁あふれ、`COMP-3` の定点十進は模擬していない
- **CALL は copy-in/copy-out で BY REFERENCE を模擬している。** 2つの実引数が同じ項目を指す場合や、
  呼び先が呼び元を再び CALL する場合は等価にならない
- **PERFORM の再帰は Java の再帰になる。** 実COBOLでは未定義動作であり、**本実装の方が寛容**。
  実COBOLで無限ループになるプログラムが、ここでは通ってしまう可能性がある
- **範囲外への GO TO** は標準では未定義動作。本実装は「目標を含む外側の範囲まで解く」挙動
- `SORT` / `STRING` / `INSPECT` / `SEARCH` / `OCCURS` / `REDEFINES` / ファイル入出力は未対応
- 英数字比較は完全一致のみ。COBOL の後続空白詰めは模擬していない

## 実行

```powershell
scripts\corpus-run.cmd -Family cobol-programs
powershell -File scripts\local-corpus.ps1 -Port 8091 -Family cobol-programs   # Docker不要版
```

**合格基準**: 4/4 as expected、正例コンパイル 3/3、振る舞い 8/8、負例1件が FAIL のまま。
