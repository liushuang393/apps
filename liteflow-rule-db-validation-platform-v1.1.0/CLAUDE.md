# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語ポリシー（最優先）

**このリポジトリのドキュメント・コメント・ログメッセージ・エラーメッセージはすべて日本語で書くこと。**

- 中国語は使わない。中国語を見つけたら日本語へ直す
- Javadoc、`//` コメント、PowerShell/シェルの `#` コメント、`Write-Host` の出力、`throw` のメッセージ、Markdown 文書 — すべて日本語
- 例外: 識別子・API名・JSONのキー・ログのフィールド名・`corpus/families/*/cases/*/meta.json` の `expectQualityGate` のような列挙値は英語のまま（機械が読む値のため）
- `reports/` に出力される JSON のキーも英語のまま（`validator/validate.py` と各スクリプトが依存している）

## よく使うコマンド

スクリプトはすべて `scripts/` にある。**リポジトリのルートから**実行すること（スクリプト側で親ディレクトリをルートとして解決する）。

```powershell
# 静的事前確認（Docker不要、30秒）— ファイル欠損・構文・設定不整合
scripts\preflight.cmd                       # → reports/preflight-report.md

# ホストのJDK+Mavenでビルドとテスト（Docker不要、約20秒）— 変更後の最速の確認手段
scripts\local-verify.cmd                    # → reports/local-verify.json

# Docker一式（初回15〜25分、2回目以降は数分）
scripts\install.cmd                         # → reports/build-evidence.json
scripts\validate.cmd                        # → reports/validation-report.md ★正式判定
scripts\run-all.cmd                         # preflight + install + validate

# 変換デモとコーパス回帰（Executor起動済みが前提）
powershell -File scripts\demo-transform.ps1                 # → reports/transform-demo.json
scripts\corpus-run.cmd                                      # → reports/corpus-report.md（全ファミリ）
scripts\corpus-run.cmd -Family cobol-programs               # ファミリを絞る
scripts\rule-admin-demo.cmd                                 # → reports/rule-admin-demo.json（シナリオ#3）
scripts\samples-build.cmd                                   # → reports/samples-build.json（Struts/Boot 実ビルド）
scripts\summary.cmd                                         # → reports/summary.md（全レポートを1枚に）

# Docker不要版（ホストで1インスタンス起動 → 実行 → 停止）
powershell -File scripts\local-demo.ps1
powershell -File scripts\local-corpus.ps1 -Port 8091 -Family all

powershell -File scripts\stop.ps1           # 停止（docker compose down -v で完全初期化）
```

**`struts-springboot` ファミリをホストで回すには、先に `scripts\samples-build.cmd` を1回実行して
`corpus/families/struts-springboot/apps/target-springboot41/lib/` を作ること。**
生成された Spring Boot コードの javac に Boot 4.1 の依存jarが要る（Dockerイメージには
`/app/boot41-libs` として最初から入っている）。

### テストの実行

```bash
# 全テスト
mvn -f app/pom.xml -B -ntp clean verify

# 単一テストクラス
mvn -f app/pom.xml -B -ntp test -Dtest=TransformPipelineTest

# 単一テストメソッド
mvn -f app/pom.xml -B -ntp test -Dtest=TransformPipelineTest#qualityGateRejectsUncoveredStatements

# Java の型チェックだけを依存無しで（stub使用、数秒）
python tools/static_compile.py
```

テストは11クラス81件。Docker は不要。

**起動が要るものと要らないものを混ぜないこと。** 起動が要らない5クラスがこの構成の作業ループである。

| クラス | 起動 | 守っているもの |
|---|---|---|
| `RuleDbPlatformIntegrationTest` | Spring | Rule-DB の公開・実行・更新・楽観ロック競合・失敗チェーン |
| `RuleDrivenTransformTest` | Spring | テンプレート差し替えとDBスクリプト更新で生成コードが変わること |
| `TransformPipelineTest` | Spring | 生成→コンパイル→振る舞いテストの閉ループと品質ゲートの拒否動作 |
| `CobolProgramPipelineTest` | Spring | 複数ファイルCOBOLの 解析→変換→コンパイル→実行。未対応文の拒否 |
| `CorpusSnapshotTest` | Spring | コーパス19ケースの変換結果を**チェーン経由で**スナップショットと照合。ノードが薄い adapter のままであることの確認 |
| `RuleEngineCorpusTest` | 不要 | **同じ19ケース・同じスナップショット**をエンジン直呼びで。0.1秒 |
| `RuleEngineTest` | 不要 | ルール適用の意味論（`opens`/`closes`/`requires`/`continueWith`/`${_indent}`/区画順/インラインテンプレート） |
| `ProfileDiagnosticsTest` | 不要 | 同梱プロファイル4本が ERROR 0 件であること。壊した書き方が名指しされること |
| `RuleUsageTest` | 不要 | 宣言したルールをコーパスが実際に通しているか（ラチェット） |
| `RuleGovernanceTest` | Spring | 統制層の不変条件（pre-image の記録・職務分離・同時申請の採番） |
| `AdminUiSecurityTest` | Spring（実サーバ） | **管理画面がブラウザから使えること**（CSRFトークンの受け渡し・フォームログイン・ログアウトでセッションが切れる）と、保護範囲を広げていないこと |
| `GeneratedProgramHarnessTest` | 不要 | **ルール表を通さず生成骨格そのものを検証**（15件）。GO TO / PERFORM THRU / PERFORM 内の STOP RUN / GOBACK / CALL の LINKAGE 束縛 / 暴走ループ停止 / EVALUATE の if-else 連鎖 |

