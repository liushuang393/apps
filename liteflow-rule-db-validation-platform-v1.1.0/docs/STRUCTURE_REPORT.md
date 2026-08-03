# LiteFlow Rule-DB PoC 構造レポート

- 作成日: 2026-08-01（P0実装とディレクトリ整理を 2026-08-02 に追記）
- 対象: `liteflow-rule-db-validation-platform` v1.1.0（デバッグ後）
- 実行環境: Windows 11 / Docker Desktop 29.6.2 / JDK 21.0.7 / Maven 3.9.11 / Python 3.13.0
- 正式判定の出典: `reports/validation-report.md`（runId `20260801T134112Z-8298294b`）

---

## 0. 結論

| 層 | 結論 | 証跡 |
|---|---|---|
| **① オーケストレーション層の設定化**（DBのchain ELを変えると実行順が変わる） | **成立** | `reports/validation-report.json` 42項目すべてPASS |
| **② 変換ロジックの設定化**（テンプレート／スクリプト／ルールを変えると生成コードが変わる。再デプロイなし） | **成立** | `reports/transform-demo.json` 3/3、外部ルールのホットロード実測、JUnit `RuleDrivenTransformTest` |
| **③ 生成コードがコンパイルでき、正しく動く**（生成→コンパイル→振る舞いテストの閉ループ） | **成立（3ファミリ規模）** | `reports/corpus-report.json` 19/19が期待どおり、振る舞い検査25/25、正例コンパイル15/15、ゴールデン一致6/6 |
| **③-b 複数ファイル・制御フローを含むCOBOLプログラム**（主1＋従2、分岐・ループ・GO TO・CALL） | **成立** | `cobol-programs` ファミリ 4/4、`GeneratedProgramHarnessTest` 15件 |
| **③-c Struts 1.3.10 → Spring Boot 4.1 の画面変換** | **成立（判定は弱い）** | `struts-springboot` ファミリ 3/3。**ゴールデン差分＋実コンパイルのみ。生成物を実行して確かめてはいない** |
| **⑤ ルール変更の統制**（履歴・差分・ロールバック・承認・監査・認証） | **成立** | `reports/validation-report.json` RM-01〜10、`reports/rule-admin-demo.json` 断言21/21 |
| **④ 実資産に対する意味等価性** | **未検証** | コーパスは手書きの合成fixtureであり実資産ではない。実期待Javaも本番入出力データも無い |

**「ルールを設定すれば変換できる」という筋は通っており、しかも今は計測できる状態になっている。**
生成コードは実際に javac でコンパイルされ、実際に実行され、期待値と項目単位で突き合わされる。未カバー率は正直に集計される。
残る差は機構の問題ではなく、**コーパスとルールライブラリの規模の問題**である（第6節）。

---

## 0-B. P0 実施結果（2026-08-02）

### P0-3 ルール／テンプレート表の外部化と版管理 ✅

`app/src/main/resources/templates/*.json`。1ルール = 正規表現（名前付きグループ）+ テンプレート + 版数／所有者／適用範囲／既知の穴。
名前付きグループから4つのテンプレート変数を自動派生する。`${g}` 原文、`${g}Java` Java安全形式、`${g}Expr` Java式、`${g}Mapped`（`maps.g` による変換。演算子に使用）。

**「再ビルドせずにルールを変えられる」ことを実測した。** プロファイルを `reports/external-templates/` へコピーし、
英数字比較用の `if-compare-alnum` ルール（`.equals()` を使う）を1件追加、`TRANSFORM_TEMPLATEDIR` を設定して**同じjar**で起動した。

```
profile       version owner          ruleCount source
compilable-v1      99 ops-hotfix            15 D:\...\reports\external-templates\compilable-v1.json
readable-v1         1 migration-team        13 classpath:templates/readable-v1.json
```

同じCOBOLに対し、以前は `num(vars.get("WS-NAME")) == num("ABC")`（実行時に例外）を生成していたものが、
`String.valueOf(vars.get("WS-NAME")).equals("ABC")` を生成するようになり、`qualityGate=PASS`、振る舞い検査1/1合格。
**再コンパイルもJavaの変更も一切していない。** `GET /api/templates` で有効な版数と読み込み元を確認できる。

### P0-4 語句カバレッジ 3 → 14ルール + 未カバー率 ✅

MOVE / ADD / ADD-GIVING / SUBTRACT / MULTIPLY / DIVIDE / COMPUTE（二項）/ COMPUTE（単項）/ IF / ELSE / END-IF / DISPLAY / CONTINUE / コメント。
`IF`・`ELSE`・`END-IF` は行単位のルールでJavaの波括弧を出力する。入れ子IFも実測で正しく動作（`08-if-nested` 3/3）。

未認識行は**捨てない**。計数とサンプリングを行い、`coverage.uncoveredRate` が毎回の応答とコーパスレポートに出る。
今回のコーパス全体の未カバー率は **8.00%（50行中4行）** で、その中身は負例の `PERFORM` / `EVALUATE` である。

### P0-2 CompileNode / TestNode / QualityGateNode を本物にする ✅

- `CompileNode`: `ToolProvider.getSystemJavaCompiler()` で**実際に javac を起動**。生成文を `Map<String,Object>` ベースの載体クラスで包む（DATA DIVISION の翻訳を先送りするため）。診断情報は行番号付きで返す
- `TestNode`: `URLClassLoader` でコンパイル結果を読み込み、**実際に実行**。`given` 入力に対して `expect` 出力を突き合わせる。数値は数値として比較し、`DISPLAY` 出力は別途捕捉して比較
- `QualityGateNode`: コンパイル失敗／振る舞い不一致／未カバー率超過で**例外を投げてチェーンを失敗させる**。findings は応答に載る
- **必要だったイメージ変更**: 実行イメージを `eclipse-temurin:17-jre` から **`17-jdk`** へ。JRE には javac が無く `getSystemJavaCompiler()` が null を返す。変更後も Docker E2E は 32/32 PASS のまま
- オーケストレーション専用チェーン（`sourceLines` を渡さない）では3ノードとも no-op になるため、既存の32項目（当時。現在は42項目）に影響しない