**コーパスに依存する3クラス**（`CorpusSnapshotTest` / `RuleEngineCorpusTest` / `RuleUsageTest`）は、
Dockerイメージ内のビルドでは**前提が満たされないものとして飛ばす**（6件 skip）。
ビルドコンテキストには `app/` しか入らず、実行イメージにテスト用コーパスを持たせないため。
同じ検査はホストの `local-verify` と手順F/J/K の `corpus-run` が行う。

切り分けの土台が2つある。**コーパスが落ちたときは順にこれを見る。**

1. `GeneratedProgramHarnessTest` — 生成骨格そのもの（ルール表を通さない）
2. `RuleEngineTest` — ルール適用の規則そのもの（Spring も javac も通さない）

どちらも緑でコーパスだけが赤なら、原因は**ルール表の中身**である。常に緑に保つこと。

**スナップショットの作り直し**（生成コードを意図して変えたときだけ）:

```bash
mvn -f app/pom.xml test -Dtest=CorpusSnapshotTest -Dsnapshot.update=true
```

`app/src/test/resources/snapshots/*.txt` が19ケース分の生成コードとカバレッジ内訳である。
**意図せず差分が出たらそれは退行**。とくに `compilable-v1` の12件は1バイトも変えてはいけない。

## アーキテクチャ

### 三層構造（混同しないこと）

1. **オーケストレーション層** — chain（実行順）が MariaDB にあり、poll/reconcile で全 Executor へ同期される。LiteFlow が提供
2. **変換ロジック層** — 何をどう変換するかがルール表とDBスクリプトにある。**Javaにハードコードされていない**
3. **生成コード品質層** — 生成物を実際に javac でコンパイルし、実際に実行して期待値と突き合わせる
4. **統制層**（`governance/`） — 誰が何をいつ変えたか、戻せるか、承認を通せるか。**LiteFlow は履歴を持たないので全部自前**

### 判定の強さは領域で違う（混同しないこと）

| 領域 | 判定 | 言えること |
|---|---|---|
| COBOL（`cobol-*` ファミリ） | 生成物を**実行して**期待値照合 | 生成物が**正しく動く** |
| Struts（`struts-springboot`） | ゴールデン差分＋実コンパイル | 生成物が**正解と一致し、コンパイルは通る** |

Struts 側は Web コントローラに共通の実行入口が無いため、実行して値を突き合わせる手が使えない。
`samples-build` が起動して見せる画面は**人手で書いた目標プロジェクト**であり、生成物ではない。
レポートや説明でこの区別を曖昧にしないこと。

### ノードは adapter、意味は純粋なクラスにある

**変換と解析の中身をノードに書かないこと。** ノードは LiteFlow の部品であり、
そこに意味を置くと Spring と LiteFlow を起動しないと1行も試せなくなる。

| 純粋なクラス（起動不要・ここに意味を置く） | それを呼ぶだけの adapter |
|---|---|
| `SourceAnalyzer.analyse(profile, lines, files)` → `Analysis(programs, facts)` | `AnalyzeNode` |
| `RuleEngine.apply(Request)` → `Result(generatedLines, artifacts, coverage, coverageByFile, findings)` | `TransformNode` |

ルールの意味を確かめたいテストは `RuleEngine.apply(...)` を直接呼ぶ（1件あたり数ミリ秒）。
`RuleEngine.Request.of(profile, lines)` が最小の入口。

`MigrationContext.render` と `RuleEngine` の `unknown` フォールバックは
**`InlineTemplates.render` を共有している**。`migrationContext.render/emit` は
**Rule-DB に保存済みの Groovy スクリプトが直接呼ぶ公開面**なので、置換規則を変えると
データベースの中の本文が壊れる。

### 変換パイプライン

正規のチェーンは `THEN(validate,analyze,transform,compile,test,qualityGate,report)`。
`MigrationContext` が全ノード間で状態を運ぶ（trace / sourceLines / templates / generatedLines / coverage / compileOutcome / testResults / qualityGate）。

```
TransformNode   ルール表(正規表現+テンプレート)で1行ずつ変換。未認識行は捨てずに計数
      ↓         実処理は RuleEngine。生成された文は MigrationContext.emit() に積まれる
CompileNode     生成文を Map<String,Object> ベースのクラスで包み、javac を実際に起動
      ↓         クラス出力は一時ディレクトリ。ExecutionController の finally で削除
TestNode        URLClassLoader で読み込み、実際に実行。given → expect を突き合わせ
      ↓
QualityGateNode コンパイル失敗／振る舞い不一致／未カバー率超過なら例外を投げてチェーンを失敗させる
```

複数ファイル・複数成果物のときは経路が増える。`TransformNode` が上から順に判定する。

| 経路 | 条件 | 出力先 |
|---|---|---|
| 段落方式 | `AnalyzeNode` が `CobolProgram` を組み立てた | 段落ごとの生成文 → `buildProgramSource()` |
| 複数ファイル方式 | `sourceFiles` がある | `emitTo` / `section` で名前付き成果物へ振り分け |
| 平坦方式 | 上以外（既存12ケース） | `generatedLines` 1本 → `buildSource()` |

**重要な不変条件**: 変換対象が無いとき、transform / compile / test / qualityGate は**何もしない**。
判定は必ず **`MigrationContext.hasSource()`** と **`hasGeneratedOutput()`** を使うこと
（`sourceLines` だけを見ると複数ファイル方式が動かず、片方だけ直すと逆に壊れる）。
Rule-DB検証（手順D、42項目）はオーケストレーション専用チェーンを使っており、
これらのノードがそこで副作用を持つと **PERF-01 / CONC-01 / SYNC-* が一斉に落ちる**。

`QualityGateNode` は生成物が無いとき `SKIPPED_NO_CODE` を設定して即 return する。
**そこで finding を1件でも足すと例外を投げてしまい、同じ8項目が落ちる。**

### ルール表が中心

`app/src/main/resources/templates/*.json` が本 PoC の主張そのもの。
1ルール = 正規表現（名前付きグループ）+ テンプレート + 版数/所有者/既知の穴。
**新しい構文への対応でJavaを書いてはいけない。JSONにエントリを1件足す。**

| プロファイル | 用途 | 状態 |
|---|---|---|
| `compilable-v1` | COBOL 1文 → Java（単一ファイル） | **凍結。1行も変えないこと** |
| `cobol-programs-v1` | COBOL プログラム群 → Java（分岐・ループ・GO TO・CALL） | 拡張可 |
| `struts-to-boot-v1` | Struts 1.3.10 → Spring Boot 4.1 | 拡張可 |
| `readable-v1` | 人が読む形式（**意図的にコンパイルできない**） | 変えない |

> **`compilable-v1` を凍結している理由。** あのプロファイルの**未対応範囲そのものが
> 品質ゲートの試験体**になっている。負例 `cobol-statements/11-uncovered-statements` と
> `TransformPipelineTest.qualityGateRejectsUncoveredStatements`（`unrecognisedLines == 2` を直接アサート）
> の2つが同時に退行する。**新しい構文は別プロファイルへ。**

`TemplateRenderer` が名前付きグループ `g` から派生変数を作る。

| 変数 | 内容 |
|---|---|
| `${g}` | マッチ文字列そのまま |
| `${g}Java` | Java安全形式（`WS-A`→`WS_A`、`'ABC'`→`"ABC"`） |
| `${g}Expr` | 値を返すJava式（識別子→`vars.get("WS-A")`、リテラル→そのまま） |
| `${g}Mapped` | プロファイルの `maps.g` で変換（`=`→`==` など） |
| `${g}List` | 空白区切りトークン → `"A", "B", "C"`（`CALL ... USING A B C` のような可変長オペランド用） |
| `${g}ExprList` | 同じくトークン列だが各要素を「値を返す式」に |
| `${_indent}` | いまのブロック深さに対応する字下げ |
| `${_depth}` | いまのブロック深さ（数値）。`_e${_depth}` のように一時変数名の衝突回避に使う |

**出力側が `${...}` を使う言語のときは `$\{` と書く**とリテラルの `${` になる
（Thymeleaf の `th:object="$\{form}"` → `th:object="${form}"`）。

ルールは**配列順に評価され、最初にマッチしたものが勝つ**。より限定的なルールを前に置く。

### ルール表の診断（書き間違いを黙って通さない）

プロファイルは `@JsonIgnoreProperties(ignoreUnknown = true)` で読み込まれる。ここに
「最初にマッチが勝つ」「`appliesToFile` 未指定は全ファイル」「未解決の `${...}` はそのまま出力に残る」が
重なると、**綴り間違いが例外にならず静かに違う出力になる**。`ProfileValidator` がそれを名指しする。

読み込みの寛容さは変えていない。**生のJSONを別に1回見て報告するだけ**であり、既存プロファイルは壊れない。
起動時はログに出すだけで**例外は投げない**（誤ったルール表でアプリが起動しなくなる方が運用上は困る）。
ビルドを止める役目は `ProfileDiagnosticsTest` と PF-18 が負う。

```bash
curl localhost:8081/api/templates/diagnostics                    # 全プロファイル
curl localhost:8081/api/templates/cobol-programs-v1/diagnostics  # 1本
```

| code | 見つけるもの |
|---|---|
| `unknown-field` | `appliesToFiles` のような綴り間違い。**宣言したつもりの効果が一切効かない** |
| `bad-regex` | 実行時まで気づけない不正な正規表現 |
| `unresolved-variable` | 生成物に `${xxx}` がそのまま出る書き間違い。`$\{` エスケープは誤検知しない |
| `unclosed-frame` / `unopened-frame` | `opens` と `closes` の片側が無い。`requires` 先の枠が誰も開けない |
| `shadowed-rule` | 前の同型ルールに食われて**一度も発火しない**ルール。`closes` も `requires` と同じだけ絞ることに注意 |
| `unknown-artifact` / `unknown-section` | `emitTo` / `section` の宛先が `artifacts` に無い |
| `unknown-group` | `continueWith` が存在しないグループを指している |
| `unknown-kind` | `structure` の `kind` の綴り間違い（`ignore` と同じ扱いになり黙って何もしない） |
| `unused-rule` | 実行結果と突き合わせて、一度も発火しなかったルール（`RuleUsageTest` が使う） |