### P0-1 回帰コーパス ✅（ただし語料は合成）

`corpus/cases/<ID>/{source.cbl, cases.json, meta.json}`（当時の構成。現在は
`corpus/families/cobol-statements/cases/<ID>/{meta.json, input/, output/}`）。12ケースを完全なチェーン
`THEN(validate,analyze,transform,compile,test,qualityGate,report)` に通す。

**負例を2件含めているのが設計上の要点である。**
- `11-uncovered-statements`: `PERFORM` / `EVALUATE` が未対応 → **拒否されるのが正しい**。未カバー率80%、ゲートFAIL ✓
- `12-alphanumeric-if-gap`: 数値比較ルールが英数字比較の行を誤って引き受け、**コンパイルは通るのに実行時に NumberFormatException** になる → 振る舞いテストだけが検出できる。ゲートFAIL ✓

負例が通り始めたらゲートの退行なので、両方向を検査している。

⚠ **この12ケースはルール表を動かすために手で書いた合成fixtureであり、実COBOL資産ではない。**
証明できるのは**機構（生成→コンパイル→テスト）が正しく動くこと**だけで、実資産に対するカバレッジについては何も言えない。
実資産の投入方法は `corpus/README.md` に記載。

### コーパスが即座に暴いたルール欠陥 2件

コーパスを回した瞬間に、自分で書いたルールのバグが2件見つかった。これがコーパスの価値そのものである。
どちらも**コンパイルは通るが結果が誤っている**類で、振る舞いテストだけが検出できた。

1. **`compute-binary` がCOBOLの文終止符をオペランドに巻き込んでいた**: `COMPUTE WS-NET = WS-GROSS - WS-TAX.` で
   `(?<right>\S+)` が貪欲に `WS-TAX.`（句点付き）までマッチし、`vars.get("WS-TAX.")` が null になって結果が920ではなく1000になった。
   遅延量指定 `\S+?` + `\s*\.?\s*$` へ修正
2. **`compute-binary` がデータ名のハイフンを減算演算子と解釈していた**: `COMPUTE WS-TARGET = WS-SOURCE.` が
   `WS` 引く `SOURCE.` と解析された。演算子の両側に空白を必須とする `\s+([-+*/])\s+` へ修正（これはCOMPUTEに対するCOBOLの要件とも一致する）

---

## 1. 手順

詳細な手順は [`../README.md`](../README.md) の「手順索引」を参照。要約:

```bat
scripts\preflight.cmd       → reports\preflight-report.md    19/19 PASS
scripts\local-verify.cmd    → reports\local-verify.json      tests=78 failures=0
scripts\install.cmd         → reports\build-evidence.json    status=PASS
scripts\validate.cmd        → reports\validation-report.md   総合判定 PASS 42/0/0/0  ★正式判定
scripts\corpus-run.cmd      → reports\corpus-report.md       19/19 期待どおり（3ファミリ）
scripts\samples-build.cmd   → reports\samples-build.json     Struts/Boot 実ビルド＋画面HTTP200
scripts\rule-admin-demo.cmd → reports\rule-admin-demo.json   断言 15/15
scripts\summary.cmd         → reports\summary.md             全レポートを1枚に
powershell -File scripts\demo-transform.ps1  → reports\transform-demo.json  status=PASS
powershell -File scripts\stop.ps1
```

一括: `scripts\run-all.cmd`（= preflight + install + validate + 各デモ + summary）

### 設定の所在

| 設定項目 | 場所 |
|---|---|
| DB接続、インスタンスID、ポーリング／リコンサイル周期 | `docker-compose.yml` の `environment` |
| LiteFlow Rule-DB の有効化、テーブル自動作成、actuator公開範囲 | `app/src/main/resources/application.properties` |
| **業務ルールそのもの（chain EL、scriptノードのソース）** | **MariaDB の `lf_*` テーブル**。`POST /api/rules/chains` と `/api/rules/scripts` で更新 |
| **変換ルール表・テンプレート** | `app/src/main/resources/templates/*.json`、または `TRANSFORM_TEMPLATEDIR` の外部ディレクトリ |

---

## 2. アーキテクチャ

```text
       POST /api/rules/chains          POST /api/rules/scripts
       （実行順）                       （ノードのロジックそのもの）
                  \                    /
                   v                  v
          +--------------------------------------+
          |  MariaDB 11.4.12  —  Rule-DB 正本     |   ← LiteFlow 提供
          |  lf_* テーブル: rule / script / 変更履歴 |
          |  version（楽観ロック）+ sequence        |
          +------------------+-------------------+
                             |
                   poll(1s) + reconcile(10s)      ← LiteFlow 提供
                        +----+----+
                        |         |
                        v         v
                 Executor A   Executor B          ← 本PoCの自作（Spring Boot 4.0.6）
                 :8081        :8082
                        |         |
                        +----+----+
                             |
                   Micrometer / liteflow.*         ← LiteFlow 提供（liteflow-metrics）
                             |
                      Prometheus v3.13.1
                             |
                      Grafana 13.1.1（自動プロビジョニング）
```

**LiteFlow が提供するもの**: Rule-DB のストレージと同期、RulePublisher（楽観ロック）、スクリプトノードエンジン、メトリクス計装、actuatorビュー。
**本PoCの自作**: REST入口（公開／実行）、実行コンテキスト、11ノード、ルール表エンジン、javac起動、振る舞いテスト、検証スクリプト、レポート生成。

---

## 3. コード構成

```text
app/src/main/java/jp/co/softroad/liteflow/     26クラス
├── LiteFlowValidationApplication.java          起動クラス
├── config/
│   └── LiteflowMetricsConfig.java              上流不具合の回避（4.1参照）
├── controller/                                 6件
│   ├── RuleController.java                     POST /api/rules/chains、/api/rules/scripts
│   ├── ExecutionController.java                POST /api/flows/{id}/execute
│   ├── TemplateController.java                 GET  /api/templates[/{name}]
│   ├── InstanceController.java                 GET  /api/instance
│   ├── LiteflowMetaController.java             /actuator/liteflow[/ruledb]
│   └── ApiExceptionHandler.java                409/400/406/500 のマッピング（作用域を限定済み）
├── model/                                      7件
│   ├── MigrationContext.java                   trace + sourceLines/templates/generatedLines
│   │                                           + coverage/compile/tests/qualityGate
│   ├── ExecutionRequest / ExecutionResult.java
│   ├── PublishChainCommand / PublishResultView
│   └── PublishScriptCommand / PublishScriptResultView
├── node/                                       11件
│   ├── AbstractTraceNode.java                  trace記録の基底
│   ├── TransformNode.java                      ルール表駆動の変換
│   ├── CompileNode.java                        javacを実起動
│   ├── TestNode.java                           生成コードを実行して期待値と比較
│   ├── QualityGateNode.java                    失敗時にチェーンを落とす
│   ├── ForcedFailureNode.java                  意図的に例外（失敗チェーン検証用）
│   └── Validate / Analyze / Review / Report / Slow   ← trace記録のみ
├── transform/                                  8件（ルール表エンジン）
│   ├── TemplateProfile / TransformRule.java    プロファイルとルールのモデル
│   ├── TemplateLibrary.java                    classpath + 外部ディレクトリからの読み込み
│   ├── TemplateRenderer.java                   名前付きグループ → 4変数 → 描画
│   ├── GeneratedProgramCompiler.java           載体クラス生成 + javac起動
│   ├── CoverageSummary.java                    認識/未認識の集計
│   ├── CompileOutcome.java                     javac結果と診断
│   └── BehaviourExpectation.java               振る舞い期待値と結果
└── service/
    └── RuleAdminService.java                   RulePublisher ラッパ（publishChain / publishScript）

app/src/test/java/…                             3クラス
├── RuleDbPlatformIntegrationTest.java          公開/実行/更新/版数競合/失敗チェーン
├── RuleDrivenTransformTest.java                テンプレートとDBスクリプトで生成コードが変わる
└── TransformPipelineTest.java                  生成→コンパイル→振る舞いテストと品質ゲート

scripts/     22ファイル（.cmd / .ps1 / .sh）  ※ルート直下から scripts/ へ移動済み
corpus/      12ケース × 3ファイル
tools/       preflight.py（17項目の静的検査）、static_compile.py（stubによる型チェック）
validator/   validate.py（Docker E2E検証とレポート生成）、test_validate.py
docs/        本レポートを含む技術文書
```

---

## 4. デバッグで発見し修正した問題

### 4.1 【上流不具合・ブロッカー】LiteFlow 2.16.1 の actuator エンドポイントでアプリが起動しない

- **現象**: `Failed to extract parameter names for ... LiteflowEndpoint.chains(java.lang.String)` で ApplicationContext の初期化が失敗する
- **原因**: Maven Central 上の `liteflow-spring-boot4-starter:2.16.1` が **`-parameters` なしでコンパイルされている**（`javap -v` で `MethodParameters` 属性が無いことを確認）。一方 Spring Framework 7 は `LocalVariableTableParameterNameDiscoverer` を削除しており、`@Selector` の引数名を解決できない
- **回避策**: `spring.autoconfigure.exclude` で `LiteflowMetricsAutoConfiguration` を除外。メトリクスBeanは `config/LiteflowMetricsConfig` で元のまま再登録。`/actuator/liteflow[/ruledb]` は `controller/LiteflowMetaController` が**同じ `LiteflowMetaView`** から提供するため、パスもJSONも変わらない
- **今後**: 上流が `-parameters` 付きで再公開したらこの2クラスは削除できる。**dromara/liteflow へ issue を上げることを推奨**

### 4.2 【検証器の不具合】`Accept: application/json` によりメトリクス検査が必ず失敗していた

- **現象**: `OBS-MET-A` / `OBS-MET-B` が `metricCount: 0` を報告する一方、Prometheus には `liteflow_*` の時系列が20本存在していた
- **原因**: `validator/validate.py` の `http()` が全リクエストに `Accept: application/json` を送っていたが、`/actuator/prometheus` は `text/plain;version=0.0.4` しか produce しないためコンテントネゴシエーションで失敗していた
- **修正**: 当該リクエストのみ `Accept: text/plain;version=0.0.4,*/*` を送る
- **補足**: 配布環境に Docker が無くE2Eが一度も実行されていなかったため、この不具合は今まで表面化していなかった

### 4.3 【アプリの不具合】グローバル例外ハンドラが 406 を 500 に変えていた