**既知フィールドの一覧は模型クラスの setter から反射で取っている。** ここに手書きの名簿を作らないこと
（フィールドを1つ足すたびに2か所を直すことになり、ずれた瞬間に誤検知を出す仕組みになる）。

`reports/rule-usage.json` は「宣言したルールをコーパスが実際に通しているか」を残す。
**現在 `cobol-programs-v1` の37本中11本はどのケースにも当たっていない**（`compilable-v1` 14/14、
`struts-to-boot-v1` 36/36）。つまり対応を主張しているが動く証拠が無い。`RuleUsageTest` の
`KNOWN_UNEXERCISED` に1件ずつ理由を書いてあり、**新しく死んだルールが増えたら赤くなる**。
減らすときはルールを消すのではなくケースを足すこと。

### ルールの任意フィールド（宣言しなければ効かない）

| フィールド | 効果 |
|---|---|
| `opens` / `closes` | ブロック枠を積む／降ろす。**同じ `}` がメソッドかクラスかを見分けるのに使う** |
| `requires` | この種別が枠の一番上にあるときだけマッチ。「最初にマッチが勝つ」を**文脈依存**にする仕掛け |
| `binds` | `opens` と併用。枠に変数を束縛し、枠の中のルールから参照できる（EVALUATE の被検査値など） |
| `continueWith` | 描画後、指定グループの中身を改めて1行としてルール表へ通す（`WHEN 1 MOVE A TO B`） |
| `appliesToFile` | 入力ファイル名の正規表現。**未指定は「全ファイル」**。`Pattern.compile("")` にしてはいけない（空文字にしかマッチせず全ルールが黙って無効になる）。大小は区別する |
| `emitTo` / `section` | 出力先の成果物名と区画。`artifacts[].sections` の順に連結される |

### プロファイル単位の3つの表

| 表 | 役割 | 使うノード |
|---|---|---|
| `rules` | 行を変換する | `TransformNode` |
| `structure` | COBOLソースをプログラム／区画／段落へ切り分ける | `AnalyzeNode` |
| `facts` | 全入力ファイルを事前走査してファイル横断の変数を作る | `AnalyzeNode` |
| `artifacts` | 成果物ごとの骨組み（名前・区画順・前導・後尾） | `TransformNode` |

`structure` の**段落見出しルールは必ず最後に置き、`inSection: "procedure"` で限定する**。
`^名前\.$` は緩すぎて `GOBACK.` や `CONTINUE.` まで拾うので、
それらは `kind: "statement"` のルールで先に食わせておく。

### 生成ハーネスの取り決め

| 方式 | 生成される形 | テンプレートが従う約束 |
|---|---|---|
| 平坦（`compilable-v1`） | `generated.GeneratedProgram.run(Map,List)` | `vars.put(...)` / `num(...)` / `out.add(...)` |
| 段落（`cobol-programs-v1`） | 1プログラム=1クラス、ラベル配列＋ディスパッチャ | 上に加えて `perform(...)` / `stopRun()` / `goback()` / `return "ラベル";` |

形は `GeneratedProgramCompiler.buildSource()` と `buildProgramSource()` にある。

**段落方式のテンプレートで守ること**
- **`throw` を直接書かない。** 段落メソッド末尾の `return null;` が到達不能になり javac エラーになる。
  `STOP RUN` は `stopRun();`、`GOBACK` は `goback();` を呼ぶ
- **`STOP RUN` と `GOBACK` は別の信号。** 同じにすると副プログラムの `GOBACK` が主プログラムを止める
- **`EVALUATE` を `switch` にしない。** Javaは `double` で `switch` できず、`WHEN` にフォールスルーも無く、
  `EVALUATE TRUE` に対応物も無い。`if (false) {` を種にした `else if` 連鎖にする
  （JLS 14.21 が `if` の条件値を到達可能性判定に使わないので種はコンパイルできる）

`TemplateLibrary` はクラスパスと `transform.template-dir`（環境変数 `TRANSFORM_TEMPLATEDIR`）の両方から読み、**外部ファイルが同名の同梱プロファイルを上書きする**。再ビルドなしのルール追加はこの仕組みで成立している。

### 上流不具合の回避（消さないこと）

`liteflow-spring-boot4-starter:2.16.1` の公開JARは `-parameters` なしでコンパイルされている。Spring Framework 7 は `LocalVariableTableParameterNameDiscoverer` を削除したため、LiteFlow の actuator `@Endpoint` の `@Selector` 引数名を解決できず**アプリが起動しない**。