- **原因**: `ApiExceptionHandler` が作用域を限定しない `@RestControllerAdvice` であり、**actuator のエンドポイントまで横取り**していた。catch-all の `Exception` 分岐が `HttpMediaTypeNotAcceptableException` を 500 に変換していた
- **修正**: `basePackages = "jp.co.softroad.liteflow.controller"` で限定し、`HttpMediaTypeNotAcceptableException` を明示的に 406 として処理

### 4.4 【構成の不具合】MariaDB だけ再起動ポリシーが無かった

- **現象**: 検証後に MariaDB コンテナが停止したまま残り、`restart: unless-stopped` を持つ Executor 2台が延々と再起動を繰り返していた
- **原因**: `docker-compose.yml` で MariaDB だけ `restart` 指定が抜けていた
- **修正**: 他サービスと同じ `restart: unless-stopped` を追加

### 4.5 健壮性の欠陥一覧

| ID | 問題 | 状態 |
|---|---|---|
| B1 | `install.ps1`／`validate.ps1`／`.sh` が `docker` と `docker compose version` しか確認していない（daemon停止時も**成功してしまう**）。実際の失敗はイメージ取得まで先送りされ、エラーは npipe の生メッセージだった | ✅ 修正済: `scripts/_common.ps1` の `Assert-DockerReady` が `docker info` で明示的に探知し、日本語で案内する。`.sh` にも `docker info` を追加 |
| B2 | `install.ps1` の `(docker create …).Trim()` は失敗時の出力が `$null` のため `.Trim()` が先に NullReferenceException を投げ、本来のdockerエラーを覆い隠していた | ✅ 修正済: 終了コードと空文字を確認してから Trim する |
| B3 | ポート衝突時に `Wait-Http` が90回（約3分）空回りしてから失敗し、しかもタイムアウト時に Prometheus/Grafana のログを出していなかった | ✅ 修正済: `Assert-PortsFree` が「ポート → プロセス名/PID」を列挙して即座に失敗する（本プロジェクト自身のコンテナは許容）。ログ出力に prometheus/grafana を追加 |
| B4 | `Invoke-Logged` 内の `$LASTEXITCODE` が古い値の可能性があり、失敗を成功と誤読しうる | ✅ 修正済: 呼び出し前にリセット |
| B5 | validator は FAIL があると終了コード1を返すが「Command failed」と報告されていた。実際にはレポートが生成済みでそれこそ読むべきもの | ✅ 修正済: `Invoke-Validator` で個別処理し、`validation-report.md` を見るよう案内 |
| B6 | `validator/validate.py` が `REPORT_DIR = /reports` をハードコードしており、コンテナ内でしか動かなかった | ✅ 修正済: `REPORTS_DIR` 環境変数で上書き可能（コンテナでの挙動は不変） |
| B7 | 毎回 `docker compose pull` と `build --pull` を実行し、ローカルに存在してもネットワークアクセスしていた | ✅ 修正済: イメージが存在すればスキップ。`-Force` / `INSTALL_FORCE=1` で強制取得 |
| B8 | Dockerfile に Maven リポジトリのキャッシュが無く、`pom.xml` を変えるたびに依存ツリー全体を再取得していた | ✅ 修正済: 3か所の `mvn` すべてに `--mount=type=cache,target=/root/.m2/repository` を付与（3か所すべてに必要。そうしないとフォールバック分岐で install した LiteFlow モジュールが後続から見えない） |
| B9 | `MANIFEST.sha256` / `STATIC_VALIDATION_REPORT.*` が変更後に失効する | ⚠️ **未修正**: `MANIFEST.sha256` は失効している。`scripts/preflight.cmd` は `reports/preflight-report.*` を再生成するが、再配布するなら MANIFEST の再計算が必要 |
| B10 | PowerShell 5.1 の `Set-Content -Encoding UTF8` が BOM を書く | ⚠️ **対応せず**: validator は JSON を `utf-8-sig` で読むため回避済み。テキスト証跡のBOMは実害が無い |
| B11 | 11ノードすべてが trace 記録だけの空実装で、実際の変換を一切していない | ✅ 解決: `TransformNode` はルール表駆動の実変換、`CompileNode`/`TestNode`/`QualityGateNode` は実動作になった。`Validate`/`Analyze`/`Review`/`Report`/`Slow` の5件は引き続き trace 記録のみ（第6節参照） |
| B12 | B3 の修正で入れた自プロジェクト判定が**ポート保持プロセス名**（`*docker*`）で行われており、Docker Desktop の WSL2 バックエンドでは保持プロセスが `wslrelay` になるため判定が外れる。スタックを起動したまま `validate.cmd` を再実行できなかった | ✅ 修正済: `docker compose ps --format json` の `Publishers[].PublishedPort` から自プロジェクトの公開ポート集合を作って除外する（プロセス名に依存しない） |
| B13 | `OBS-PROM-DATA` が Chain 実行直後に Prometheus へ1回だけ問い合わせていた。`scrape_interval` は5秒で対象ごとに取得タイミングがずれるため、片方のExecutorしか出ておらず取得タイミング依存で偽FAILになる | ✅ 修正済: 隣の `OBS-PROM` と同じく30秒デッドラインのリトライで2インスタンス分そろうまで待つ |
| B14 | `PROCEDURE DIVISION USING` を構造規則の `using` として処理していたが、**区画の切り替えを行っていなかった**。そのため副プログラムでは以降の段落見出しが1つも認識されず、プログラムがまるごと消え、呼び出し側が「`generated.SUBTAX` というクラスが無い」でコンパイル失敗していた | ✅ 修正済: `using` でも `section` を `procedure` へ移す |
| B15 | `MOVE 0 TO X` が素の整数リテラルを格納し、`ADD` は `double` を格納していた。同じ項目でも DISPLAY の出力が `"0"` と `"550.0"` で変わる | ✅ 修正済: 数値リテラルの MOVE 専用ルールを追加し `num()` を通して `double` に統一 |
| B16 | `EVALUATE` の `WHEN` が `{` を開くだけで閉じておらず、2つ目の `WHEN` で構文エラーになる生成コードを出していた | ✅ 修正済: 種を `if (false) {` にし、各 `WHEN` が `} else if (...) {` を出す形へ。`END-EVALUATE` が `} }` で閉じる |
| B17 | `CompileNode` が javac のクラスパスに `dir/*` を渡していた。**ワイルドカードを展開するのは java/javac のランチャであって in-process の `StandardJavaFileManager` ではない**ため、Spring Boot 4.1 の型が一切解決できなかった | ✅ 修正済: ディレクトリを渡されたら jar を1つずつ列挙する |
| B18 | 同じ箇所で `Path.of("*")` を組み立てており、Windows で `InvalidPathException`。しかも `CompileNode` から例外が飛んで品質ゲートまで届かず、レポートに理由が残らない `NOT_EVALUATED` で終わっていた | ✅ 修正済: ワイルドカードは文字列連結で作る。コンパイル準備の失敗は例外ではなく `CompileOutcome` の失敗として報告する |
| B19 | `SecurityConfig` が `/api/rules/**` を `authenticated()` だけで守っており、**参照専用ユーザー（viewer）が発行できていた**（201）。しかもその発行のせいで後続の履歴・差分・ロールバック・承認・監査の検査が連鎖的に失敗し、原因が5項目に散っていた | ✅ 修正済: HTTPメソッド別に権限を分離（GET=認証済み / POST・PUT・DELETE=ADMIN / 承認=APPROVER）。あわせて validator 側も、発行できなかった時点で以降を「判定不能」として1件で打ち切るようにした |
| B20 | `transform-demo.json` の `assertions` に `applicationRestarted: false` / `applicationRebuilt: false` が混ざっていた。これは事実の記録であって合否条件ではないため、サマリ集計で「断言 3/5」と失敗に見えた | ✅ 修正済: `facts` へ分離 |
| B21b | 同じ stderr 由来の問題が `install.ps1` の `Invoke-Logged`、`validate.ps1` の `Invoke-Logged` と `Invoke-Validator` にもあった。`docker compose build` / `docker compose up` / `docker compose run` は進捗を stderr へ書くため、**イメージ構築も検証も成功しているのに `NativeCommandError` で落ちていた**。しかも `trap` が拾うのは最後のエラーレコードなので、失敗レポートに `message= Container ...mariadb-1 Running` という無関係な文が残り、原因が読み取れなかった | ✅ 修正済: 3か所すべてで、ネイティブ呼び出しの間だけ `$ErrorActionPreference = "Continue"` に戻す（`try`/`finally` で復帰）。成否は `$LASTEXITCODE` だけで判定する |
| B21 | `local-verify.ps1` が `java -version 2>&1` を使っていた。**`-version`（ハイフン1本）は stderr へ書く**ため、`$ErrorActionPreference = "Stop"` のもとで `NativeCommandError` が終了エラーになり、対話コンソール以外では必ず落ちる。続く `mvn ... 2>&1 \| Tee-Object` も同じ理由で、Mockito の self-attach 警告1行だけで**ビルド成功を失敗と報告**していた | ✅ 修正済: `java --version`（stdout）に変更。mvn の呼び出しはその間だけ `$ErrorActionPreference = "Continue"` に戻し、成否は `$LASTEXITCODE` で判定する |
| B22 | 新設した PF-18 で Java の正規表現を Python の `re.compile` に通してしまい、**同梱プロファイル4本すべての名前付きグループが「不正」と報告された**（Java は `(?<n>)`、Python は `(?P<n>)`）。逆に Java 専用構文は見逃す | ✅ 修正済: 正規表現の検査を PF-18 から外した。**両方向に間違える検査は置かない**。妥当性は本物の `java.util.regex.Pattern` を使う `ProfileDiagnosticsTest` が見る |
| B23 | 同じく新設の `shadowed-rule` 診断が、`requires` だけを「絞り込み」として数えていたため、`struts-to-boot-v1` の正しい書き方（同じ `^\}$` に `closes: block` と `closes: method` を並べ、枠スタックでメソッドとクラスの閉じ括弧を見分ける）を**誤って死んだルールと断定**した | ✅ 修正済: `closes` も `requires` と同じだけ絞ることを判定に入れた（`RuleEngine.frameAllows` と同じ規則） |

**B21〜B23 の共通点。** どれも「検査そのものが間違っている」型である。B22・B23 は導入したその日に
同梱プロファイルが赤くなって気づけた。**新しい検査を足すときは、既に正しいと分かっているものへ
最初に当てること** — 誤検知する検査は使われなくなり、無いのと同じになる。

### 4.6 検査の死角から出てきた欠陥（B24〜B27）

コードレビューで指摘され、いずれも**実際にコードに当てて再現を確認**したうえで直した。
**4件とも「42項目が全部PASSしている状態で成立していた」**という点が重要である。

| # | 欠陥 | なぜ検査を素通りしたか | 対応 |
|---|---|---|---|
| B24 | **管理画面にブラウザからログインできなかった。** CSRF の除外は `/api/**` だけで、`/admin/login` は素の静的HTMLフォーム（`_csrf` を出す仕組みが無い。Thymeleaf は設計上入れていない）。`CsrfFilter` が認証の前に403で弾く。ログアウトも同じ403で、しかも応答を捨てて無条件に遷移するため**画面上はログアウトしたのにセッションは生きたまま**だった | validator の42項目・各スクリプトが**すべて HTTP Basic 認証**で叩いており、フォームログインの経路をどの検査も通っていなかった | ✅ 修正済: CSRFトークンを cookie で払い出し（`CookieCsrfTokenRepository.withHttpOnlyFalse()`）、遅延生成を切って静的ページの GET でも cookie が書かれるようにした。画面側は cookie から `_csrf` / `X-XSRF-TOKEN` を載せる。**`/api/**` の除外は変えていない**。`AdminUiSecurityTest`（10件）と `rule-admin-demo.ps1` の 7c で守る |
| B25 | **`APPROVER` だけを持つ利用者が `ADMIN` 無しで任意の本文を発行できた。** 申請は認証済みなら誰でも出せ、承認は `APPROVER` が通せ、承認は即発行する。申請者と承認者を比べる処理が無かったため「自分で申請して自分で承認」が通り、`POST /api/rules/**` の `hasRole("ADMIN")` が実質無効だった | RM-07 は admin が申請し approver が承認する**正しい順序しか試していなかった**。誤った順序を試す検査が無かった | ✅ 修正済: `SeparationOfDutiesException`（403）。却下は自分の申請にも許す（取り下げ）。RM-09 と `RuleGovernanceTest` で守る |
| B26 | **統制層の外で発行された版へロールバックできなかった。** pre-image を取得しておきながら監査の動詞を選ぶためだけに使い、履歴には post-image しか記録していなかった。LiteFlow は上書き保存なので、その版の本文は**発行の瞬間に永久に失われていた** | HTTP 経由の発行はすべて統制層を通るため、**この状況を validator から作れない**。JUnit だけが `RulePublisher` を直接使う | ✅ 修正済: 発行の直前に pre-image を記録（同じ版は二重に積まない）。`RuleGovernanceTest` で守る。42項目側は RM-10 で「二重記録しない」ことだけを見る — 作れない状況を検証したふりはしない |
| B27 | **同時申請で申請IDが入れ替わった。** INSERT の後に `SELECT MAX(id)` を別文で撃っており、`src/main` にトランザクションが1つも無い。申請者は他人の申請のidと本文を受け取り、承認者はそれを承認して**意図しない変更を反映**しうる | 検証が常に逐次で、同時実行を試していなかった | ✅ 修正済: JDBC の生成キーで採番。8スレッド同時申請のテストを追加（**修正前は 8件中5〜6件が同じidを受け取ることを実測**） |