そのため:
- `application.properties` で `LiteflowMetricsAutoConfiguration` を `spring.autoconfigure.exclude`
- `config/LiteflowMetricsConfig` がメトリクスBeanを再登録（Prometheusメトリクスはこれで維持される）
- `controller/LiteflowMetaController` が `/actuator/liteflow[/ruledb]` を同じ `LiteflowMetaView` から提供

上流が `-parameters` 付きで再公開したら、この2クラスと exclude を削除してよい。

その他の踏んではいけない地雷:
- **実行イメージは JDK**（`eclipse-temurin:17-jdk`）。JRE では `ToolProvider.getSystemJavaCompiler()` が null を返し `CompileNode` が動かない
- **`ApiExceptionHandler` は `basePackages` で限定してある**。限定を外すと actuator も横取りし、`/actuator/prometheus` が `Accept: application/json` に対して 406 ではなく 500 を返すようになる
- **Jackson 2 と 3 が同居している**。Spring Boot 4 が自動設定するのは Jackson 3（`tools.jackson.databind`）。プロファイルのモデルは Jackson 2 アノテーションなので、`TemplateLibrary` は `ObjectMapper` を注入せず自前で生成している
- **`validator/validate.py` の `/actuator/prometheus` 取得は `Accept: text/plain`**。既定の `application/json` だとコンテントネゴシエーションで弾かれ、メトリクス検査が必ず失敗する
- **LiteFlow は履歴を持たない**。`lf_chain` / `lf_script` は発行のたびに本文を上書きし、`lf_change_log` はペイロードを持たない。履歴・差分・ロールバック・承認・監査は `rm_*` テーブル（`schema.sql`）で自前に持っている。**発行前に pre-image を取らないと前の版は永久に失われる**
- **ルールの書き込みは必ず `RulePublisher` 経由**（= `RuleAdminService` 経由）。`lf_chain` を直接書くと `lf_change_lock` の直列化と `lf_change_log` の採番を飛ばし、**各 Executor が変更に気づけない**
- **ロールバックは「戻す」のではなく「古い本文を前向きに再発行する」**。LiteFlow に版を戻す原語は無い。v3 から v2 へ戻すと v4 になる
- **Spring Security の適用範囲を広げてはいけない**。`/api/rules/**` と `/admin/**` だけを保護している。`/actuator/**`（Prometheus）と `/api/flows/**`（実行API）を保護すると、**validator の42項目・corpus-run・demo-transform を全部書き換えることになる**。広げるなら `SecurityConfig` と同時に `validator/validate.py` / `scripts/corpus-run.ps1` / `scripts/demo-transform.ps1` を直すこと
- **Spring Security 7 で `AntPathRequestMatcher` は削除された**。`csrf.ignoringRequestMatchers("/api/**")` のように文字列版を使う
- **CSRF は画面だけ有効で、トークンは cookie で渡している**。`/api/**` は除外（スクリプトと validator がトークン無しでPOSTする）。管理画面は素のHTMLなのでトークンを埋め込めず、`CookieCsrfTokenRepository.withHttpOnlyFalse()` ＋ **遅延生成の無効化**（`CsrfTokenRequestAttributeHandler#setCsrfRequestAttributeName(null)`）で静的ページの GET でも cookie が書かれるようにしてある。**遅延生成を戻すと `POST /admin/login` が認証の前に403になり、画面から入れなくなる**（B24）
- **承認フローはロール分離だけでは権限の境界にならない**。`admin` は APPROVER も持つので、「申請者本人は承認できない」判定（`SeparationOfDutiesException`）が必須。これが無いと APPROVER だけの利用者が ADMIN 無しで任意の本文を発行できる（B25）
- **発行の直前に pre-image を記録する**（`RuleGovernanceService#recordPreImage`）。消すと統制層の外で発行された版へ二度と戻せない。**統制層の外からの発行は実際に起きる**（JUnit・`RulePublisher` の直接利用）。ただし同じ版を二重に積まないこと
- **`rm_approval` の採番は JDBC の生成キーで受け取る**。`SELECT MAX(id)` に戻すと、`src/main` にトランザクションが無いため同時申請でidが入れ替わり、**承認者が別人の変更を反映する**（B27。修正前は8件同時で5〜6件が同じidを受け取った）
- **期待版は申請した時点で確定する**（`request()` が `expectedVersion` を必ず埋める）。承認時に読み直すと、**申請から承認までの間に入った別の変更を黙って巻き戻す**（B28）
- **承認・却下の状態遷移は条件付き UPDATE で行う**（`decideApprovalIfCurrentStatusIn`）。`requirePending` のような事前確認だけで守ろうとすると check-then-act になり、**反映済みなのに「未反映」と表示される**（B29）。`APPROVED`（承認済みだが未反映）からの再試行は許すこと — 塞ぐとその申請は永久に詰む
- **PowerShell の `@()` は splat ではない**（配列部分式）。`& script @($args)` は空配列を第1引数として渡し、`$BaseUrl` が空になる。**ハッシュテーブルで `@splat` する**（B30）
- **`static_compile.py` の `STUBS` キーは使う場所で区切りを正規化してある**。`\` 区切りのキーを POSIX でそのまま `Path` に渡すと1個の平坦なファイル名になり、**PF-09 が Linux/macOS で必ず落ちる**（B32）
- **「常に PASS を返す判定」を書かない**。`$ErrorActionPreference = "Stop"` のもとで `Invoke-WebRequest` は2xx以外で例外になるので、`$_.status -ne 200` は永久に偽になる。状態コードは例外から取り出して記録する（B33）。**見ていないものを PASS と呼ばない** — `-SkipRun` のときは `scope` の文言も変える
- **Thymeleaf を入れてはいけない**。既定のテンプレート探索パス `classpath:/templates/` が**変換ルールJSONの置き場と衝突する**。管理画面は `static/admin/` の素のHTML+JS
- **javac の in-process クラスパスにワイルドカードは使えない**。`dir/*` を展開するのは java/javac のランチャであって `StandardJavaFileManager` ではない。ディレクトリを渡されたら jar を1つずつ並べる（`CompileNode.extraClasspath()`）
- **`Path.of("*")` は Windows で例外**。ワイルドカードを組み立てるときは文字列連結で
- **Spring Boot 4.1 を `app/pom.xml` に足してはいけない**。本体は 4.0.6 で動いている。4.1 は「変換先の題材」であり、`app/boot41-classpath.pom.xml` で依存jarだけを集めて javac のクラスパスにしている
- **Grafana に人がログインしてパスワードを変えると `OBS-DASHBOARD` が落ちる**。validator は `admin`/`admin` で問い合わせる。`GF_SECURITY_ADMIN_PASSWORD` は**初期値にしか効かず**、変更後の値は `grafana-data` ボリュームに残るので環境変数を戻しても直らない。復旧は Grafana のボリュームだけ作り直す（`docker compose rm -sf grafana` → `docker volume rm liteflow-rule-db-validation_grafana-data` → `docker compose up -d grafana`）。**デモでログインするときはパスワード変更を Skip すること**
- **Prometheus を見る検査は必ずリトライで待つ**。`scrape_interval` は5秒で、Prometheus は対象ごとに取得タイミングをずらす。実行直後に1回だけ問い合わせると「片方のExecutorしか出ていない」という取得タイミング依存の偽FAILになる（`OBS-PROM` / `OBS-PROM-DATA` は30秒のデッドラインで待つ）
- **ポート占有チェックは自プロジェクトのコンテナを除外する**。`_common.ps1` の `Assert-PortsFree` は `docker compose ps --format json` の `Publishers[].PublishedPort` で自分の公開ポートを判定する。**保持プロセス名で判定してはいけない** — Docker Desktop のバックエンド次第で `com.docker.backend` だったり `wslrelay` だったりするため、スタックを起動したまま `validate.cmd` を再実行できなくなる

### 検証の証跡

**すべての判定はファイルに残す。** 画面出力だけで済ませない。
`reports/` の各JSONは `status` / `summary` / `scope`（何を証明し、何を証明していないか）を持つ。
`scope` は必ず書くこと — このPoCは「証明したこと」と「証明していないこと」の区別が最も重要な成果物である。

## スクリプトとレポートの規約

`tools/preflight.py` の PF-13 / PF-14 が構造を機械的に検査している。破ると preflight が落ちる。

**`.cmd`**（利用者が叩く入口。中身は薄くする）
- 先頭は `@echo off`、`setlocal` を含める、括弧の対応を取る
- `cd /d "%~dp0.."` でルートへ移動してから `powershell -File "%~dp0xxx.ps1"` を呼ぶ
- `run-all.cmd` だけは末尾に `pause`（ダブルクリック実行でウィンドウが閉じないため）

**`.ps1`**（実処理）
- 先頭は `$ErrorActionPreference = "Stop"`（`_common.ps1` はドットソース用ライブラリなので免除）
- 直後に `trap` を置き、`reports/*-failure.txt` に `status` / `failedAt` / `message` / `log` を書いてから `exit 1`。**失敗も必ずファイルに残す**
- ルート解決は `$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)` → `Set-Location $Root`。`trap` の中は `$PSScriptRoot` を使う（`$MyInvocation` が trap 内では別物になるため）
- ネイティブコマンドを呼ぶラッパ（`Invoke-Logged` 等）は**先頭で `$global:LASTEXITCODE = 0`**。最後の文がネイティブコマンドでないと前回の終了コードが残り、失敗を成功と誤判定する
- **`$ErrorActionPreference = "Stop"` のまま `ネイティブコマンド 2>&1 |` と書いてはいけない。**
  `docker` / `mvn` / `java -version` は進捗も警告も stderr へ書くので、その1行だけで
  `NativeCommandError` が終了エラーになり、**成功しているのに失敗と報告する**。
  対話コンソールでは再現しないことがあるため気づきにくい。ネイティブ呼び出しの間だけ
  `$ErrorActionPreference = "Continue"` に戻し（`try`/`finally` で必ず復帰）、
  **成否は `$LASTEXITCODE` だけで判定する**。`local-verify.ps1` / `install.ps1` / `validate.ps1`
  の3本がこれで壊れていた（B21）
- **`java -version`（ハイフン1本）は stderr へ書く。** 版数を読むなら JDK 9 以降の
  `java --version`（stdout）を使う
- **`Get-Content` の出力を `ConvertTo-Json` に渡す前に `[string[]]` へキャストする。**
  返ってくる文字列は PSObject に包まれ `PSPath` / `PSProvider` 等のメタプロパティを持ち、
  `PSProvider` 自身も own プロパティを持つため、**Windows PowerShell 5.1 の `ConvertTo-Json` が
  再帰展開して返ってこなくなる**（実測10分以上）。深さを下げても直らない。
  PowerShell 7 では起きないので **pwsh だけで確認していると気づけない**。
  `.cmd` は `powershell`（5.1）を呼ぶので、これで `corpus-run.cmd` と `run-all.cmd` が
  丸ごと固まっていた（B35）
- **スクリプトを直したら Windows PowerShell 5.1 でも回す。** `.cmd` の実体は 5.1 である。
  `Invoke-WebRequest` の戻り型も版で違う（5.1 は `BaseResponse.ResponseUri`、
  7 は `BaseResponse.RequestMessage.RequestUri`）ので、片方だけ見る判定を書かない
- `docker --version` / `docker compose version` は daemon 停止中でも成功する。**到達性の判定は `docker info`**（`Assert-DockerReady`）

**`.sh`**
- ルート解決は `ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`。変更したら `bash -n` を通す（PF-04）

**`reports/`**
- すべての判定結果は JSON + Markdown の両方で残す。JSON のキーは英語（`validator/validate.py` と各スクリプトが依存）
- 各 JSON は `status` / `summary` / `scope` を持つ
- PowerShell 5.1 の `Set-Content -Encoding UTF8` は BOM を付ける。Python 側で読むときは `utf-8-sig`

## 設定を変える場所

| 変えたいもの | 場所 |
|---|---|
| Chain の実行順・ノード構成 | Rule-DB（`POST /api/rules/chains`）。ファイルではない |
| ノードの中身（スクリプトノード） | Rule-DB（`POST /api/rules/scripts`）。Groovy。context の束縛名は `migrationContext` |
| 変換ルール（正規表現＋テンプレート） | `app/src/main/resources/templates/*.json`、または `TRANSFORM_TEMPLATEDIR` 配下の外部ファイル（再ビルド不要） |
| 同期間隔・インスタンスID・DB接続 | `docker-compose.yml` の environment（`RULE_DB_POLL_SECONDS` / `RULE_DB_RECONCILE_SECONDS` / `INSTANCE_ID`） |
| actuator の公開範囲・Rule-DB 設定 | `app/src/main/resources/application.properties` |
| 検証項目・閾値 | `validator/validate.py` |
| 期待する振る舞い | `corpus/families/<ファミリ>/cases/<ID>/output/behaviour.json` |

Rule-DB への公開はすべて `expectedVersion` による楽観ロック。競合は `VersionConflictException` → HTTP 409 になる。この経路を握り潰さないこと（`LOCK-01` が検査している）。

## コーパスの扱い

`corpus/families/<ファミリ>/cases/<ID>/` が `meta.json` / `input/`（変換元）/ `output/`（**期待する正解**）の3点セット。
**`output/` に実結果を書かないこと。** 実結果は `reports/` にしか出さない。

| ファミリ | 変換元 → 変換先 | プロファイル | 判定 | ケース |
|---|---|---|---|---|
| `cobol-statements` | COBOL 1文 → Java | `compilable-v1`（**凍結**） | 振る舞い | 12（負例2） |
| `cobol-programs` | COBOL プログラム群 → Java | `cobol-programs-v1` | 振る舞い | 4（負例1） |
| `struts-springboot` | Struts 1.3.10 → Spring Boot 4.1 | `struts-to-boot-v1` | ゴールデン差分＋実コンパイル | 3（負例1） |

`family.json` の `inputMode` が `single` なら `input/` の1ファイルを `sourceLines` で送り、
`multi` なら全ファイルを `sourceFiles` で送る。**`single` の分岐は既存12ケースの生成コードを
1バイトも変えないために残してある。**

**全19ケースは手書きの合成fixtureであり、実資産ではない。** 機構が動くことしか示さない。
`meta.json` の `expectQualityGate: "FAIL"` は**負例**で、落ちるのが正しい。
**各ファミリに負例が1件以上必要**（`preflight` の PF-17 が検査している）。

| 負例 | 落ちる理由 | それしか検出できないもの |
|---|---|---|
| `cobol-statements/11-uncovered-statements` | `PERFORM`/`EVALUATE` 未対応 → 未カバー率 | カバレッジ計上 |
| `cobol-statements/12-alphanumeric-if-gap` | **コンパイルは通るのに実行時に壊れる** | 振る舞いテスト |
| `cobol-programs/03-unsupported-statements` | `SORT`/`STRING`/`INSPECT`/`SEARCH` 未対応 | カバレッジ計上 |
| `struts-springboot/03-tiles-and-bean-write` | Tiles / `bean:write` / `ActionErrors` 未対応 | カバレッジ計上 |

**負例が PASS に変わったらゲートの退行。** そのルールを足したいなら、
別の未対応構文で負例を作り直してから足すこと。
ルール表を変更したら必ず `scripts\corpus-run.cmd` を回して、
`corpus-report.md` の**未カバー率**と負例4件の結果を確認する。

## やってはいけないこと

このPoCの価値は「証明したこと」と「証明していないこと」を厳密に分けている点にある。以下は成果物そのものを壊す。

- **変換ロジックをJavaに書く**。新しい構文への対応はルール表のJSONに1件足す。Javaを書いた時点で本PoCの主張が崩れる。可変長オペランドのように既存の変数では書けないものが出たら、**汎用の派生変数を1つ足す**（`${gList}` がその例）。個別構文をJavaに埋めない
- **ノードに変換・解析の意味を書く**。`RuleEngine` / `SourceAnalyzer` に置く。ノードに書いた時点で、確認手段が「Spring 起動込み25秒」に戻る
- **`snapshots/*.txt` を差分が出たから作り直す**。まず**なぜ変わったか**を説明できるようにする。説明できないなら退行である
- **Java の正規表現を Python の `re` で検査する**。名前付きグループの書き方が違い（Java `(?<n>)` / Python `(?P<n>)`）、正しいものを不正と言い、Java 専用構文を見逃す。両方向に間違える検査を足さない
- **`compilable-v1` を変更する**。凍結してある。あのプロファイルの未対応範囲が2つのゲートの試験体である
- **`hasSource()` / `hasGeneratedOutput()` を使わずガードを書く**。片方だけ見ると複数ファイル方式が動かないか、42項目のうち8項目が落ちる
- **通らないから閾値を下げる**。`maxUncoveredRate`、SLO の 5000ms / 500ms、品質ゲートの判定を「PASSさせるため」に緩めない。落ちているなら落ちていると報告する
- **負例を消す・PASSに変える**。`expectQualityGate: "FAIL"` の2件（`11-uncovered-statements` / `12-alphanumeric-if-gap`）はゲートが生きている証拠である
- **上流不具合の回避を「不要そうだから」消す**。`LiteflowMetricsConfig` / `LiteflowMetaController` / `spring.autoconfigure.exclude` / `ApiExceptionHandler` の `basePackages` / Dockerfile の `-jdk` — どれも消すと起動しないか検証が落ちる
- **変換対象が無いときにノードを動かす**。手順D（42項目）のオーケストレーション専用チェーンが壊れる
- **`corpus/**/output/` に実結果を書く**。あそこは「期待する正解」の置き場である
- **`reports/` の `scope` を省く／緩く書く**。「意味同値性は検証していない」「Struts側はテキスト差分にとどまる」は毎回明記する
- **判定の強さを混同して書く**。COBOL側（実行して照合）と Struts側（テキスト差分）を同じ言葉で書かない
- **認証範囲を黙って広げる**。validator と3スクリプトを同時に直さないと42項目が落ちる
- **画面出力だけで「動きました」と報告する**。判定はファイルに残ったものだけ

## 変更時のチェックリスト

| 変更したもの | 回すもの |
|---|---|
| ルール表（まず最速の確認） | `mvn -f app/pom.xml test -Dtest='RuleEngine*Test,ProfileDiagnosticsTest,RuleUsageTest'`（**1秒未満**。Docker も Spring も要らない） |
| Java・ルール表・スクリプト | `scripts\local-verify.cmd`（約30秒。81テスト） |
| ルール表 | 追加で `scripts\corpus-run.cmd`（**負例4件の退行を必ず確認**） |
| 生成骨格（`GeneratedProgramCompiler`） | `mvn -f app/pom.xml test -Dtest=GeneratedProgramHarnessTest`（ルール表を通さない土台） |
| ルール適用の規則（`RuleEngine`） | `mvn -f app/pom.xml test -Dtest=RuleEngineTest` → 続けて `CorpusSnapshotTest`（**スナップショットのバイト一致**） |
| ノードのガード・認証範囲 | `scripts\install.cmd` → `scripts\validate.cmd`（**42項目 PASS が正式判定**） |
| ファイル構成・スクリプト | `scripts\preflight.cmd` |
| Struts/Boot のサンプル | `scripts\samples-build.cmd` |
| 全体を見る | `scripts\summary.cmd` → `reports/summary.md` |

**`tools/preflight.py` への追随を忘れないこと**（飛ばすと preflight が FAIL ではなく**クラッシュ**する）。

| 追加したもの | 追随させる場所 |
|---|---|
| 必須ファイル | `required` 一覧（PF-01） |
| `scripts/*.cmd` | `cmd_files`（PF-13） |
| `scripts/*.ps1` | `ps_files`（PF-14）。`$ErrorActionPreference = "Stop"` を必ず書き、**括弧はコメントや文字列の中まで数えられる**ので対応を取る |
| Python ツール | PF-02 の `py_compile` 一覧 |
| 新しいJava API | `tools/static_compile.py` の `STUBS`（PF-09） |
| コーパスのファミリ／ケース | 自動検出されるが、`family.json` の必須キーと負例1件は PF-17 が要求する |
| ルール表のプロファイル | 自動検出されるが、id/pattern/template と id の一意性は PF-18 が要求する |

`MANIFEST.sha256` は現在失効している。再配布するなら再生成が必要。