**B24〜B27 の共通点。** どれも**検査の書き方が作らない状況**にあった —
別の認証方式（フォーム）、誤った操作順序（自己承認）、統制層の外からの発行、同時実行。
42項目が全部緑でも、**その42項目が踏まない道は守られていない**。
`scope` に「何を証明していないか」を書く習慣がここでも効いた。

---

## 5. 実測結果

### 5.1 静的事前確認 `reports/preflight-report.md`
**17 / 17 PASS**（Docker Compose config、stubによるJava型チェック 99クラス / 90ソースを含む）

### 5.2 ホストビルド `reports/local-verify.json`
`status=PASS`、`tests=6 failures=0 errors=0`、所要約17秒（依存キャッシュ済み）

### 5.3 Dockerビルド `reports/build-evidence.json`
```json
{"status":"PASS","image":"liteflow-rule-db-validation-app:1.0.0",
 "imageId":"sha256:…","mavenCommand":"mvn -B -ntp clean verify"}
{"liteflowVersion":"2.16.1","resolutionMode":"maven-central","sourceCommit":null}
```
LiteFlow 2.16.1 は **Maven Central から直接解決**され、GitHubソースビルドのフォールバックは使われていない。

### 5.4 Docker E2E `reports/validation-report.md`（正式判定）

**総合判定 = PASS ／ 32 PASS / 0 FAIL / 0 WARN / 0 SKIP ／ 推奨 = CONTINUE_TO_DOMAIN_POC**

検証範囲: ビルドとJUnit証跡、Executor2台のヘルス、chain v1公開と2ノード実行、chain v2更新と収束、楽観ロック競合の拒否(409)、失敗チェーン検出、連続30回、並列50回、2ノードのRule-DB snapshot、2ノードのLiteFlowメトリクス、Prometheusによる2ターゲットのスクレイプと実測値、Grafanaのヘルスとダッシュボード自動登録、Executor B再起動後のDBからの再ロードと実行。

| 指標 | 実測 | 閾値 |
|---|---:|---:|
| chain v2 の Executor B への収束時間 | **470.92 ms** | 5000 ms |
| HTTP実行遅延 p50 / p95 / max | **11.39 / 24.21 / 30.99 ms** | p95 ≤ 500 ms |
| 連続実行成功率 | **30 / 30** | 30 |
| 並列実行成功率（10スレッド） | **50 / 50** | 50 |
| Executor B 再起動後の再ロードと実行 | **341.6 ms** | — |

### 5.5 変換デモ `reports/transform-demo.json`

`status=PASS`、3つの断言すべて成立。**全工程で再起動・再ビルド・再デプロイなし。**

| 段階 | 変更したもの | 生成コード |
|---|---|---|
| A1 | （ベースライン） | `WS-OUT-NAME = WS-CUSTOMER-NAME;` / `WS-RECORD-COUNT += 1;` / `System.out.println('MIGRATION DONE');` / `// TODO unsupported: PERFORM…` |
| A2 | **テンプレート表のみ差し替え** | `this.WS-OUT-NAME = this.WS-CUSTOMER-NAME;   // COBOL MOVE` / `log.info("{}", …);` / `// [MANUAL REVIEW REQUIRED] …` |
| B1 | **Rule-DBへGroovyスクリプトノード追加** + chain EL変更 | `// migrated by rule-db script v1` を追記 |
| B2 | **スクリプト本文のみ変更**（chainもjarも不変） | `// migrated by rule-db script v2` / `// statements generated: 4` / `// reviewed: true` を追記 |

**ノード跨ぎの確認**: スクリプトは Executor A(:8081) で公開し、その後 Executor B(:8082) に直接リクエストしたところ、B は
`trace = [validate, transform, postProcess, report]`、
`generatedCode = "WS-B = WS-A;\n// migrated by rule-db script v2\n…"` を返した。
**B にはこのスクリプトを一度も伝えておらず、Rule-DB 経由で自動同期して取り込んでいる。**

### 5.6 コーパス回帰 `reports/corpus-report.md`

**status = PASS ／ 12 / 12 ケースが期待どおりの挙動**

| 指標 | 実測 |
|---|---:|
| ケース数 | 12（正例10 / 負例2） |
| 期待どおりの挙動 | **12 / 12** |
| 正例のコンパイル成功（実javac） | **10 / 10** |
| 振る舞い検査の合格（実実行 + 比較） | **17 / 17** |
| 処理したCOBOL行数 | 50 |
| 未カバー行数 | 4 |
| **全体の未カバー率** | **8.00%** |

ルール別の命中数: `move` 14、`if` 6、`else` 5、`end-if` 5、`comment` 4、`display` 2、`add` 2、`compute-binary` 2、`multiply`/`divide`/`subtract`/`add-giving`/`compute-copy`/`continue` 各1。

Docker 2ノード構成（8081 / 8082）とホスト単一インスタンス（H2）の双方で同じ結果。

---

## 6. 次にやること

> 想定10シナリオのどこまで届いたか（**実証5／部分実証2／未着手3**）と、シナリオ別に次にやる実験は
> [`README.md` の「1. 目的と、今回検証したシナリオ」](../README.md#1-目的と今回検証したシナリオ) にまとめてある。
> 本節は変換パイプライン（層②③）に絞った次の一手である。

### 2026-08-03 の追加分（シナリオ#3・#5 を端から端まで）

| 追加したもの | 中身 | 証跡 |
|---|---|---|
| **COBOL 複数ファイル変換**（#5） | 主1＋従2の3ファイル。`WORKING-STORAGE VALUE` / `LINKAGE` / `PROCEDURE DIVISION USING` / 段落 / `IF`・`EVALUATE` / `PERFORM`（段落・THRU・UNTIL・TIMES・VARYING・行内）/ `GO TO` / `CALL USING` / `GOBACK` / `STOP RUN`。1プログラム=1Javaクラス、段落はラベル配列＋ディスパッチャ | `cobol-programs` 4/4、`GeneratedProgramHarnessTest` 15件 |
| **Struts 1.3.10 → Spring Boot 4.1**（#5） | Action/ActionForm/struts-config.xml/JSP の4種類 → @Controller/フォームBean/Thymeleaf の3種類。ルール表に `facts`（ファイル横断変数）と `artifacts`（成果物骨組み）を追加。両側とも実際にビルドできる本物のプロジェクト | `struts-springboot` 3/3（ゴールデン6/6）、`samples-build.json`（画面HTTP200） |
| **ルール管理基盤**（#3） | `rm_rule_revision` / `rm_approval` / `rm_audit` の3テーブル、REST一式、Spring Security（管理系のみ保護・3ロール）、管理画面4枚 | `validation-report` RM-01〜10、`rule-admin-demo.json` 断言21/21 |
| **コーパスのファミリ化** | `corpus/families/<家族>/cases/<ケース>/{meta.json, input/, output/}`。`preflight` PF-17 が構造と負例の存在を強制 | `preflight-report` PF-17 |

**ここで露呈した設計上の学び**（詳細は 4.5 の B14〜B20）
- **判定の強さは領域で違う。** COBOL は生成物を実行して照合できるが、Web は実行入口が無く
  テキスト差分にとどまる。同じ言葉で報告すると読者を誤らせる
- **`compilable-v1` は凍結が正解だった。** 新構文を足せば負例2件と JUnit のゲートが同時に壊れる。
  ルールライブラリは「育てる1本」ではなく「用途別に分ける複数本」として扱うべきである
- **`EVALUATE` は `switch` に落とせない。** Java の言語制約（`double` で switch 不可、
  `WHEN` にフォールスルー無し、`EVALUATE TRUE` に対応物無し）が3つ重なる
- **`STOP RUN` と `GOBACK` は別の信号でなければならない。** 同一視すると副プログラムの
  `GOBACK` が主プログラムを止める。CALL を扱う前に骨格側で決着させる必要があった
- **認証は「範囲を狭く保つ」ことが検証の維持に直結する。** 実行APIと actuator を無認証に
  留めたおかげで既存32項目を1つも書き換えずに済んだ

### P0 — 「変換」をデモから評価可能なものにする → **完了（第0-B節）**

1. ~~実語料と判定基準の準備~~ → **機構は整ったが語料は依然として合成である**。`corpus/` の構造、`cases.json` の振る舞い期待値の書式、一括実行とレポートは使える状態になった。**足りないのは実資産そのものだけ**であり、これが現時点で最大かつ、こちらでは代替できない項目である。実COBOLプログラム50本以上 + 業務担当者が確認した期待Java + 本番バッチから採取した入出力データ
2. ~~`CompileNode` / `TestNode` を本物にする~~ → **完了**（実javac + 実実行 + 実比較、実行イメージをJDKへ変更）
3. ~~テンプレートライブラリの外部化と版管理~~ → **完了**（14ルールのJSONプロファイル、版数／所有者／既知の穴付き、外部ディレクトリのホットロードを実測）
4. ~~語句カバレッジ拡張と未カバー率~~ → **完了**（3 → 14ルール、未カバー率をレポートへ）

### P0完了後に新たに浮上した次の一手（実語料を入れると即座に当たる）

いずれも `corpus/*/meta.json` の `knownGaps` に既に明記してある。当たる確率の高い順:

1. **ルールライブラリの規模**: 14ルールでは実プログラムを1本もカバーできない。実語料の**文出現頻度順**に1件ずつ追加し、追加のたびに `scripts\corpus-run.cmd` を回して未カバー率の低下を測る
2. **数値の意味**: 載体クラスは現在 `double` を使っている。COBOL の COMP-3 や `PIC 9(7)V99` は定点十進であり、金額計算で実際に差が出る。`BigDecimal` へ切り替えるか、既知の非等価点として明示するかを決める
3. **ブロック構造**: `IF` は行単位で波括弧を出力しているだけで、ブロック構造の検証をしていない。句点終端の `IF`（`END-IF` なし）は不均衡な波括弧を生み、分かりにくいコンパイルエラーになるだけである。軽量なブロック状態機械が要る
4. **DATA DIVISION**: 現在は Map 載体で完全に回避している。実プログラムではフィールド宣言、階層（`OCCURS`、`REDEFINES`）、初期値が必要になる
5. **制御フロー**: `PERFORM`（段落呼び出し / `UNTIL` / `VARYING`）と `EVALUATE` は実COBOLの骨格だが**1件も対応していない**。負例11が監視しているのがまさにこれである
6. **英数字比較**: `if-compare` が英数字比較の行を誤って引き受ける。ホットロード実験で `if-compare-alnum` を `if-compare` の前に置けば直ることを実証済み。同梱プロファイルへ取り込むことを推奨
7. **残りの空実装ノード**: `Validate` / `Analyze` / `Review` / `Report` / `Slow` の5ノードは依然 trace 記録のみ。実語料を入れる際に、少なくとも `Validate`（入力の妥当性）と `Report`（生成物の出力）は実装が必要になる

### P1 — ルールガバナンス（本番投入には必須。今回は指示により未実施）

1. **RulePublisher API の認証・認可**: 現在 `POST /api/rules/scripts` は**無防備**であり、誰でも本番DBへGroovyスクリプトを投入して全Executorで実行させられる。現時点で最大のセキュリティ欠陥である
2. **承認 / 監査 / ロールバック**: 誰がどのルールを変更し、誰が承認したか。1操作で前の version へ戻せるか（`version` と `sequence` は既にある。足りないのはフローと画面）
3. **Release Bundle と段階適用**: 複数ルールをまとめて有効化して中間状態を避ける。スクリプトノードは1ノードで先行検証してから全展開する
4. **スクリプトのサンドボックス**: Groovy スクリプトは現在 JVM の全権限を持つ。呼び出し可能なクラスを制限するか、制限付き式エンジン（`liteflow-script-qlexpress` / `aviator`）へ切り替える

### P2 — エンジニアリング

1. 上流不具合の追跡: dromara/liteflow へ `-parameters` の issue を上げ、対応後に4.1の暫定クラスを削除する
2. `.sh` 経路に、PowerShell 側で実装済みのポート事前確認と validator 終了コードの区別を追加する（現状は daemon 確認のみ）
3. `MANIFEST.sha256` の再計算（B9）、または配布フローでの自動生成
4. 容量と性能: 今回は空荷の単一マシンで4行のCOBOLである。実規模（ルール件数、並列度、語料体積）で収束時間と遅延を再測定する
5. バックアップ・復旧と変更履歴の整理方針。DB実行ユーザーの読み取り専用化。Actuator の管理ネットワーク分離

---

## 7. 境界の宣言（誤読しないこと）

- 5.4 の PASS が証明しているのは **Rule-DB オーケストレーション層**である。ルールのDB保管、複数ノード同期、動的更新、楽観ロック、失敗検出、監視、再起動後の再ロード
- 5.5 の PASS が証明しているのは **変換ロジックを設定化してホット更新できること**である（テンプレート表 / DBスクリプトノード / 外部ルールファイルの3経路すべてを実測）
- 5.6 の PASS が証明しているのは **生成コードが本当にコンパイルでき、本当に正しい結果を出すこと**である。規模は **14ルール、12合成ケース、COBOL 50行**
- **本レポートが依然として検証していないこと**: 実COBOL資産に対する語句カバレッジ、COMP-3 / REDEFINES / OCCURS / FILE SECTION などの意味保持、`PERFORM` / `EVALUATE` などの制御フロー、定点十進の金額精度、COBOLとJavaの業務結果等価性、大規模資産における差分変換精度。これらの判定条件は [`COBOL_EXTENSION_BOUNDARY.md`](COBOL_EXTENSION_BOUNDARY.md) に記載
- 語料は**手書きの合成fixture**である。未カバー率 8% は**この12ケースの**未カバー率であって、実資産の未カバー率ではない。実資産ではこの数字は確実に大きくなる（`PERFORM` が1件も対応できていないため）
- したがって: **本結果を根拠に「ドメインPoCへ投資を継続する」と判断してよく、そのための計測手段も揃った。本結果を根拠に「COBOL→Java移行が可能か／工数がどれだけか」を判断してはならない。** 後者に答えるには、まず実語料を `corpus/` へ入れ、未カバー率と振る舞い合格率の2つの数字を見ること。
