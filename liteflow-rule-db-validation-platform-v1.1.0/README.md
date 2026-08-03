# LiteFlow Rule-DB 検証基盤

**Package version: 1.1.0**

LiteFlow v2.16.1 の Rule-DB を使い、**ルールをDBに置いて設定変更だけで挙動を変えられるか**を実際に動かして確かめるための検証基盤です。
**何を目的にしていて、想定10シナリオのどこまで届いたか・どこが未達か** は [1. 目的と、今回検証したシナリオ](#1-目的と今回検証したシナリオ) にまとめています。

検証は3層に分かれています。**この3つを混同しないでください。**

| 層 | 何を確かめるか | 手順 |
|---|---|---|
| ① オーケストレーション層 | DBの chain を書き換えるとノードの実行順が変わる。2ノードに同期する。再起動しても復元する | [手順D](#手順d-rule-db-e2e検証docker) |
| ② 変換ロジック層 | テンプレート／DBスクリプト／外部ルールファイルを変えると**生成されるコードが変わる**（再デプロイなし） | [手順E](#手順e-変換デモ設定を変えると生成コードが変わる) [手順G](#手順g-ルールを再ビルドなしで追加する) |
| ③ 生成コードの品質 | 生成したJavaが**本当にコンパイルでき、本当に正しく動く** | [手順F](#手順f-コーパス回帰生成--コンパイル--振る舞いテスト) |

**COBOL→Javaの実資産に対する変換精度は、本基盤では検証していません。** 詳細は [`docs/COBOL_EXTENSION_BOUNDARY.md`](docs/COBOL_EXTENSION_BOUNDARY.md) と [`docs/STRUCTURE_REPORT.md`](docs/STRUCTURE_REPORT.md) を参照してください。

---

## 1. 目的と、今回検証したシナリオ

### 1.1 このPoCの目的

**LiteFlow Rule-DB を実業務システムへ導入できるかを、具体的な業務シナリオに当てて、動く証拠付きで仕分けること。**

ゴールは「PASSしたから導入してよい」ではありません。次の3つを分けて判断できる状態にすることです。

1. **今すぐ載せられるシナリオ** — 本PoCで実際に動かして証跡が残っているもの
2. **あと何を足せば載るかが分かっているシナリオ** — 機構は証明済みだが、規模・条件・運用機能が足りないもの
3. **本PoCでは一切触れていないシナリオ** — 判断材料がゼロで、別途PoCが要るもの

そのため本基盤は、判定をすべて `reports/` のファイルに残し、各レポートに `scope`（何を証明し、**何を証明していないか**）を必ず書いています。

### 1.2 想定シナリオ別の検証状況

適合度は事前想定（元資料は [`docs/USE_CASE_SCENARIOS.md`](docs/USE_CASE_SCENARIOS.md)）、
検証状況は**今回この基盤で実際に動かした結果**です。

| # | 使用シナリオ | 適合度 | 今回の検証 | 証跡 |
|---|---|---|---|---|
| 1 | EC注文処理・配送ルート動的切替 | ★★★★★ | **✅ 実証** 実行順v1→v2の更新が2ノードへ**11.79ms**で収束、失敗チェーン検出、再起動後の再ロードまで通し | `validation-report.md` RULE-01/02, SYNC-01A/B, SYNC-02A/B, SLO-01, FAIL-01/02, RESTART-01〜03 |
| 2 | 大量ルールを持つ審査・判定基盤 | ★★★★★ | **✖ 未着手** chain数本・ルール数十件の規模しか扱っていない。遅延ロード・キャッシュ・メモリ削減を**一度も測っていない** | なし |
| 3 | 業務ルール管理画面・ルール公開基盤 | ★★★★★ | **✅ 実証** 認証とロール分離（無認証**401**／参照専用の書込**403**／承認権限**403**／**申請者の自己承認 403**）、**発行ごとの履歴**（LiteFlow自体は履歴を持たない。統制層の外で発行された版も pre-image として拾う）、**版間の差分**、**ロールバック**（旧本文を前向きに再発行し2ノードの挙動が旧版へ戻る）、**承認フロー**（承認まで未反映→承認で反映）、**監査ログ**、**管理画面4枚**（ブラウザからのフォームログイン／ログアウトを含む） | `validation-report.md` RM-01〜10、`rule-admin-demo.json`（断言21/21）、[手順L](#手順l-ルール管理基盤履歴差分ロールバック承認) |
| 4 | マルチテナント型SaaS業務フロー | ★★★★☆ | **✖ 未着手** `application-name` は `liteflow-validation-platform` 1つのみ。テナント分離を試していない | なし |
| 5 | レガシーシステム移行・ルール外出し | ★★★★★ | **✅ 実証（本PoCの主戦場）** 3ファミリ **19/19 期待どおり**。①COBOL 1文（12ケース）②**COBOL 複数ファイル**（主1＋従2、分岐・ループ・GO TO・CALL。生成物を実際に javac して実行し4通りの入力で照合）③**Struts 1.3.10 → Spring Boot 4.1**（ログイン／検索一覧。ゴールデン一致6/6＋Boot4.1依存に対する実コンパイル）。正例コンパイル15/15、振る舞い25/25、未カバー率**6.07%**。**実資産・意味同値性は依然未検証** | `corpus-report.md`、[手順J](#手順j-cobol-複数ファイルの変換分岐ループgo-tocall) [手順K](#手順k-struts-1310--spring-boot-41)、`samples-build.json` |
| 6 | キャンペーン・料金・割引ルール管理 | ★★★★☆ | **◐ 部分** 即時反映は実証（11.79ms）。**ロールバック（旧versionへ戻す）・有効期間/予約配信は未検証**。更新回数も2回のみ | `validation-report.md` SLO-01 |
| 7 | 複数ノード同期・障害回復検証 | ★★★★☆ | **◐ 部分** 2ノード同期と再起動後の再ロードは実証。**通知欠落を意図的に起こして再照合で回復する試験はしていない**（DB切断・poll失敗の注入なし） | `validation-report.md` SYNC-*, RESTART-01〜03, OBS-RDB-A/B |
| 8 | スクリプト型業務ロジックの動的配信 | ★★★★☆ | **✅ 実証** Groovyスクリプトノードを**DBへ公開→実行→本文だけ更新→出力が変わる**を、**再起動なし・再ビルドなし**で確認。A で公開したものを B が実行することも確認 | `transform-demo.json`（3断言すべて true、`applicationRestarted:false`） |
| 9 | 監視・SRE・性能評価基盤 | ★★★☆☆ | **✅ 実証（小規模）** 必須4メトリクス、Prometheus 2台Scrape、Grafana自動登録。連続30件 p50 **5.48ms** / p95 **9.04ms**、50並列 **50/50成功**。**長時間負荷・アラート・リソース測定は未実施** | `validation-report.md` OBS-*, PERF-01, SLO-02, CONC-01 |
| 10 | 複数バックエンド比較・選定基盤 | ★★★☆☆ | **✖ 未着手** SQL（MariaDB）のみ。Redis / Nacos / etcd と比較していない | なし |

**要約: 10シナリオ中、実証 5件（#1・#3・#5・#8・#9）／部分実証 2件（#6・#7）／未着手 3件（#2・#4・#10）。**

旧システム刷新にとって重みの大きい **#3（統制）と #5（変換）を端から端まで作り切った**のが今回の中身である。
#3 は [手順L](#手順l-ルール管理基盤履歴差分ロールバック承認)、
#5 は [手順J](#手順j-cobol-複数ファイルの変換分岐ループgo-tocall)（COBOL）と
[手順K](#手順k-struts-1310--spring-boot-41)（Struts）で、それぞれ自分の手で再現できる。

### 1.3 まだ目的に届いていないところ

証跡がゼロのものと、機構は証明したが条件が足りないものを分けています。

#### A. 判断材料がゼロ（別途PoCが必要）

| 穴 | 影響するシナリオ | 次にやる実験 |
|---|---|---|
| **ルール件数のスケール**。数千〜数万ルール時の起動時間・メモリ・遅延ロードの効き方 | #2 | ルールを1万件生成して投入し、起動時間・ヒープ・実行レイテンシを測る |
| **マルチテナント分離**。`application-name` 別に別ルール集合を持てるか、誤配信しないか | #4 | 2つの `application-name` で Executor を4台立て、片方の更新がもう片方へ漏れないことを確認 |
| **バックエンド比較**。Redis / Nacos / etcd での収束時間・運用性 | #10 | `liteflow.rule-db` のプロバイダを差し替えて SLO-01 相当を測り比較表にする |

#### B. 機構は証明したが、条件・規模・運用機能が足りない

| 穴 | 影響するシナリオ | 次にやる実験 |
|---|---|---|
| **障害注入なし**。通知欠落・DB断・poll失敗からの再照合回復を試していない | #1 #7 | MariaDB を一定時間停止 → 更新 → 復旧 → `reconcileOnce` で最終一致することを検査項目化 |
| **無停止切替の未確認**。30件連続・50並列はいずれも「静止状態での実行」。**更新中に流れている実行**がどうなるかを見ていない | #1 #6 | 負荷をかけながら v1→v2 を公開し、実行途中の混在・エラー率を測る |
| **有効期間・予約配信が無い**。「来週から適用」ができない | #6 | 発行時刻を指定できる予約公開と、期間切れの自動失効 |
| **認証がPoC級**。利用者はインメモリ、既定パスワードは平文、多要素認証もユーザー管理も無い。**公開されたGroovyのサンドボックスも無い** | #3 #8 | 実IdP連携（OIDC/LDAP）、ユーザー管理、スクリプト実行のサンドボックス化 |
| **実資産が無い**。コーパス19件は**手書きの合成fixture**。COBOL側は `SORT`/`STRING`/`INSPECT`/`OCCURS` 未対応、数値は `double` で COMP-3 と一致しない。Struts側は Tiles / `bean:write` / `ActionErrors` 未対応 | #5 | 実COBOL 50本以上と実Struts画面を投入し、未カバー率と振る舞い合格率を測り直す（[`corpus/README.md`](corpus/README.md)、[手順N](#手順n-自分で実験を追加する)） |
| **長時間・大規模の性能未測定**。30件・50並列・十数秒のみ | #9 | 数時間の連続負荷とアラートルール、リソース使用量の記録 |

#### C. 意図的に対象外（本PoCでは判断しない）

- **COBOL と Java の意味同値性**。本PoCが証明したのは「ルール表を設定すると生成コードが変わり、それが実際にコンパイルでき実際に動く」ところまでです。**実業務コードの変換精度については何も言えません**（`SCOPE-01` として検証項目に明記済み）。
- **Struts と Spring Boot の業務等価性**。手順Kの判定は「生成物が事前に用意した正解と一致した」「生成Javaが Boot 4.1 の依存に対してコンパイルできた」の2点だけです。**生成物を起動して画面が動くことは確かめていません**（`samples-build` が起動して見せるのは人手で書いた目標プロジェクトの方です）。
- **判定の強さがファミリで違うこと**を混同しないでください。COBOL側は生成物を**実行して**値を突き合わせており、Struts側は**テキスト差分**にとどまります。

---
┌──────────────────────────────────────┬─────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────┐
│                 URL                  │                             何                              │                       認証                       │
├──────────────────────────────────────┼─────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────┤
│ http://localhost:3000/login          │ Grafana ダッシュボード                                      │ admin / admin                                    │
├──────────────────────────────────────┼─────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────┤
│ http://localhost:8081/admin/         │ ルール管理画面（本PoCの自作。今回ブラウザから入れるように直 │ admin/admin123、approver/approver123、viewer/vie │
│                                      │ した所）                                                    │ wer123                                           │
├──────────────────────────────────────┼─────────────────────────────────┼──────────────────────────────────────────────────┤
│ http://localhost:8082/admin/         │ 同じものの2号機（Executor B）                               │ 同上                                             │
├──────────────────────────────────────┼─────────────────────────────────┼──────────────────────────────────────────────────┤
│ http://localhost:9090                │ Prometheus                                                  │ 認証なし                                         │
├──────────────────────────────────────┼─────────────────────────────────┼──────────────────────────────────────────────────┤
│ http://localhost:8081/actuator/prome │ メトリクス                                                  │ 認証なし                                         │
│ theus                                │                                 │                                                  │
└──────────────────────────────────────┴─────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────┘


## 2. ディレクトリ構成

**大原則が3つある。これを覚えれば迷わない。**

1. **実行するものは全部 `scripts/`** にある。ルートには何も置かない
2. **変換のルールは全部 `app/src/main/resources/templates/*.json`** にある。Javaには無い
3. **結果は全部 `reports/`** に出る。`corpus/**/output/` は「期待する正解」であって実結果ではない

```text
liteflow-rule-db-validation-platform-v1.1.0/
├── README.md                     ← このファイル（手順の入口。まずここ）
├── CLAUDE.md                     Claude Code 向けの開発ガイド（規約・地雷・禁止事項）
├── START_HERE.txt                最短の起動手順
├── VERSION.txt / package-metadata.json / MANIFEST.sha256
├── docker-compose.yml            MariaDB / Executor×2 / Prometheus / Grafana / validator
│
├── scripts/                      ★実行するものはすべてここ。ルートから叩く
│   ├── preflight.cmd .ps1 .sh    手順B 静的事前確認（Docker不要・30秒）
│   ├── local-verify.cmd .ps1     手順C ホストでビルドとテスト（Docker不要・20秒）
│   ├── install.cmd .ps1 .sh      手順D-1 Dockerイメージ構築（中で mvn clean verify）
│   ├── validate.cmd .ps1 .sh     手順D-2 Rule-DB E2E検証 ★正式判定
│   ├── run-all.cmd .ps1 .sh      全部まとめて（preflight→install→validate→各デモ→summary）
│   ├── demo-transform.ps1        手順E 変換デモ（設定を変えると生成コードが変わる）
│   ├── corpus-run.cmd .ps1       手順F/J/K コーパス回帰（-Family で対象を絞れる）
│   ├── samples-build.cmd .ps1    手順K-2 Struts と Spring Boot の実プロジェクトをビルドし画面確認
│   ├── rule-admin-demo.cmd .ps1  手順L ルール管理の端から端まで（認証〜監査）
│   ├── summary.cmd .ps1          手順M 全レポートの判定を1枚の表に
│   ├── local-demo.ps1            Docker不要の変換デモ（ホストで1インスタンス起動）
│   ├── local-corpus.ps1          Docker不要のコーパス回帰
│   ├── stop.ps1 .sh              停止
│   └── _common.ps1               共有ヘルパ（daemon確認・ポート確認）※単体実行しない
│
├── app/                          Spring Boot 4.0.6 アプリケーション（本体）
│   ├── Dockerfile                ビルド:JDK17 / 実行:JDK17（JREではない。javacが要る）
│   ├── pom.xml                   本体の依存。Spring Boot 4.1 は絶対に足さないこと
│   ├── boot41-classpath.pom.xml  変換先 Spring Boot 4.1 の依存jarを集めるためだけの pom
│   └── src/main/
│       ├── java/jp/co/softroad/liteflow/
│       │   ├── controller/       REST入口（ルール公開・管理・実行・テンプレート参照）
│       │   ├── service/          RulePublisher ラッパ
│       │   ├── governance/       ★シナリオ#3 履歴・差分・ロールバック・承認・監査
│       │   ├── model/            実行コンテキストと入出力DTO
│       │   ├── node/             LiteFlowノード。**解析と変換の中身はここに無い**。
│       │   │                     transform/ の純粋なクラスを呼ぶだけの薄い接続部
│       │   ├── transform/        ★ルール表エンジン・解析・診断・javac起動・生成骨格
│       │   │                     RuleEngine       ルール適用（起動不要・ここが製品の中核）
│       │   │                     SourceAnalyzer   structure/facts の評価（起動不要）
│       │   │                     ProfileValidator ルール表の書き方の診断（起動不要）
│       │   └── config/           上流不具合の回避設定 / Spring Security 設定
│       └── resources/
│           ├── application.properties
│           ├── schema.sql        rm_* テーブル（履歴・承認・監査）のDDL
│           ├── static/admin/     ★ルール管理画面（素のHTML+JS。Thymeleafは入れていない）
│           └── templates/        ★★変換ルール表。ここを編集すると変換結果が変わる
│               ├── compilable-v1.json      COBOL 1文 → Java（【凍結】触らないこと）
│               ├── cobol-programs-v1.json  COBOL プログラム群 → Java（分岐/ループ/GO TO/CALL）
│               ├── struts-to-boot-v1.json  Struts 1.3.10 → Spring Boot 4.1
│               └── readable-v1.json        人が読む形式（レビュー用・単体では未コンパイル）
│
├── corpus/                       ★回帰コーパス。ファミリ単位
│   ├── README.md                 ファミリ索引と共通書式
│   └── families/<ファミリ名>/
│       ├── family.json           既定プロファイル・チェーンEL・入力方式・判定方式
│       ├── README.md             このファミリが何を証明しているか
│       ├── apps/                 （struts-springboot のみ）変換元/変換先の実プロジェクト骨組み
│       └── cases/<ケースID>/
│           ├── meta.json         目的・既知の穴・期待するゲート結果
│           ├── input/            ★変換元ファイル一式
│           └── output/           ★期待する正解（behaviour.json / ゴールデン成果物）
│
├── monitoring/                   Prometheus 設定 / Grafana 自動プロビジョニング
├── tools/                        preflight.py（静的検査）/ static_compile.py（stub型検査）
├── validator/                    validate.py（E2E検証と最終レポート生成）
├── docs/                         技術文書
│   ├── STRUCTURE_REPORT.md       ★構造・実測結果・欠陥一覧・次の一手
│   ├── TECHNICAL_REPORT.md       検証項目の定義
│   ├── COBOL_EXTENSION_BOUNDARY.md  COBOL拡張時の責務境界
│   ├── STATIC_VALIDATION_REPORT.md  配布前の静的検査結果
│   └── CHANGELOG.md
└── reports/                      ★★すべての実行結果はここにしか出ない
    └── summary.md                全レポートの判定を1枚に（scripts\summary.cmd）
```

### コーパスのファミリ

| ファミリ | 変換元 → 変換先 | ルールプロファイル | 判定 |
|---|---|---|---|
| `cobol-statements` | COBOL 1文 → Java（単一ファイル） | `compilable-v1`（**凍結**） | 振る舞い（実コンパイル＋実行） |
| `cobol-programs` | COBOL プログラム群 → Java（主1＋従2） | `cobol-programs-v1` | 振る舞い（実コンパイル＋実行） |
| `struts-springboot` | Struts 1.3.10 → Spring Boot 4.1 | `struts-to-boot-v1` | ゴールデン差分＋実コンパイル |

---

## 3. 手順索引

| 手順 | 目的 | 対応シナリオ | Docker | 所要 |
|---|---|---|:---:|---|
| [A](#手順a-前提条件の確認) | 前提条件の確認 | – | – | 1分 |
| [B](#手順b-静的事前確認docker不要) | 静的事前確認 | – | 不要 | 30秒 |
| [C](#手順c-ホストビルドとテストdocker不要) | ホストでビルドとテスト | – | 不要 | 約25秒 |
| [D](#手順d-rule-db-e2e検証docker) | **Rule-DB E2E検証（正式判定）** | #1 #7 #9 | 必要 | 初回15〜25分 |
| [E](#手順e-変換デモ設定を変えると生成コードが変わる) | 変換デモ（設定で挙動が変わる） | #8 | どちらでも | 1分 |
| [F](#手順f-コーパス回帰生成--コンパイル--振る舞いテスト) | コーパス回帰（COBOL 1文） | #5 | どちらでも | 1分 |
| [G](#手順g-ルールを再ビルドなしで追加する) | ルールを再ビルドなしで追加 | #5 | どちらでも | 3分 |
| [H](#手順h-画面を見るgrafana--prometheus) | 監視画面を見る（ログイン情報） | #9 | 必要 | 2分 |
| [I](#手順i-停止と後片付け) | 停止と後片付け | – | 必要 | 1分 |
| **[J](#手順j-cobol-複数ファイルの変換分岐ループgo-tocall)** | **COBOL 複数ファイル変換**（主1＋従2、分岐・ループ・GO TO・CALL） | **#5** | どちらでも | 2分 |
| **[K](#手順k-struts-1310--spring-boot-41)** | **Struts 1.3.10 → Spring Boot 4.1**（ログイン／検索一覧） | **#5** | どちらでも | 初回5分 |
| **[L](#手順l-ルール管理基盤履歴差分ロールバック承認)** | **ルール管理基盤**（履歴・差分・ロールバック・承認・監査・画面） | **#3** | どちらでも | 3分 |
| **[M](#手順m-全レポートの判定を1枚で見る)** | 全レポートの判定を1枚で見る | – | 不要 | 5秒 |
| **[N](#手順n-自分で実験を追加する)** | **自分で実験を追加する**（ケース／ルール／ファミリ） | – | どちらでも | – |

**一番早く全部見たい場合** → 手順A → `scripts\run-all.cmd` → 手順M（サマリ）→ 手順H・L（画面）。

**旧システム刷新の観点で見たい場合** → 手順J（COBOL）→ 手順K（Struts）→ 手順L（統制）。

---

## 3-B. 実装した機能の一覧（どのアプリの、どのURLか）

**アプリは2種類しかない。** 自作は Executor（Spring Boot）だけで、あとは既製品の監視スタックである。
Executor A と B は**同じイメージの2インスタンス**で、Rule-DB 経由の同期を見せるために2台ある。

| # | 機能 | どのアプリ | URL / 入口 | 認証 |
|---|---|---|---|---|
| 1 | 変換の実行（chain を指定して流す） | Executor | `POST http://localhost:8081/api/flows/{chainId}/execute` | 不要 |
| 2 | ルール（chain EL）の発行 | Executor | `POST http://localhost:8081/api/rules/chains` | ADMIN |
| 3 | スクリプトノード（Groovy）の発行 | Executor | `POST http://localhost:8081/api/rules/scripts` | ADMIN |
| 4 | ルール一覧・現行版の参照 | Executor | `GET http://localhost:8081/api/rules` | 認証済み |
| 5 | **発行履歴**（LiteFlow は履歴を持たないので自前） | Executor | `GET .../api/rules/{CHAIN\|SCRIPT}/{id}/revisions` | 認証済み |
| 6 | **版間の差分** | Executor | `GET .../api/rules/{type}/{id}/diff?from=&to=` | 認証済み |
| 7 | **ロールバック**（旧本文を前向きに再発行） | Executor | `POST .../api/rules/{type}/{id}/rollback` | ADMIN |
| 8 | **承認フロー**（申請 → 承認 → 反映） | Executor | `POST .../api/rules/approvals` → `.../{id}/approve\|reject` | 申請=認証済み／承認=APPROVER |
| 9 | **監査ログ** | Executor | `GET http://localhost:8081/api/rules/audit` | 認証済み |
| 10 | 変換ルール表の参照 | Executor | `GET http://localhost:8081/api/templates`、`/{name}` | 不要 |
| 11 | **ルール表の診断**（書き間違いを名指し） | Executor | `GET http://localhost:8081/api/templates/diagnostics` | 不要 |
| 12 | **ルール管理画面**（上の 4〜9 をブラウザから） | Executor（静的HTML+JS） | `http://localhost:8081/admin/` | フォームログイン |
| 13 | LiteFlow のメタ情報（chain と Rule-DB の状態） | Executor | `GET http://localhost:8081/actuator/liteflow[/ruledb]` | 不要 |
| 14 | メトリクス | Executor | `GET http://localhost:8081/actuator/prometheus` | 不要 |
| 15 | 2台目（同期の確認用） | Executor B | 上記すべての `8081` を `8082` に読み替え | 同じ |
| 16 | 監視ダッシュボード | **Grafana（既製品）** | `http://localhost:3000` | `admin` / `admin` |
| 17 | メトリクスの生データ | **Prometheus（既製品）** | `http://localhost:9090` | 不要 |
| 18 | Rule-DB 本体 | **MariaDB（既製品）** | `localhost:3307`（`lf_*` と `rm_*` テーブル） | compose の environment 参照 |

管理画面の内訳（すべて `http://localhost:8081/admin/` 配下）:

| 画面 | 見えるもの |
|---|---|
| `index.html` | ルール一覧（種別・ID・現行版・本文・最終更新） |
| `detail.html` | 履歴一覧、2版を選んで差分、**この版へ戻す** |
| `approvals.html` | 申請フォーム、申請一覧、**承認／却下**、`APPROVED` には**再適用** |
| `audit.html` | 監査ログ |

### この機能構成についての評価（必要性）

**本当に要ると考えるもの。** 5〜9（履歴・差分・ロールバック・承認・監査）は**この製品を選ぶかどうかの判断そのもの**である。
LiteFlow は「DBのルールを書き換えれば全ノードに配る」ところまでしか提供せず、
**履歴も差分もロールバックも承認も持たない**（`lf_chain` は単行の上書き、`lf_change_log` に本文が無い）。
つまり素の LiteFlow を業務に入れると「誰がいつ何を変えたか分からず、戻せない」状態で本番のルールを書き換えることになる。
ここを自前で足さなければ実務では使えない、というのが今回いちばん確かめたかったことで、実際に足せた。

11（ルール表の診断）も要る。この基盤の売りは「Javaを書かずJSONに1件足す」だが、
その入口には検証が無く、綴り間違いが例外にならず**静かに違う出力**になっていた。
入口が弱いままでは「設定で変えられる」という主張が運用に耐えない。

**要るが今の形では足りないもの。** 12（管理画面）は PoC としては十分だが、
一覧に検索も並び替えも頁送りも無い。ルールが数十件を超えたら実用にならない。

**なくてもよかったかもしれないもの。** 15（2台目）はデモとしては効くが、
機能ではなく構成なので、同期を1台で語れる証跡（`lf_change_log` の採番）でも代替できたかもしれない。

### まだ無い機能（実装していない。優先度順）

1. **テナント／環境の分離** — `application-name` が1つだけ。開発・検証・本番のルールを同じ表に置くしかない。
   実務で最初に困るのはこれで、シナリオ#4（マルチテナント）が未着手なのと同じ理由である
2. **ルールの有効期間・予約反映** — 「来月1日から新料金」が表現できない。いまは即時反映のみ。シナリオ#6の残り
3. **大量ルールの運用** — 遅延ロード・キャッシュ・メモリ挙動を**一度も測っていない**。
   chain 数本・ルール数十件でしか動かしておらず、数千件でどうなるか不明。シナリオ#2が未着手
4. **Groovy のサンドボックス** — ADMIN は任意コードを両 Executor で実行できる。**本番前に必須**
5. **ユーザー管理・多要素認証・監査の改ざん耐性** — 利用者はインメモリ、パスワードは平文既定、
   `rm_audit` は同じDBに追記するだけで署名も外部転送も無い
6. **通知欠落からの回復試験** — DB切断や poll 失敗を意図的に起こして再照合で戻ることを確かめていない。シナリオ#7の残り
7. **承認の多段化・権限委譲** — 承認は1段のみ。金額や影響範囲で承認者を変える、といった実務要件は未対応
8. **ルール変更の影響分析** — 「このルールを変えると、どのケースが変わるか」を事前に出せない。
   いまはコーパスを流して事後に差分を見るしかない

---

## 手順A. 前提条件の確認

### 必須
- **Docker Desktop**（Linuxコンテナモード）: 手順D以降で必要。**起動してタスクトレイのアイコンが緑になるまで待つ**
- 空きメモリ 4GB以上、空きディスク 10GB以上
- 初回のみインターネット接続（Dockerイメージと Maven 依存の取得）

### 任意（あればホスト実行が使える。無くてもDockerで完結する）
- JDK 17以上（本番検証環境では 21.0.7 を使用）
- Maven 3.9以上
- Python 3.9以上（`preflight` に使用）

### 確認コマンド
```powershell
docker info --format '{{.ServerVersion}}'   # 値が出ればdaemon稼働中
java -version
mvn -v
python --version
```

`docker info` がエラーになる場合は Docker Desktop が起動していません。**`docker --version` は daemon が止まっていても成功する**ので、必ず `docker info` で確認してください。

### 使用ポート（他プロセスが使っていると失敗します）
`3307`(MariaDB) / `8081`(Executor A) / `8082`(Executor B) / `9090`(Prometheus) / `3000`(Grafana)

---

## 手順B. 静的事前確認（Docker不要）

**目的**: ファイル欠損・構文エラー・設定不整合をDocker起動前に洗い出す。

```bat
scripts\preflight.cmd
```
```bash
./scripts/preflight.sh
```

**変更するファイル**: なし
**結果の確認場所**: `reports/preflight-report.md`
**合格基準**: `Overall: **PASS**`、FAIL が 0 件（19項目）

---

## 手順C. ホストビルドとテスト（Docker不要）

**目的**: Dockerビルドを待たずに、LiteFlow API の使い方とJUnitが通ることを約30秒で確認する。

**前提**: ホストに JDK と Maven があること（無い場合は自動でスキップされます）

```bat
scripts\local-verify.cmd
```

**変更するファイル**: なし
**結果の確認場所**:
- `reports/local-verify.json` → `"status": "PASS"`、`junit.failures = 0`
- `reports/rule-usage.json` → 宣言したルールをコーパスが実際に通しているか
- `reports/junit-local/TEST-*.xml`
- 失敗時は `reports/local-verify.log`

**合格基準**: `ローカル検証 PASS: tests=81 failures=0 errors=0`

> これは**ホストビルドの結果**です。正式判定は手順Dです。

### 手順C-2. ルール表だけを直したとき（1秒未満）

ルール表を触ったときに毎回30秒待つ必要はありません。**Spring も LiteFlow も javac も使わない**
テストが5クラスあり、ここだけなら1秒未満で回ります。**普段の作業ループはこれです。**

```bat
mvn -f app/pom.xml -B -ntp test -Dtest="RuleEngine*Test,ProfileDiagnosticsTest,RuleUsageTest"
```

| クラス | 見ているもの |
|---|---|
| `RuleEngineTest` | ルール適用の規則（ブロック枠・文脈依存・区画順・インラインテンプレート） |
| `RuleEngineCorpusTest` | コーパス19ケースの生成結果が**スナップショットと1バイトも違わないこと** |
| `ProfileDiagnosticsTest` | 同梱プロファイル4本に書き間違いが無いこと |
| `RuleUsageTest` | 書いたルールがコーパスで実際に発火していること |

生成コードを**意図して**変えたときだけ、スナップショットを作り直します。

```bat
mvn -f app/pom.xml -B -ntp test -Dtest=CorpusSnapshotTest -Dsnapshot.update=true
```

> 意図せず差分が出たなら、それは退行です。**作り直す前に理由を説明できるようにしてください。**

ルール表の書き間違いは、起動中のExecutorにも問い合わせられます（無認証）。

```bat
curl http://localhost:8081/api/templates/diagnostics
```

---

## 手順D. Rule-DB E2E検証（Docker）

**目的**: **これが正式判定です。** MariaDB + Executor 2台 + Prometheus + Grafana を立て、ルール公開・2ノード同期・楽観ロック・失敗検出・並列実行・再起動後の再ロードまでを通しで検証する。

**前提**: 手順A完了（**Docker Desktop 起動済み**）

### D-1. インストール（イメージ構築）
```bat
scripts\install.cmd
```
中で何が起きるか:
1. 実行イメージの取得（**ローカルに既にあるものはスキップ**。`-Force` で強制取得）
2. アプリイメージのビルド（コンテナ内で `mvn clean verify` を実行）
3. イメージからJUnit証跡を取り出す

初回は Maven 依存の取得で 15〜25分かかります。2回目以降はキャッシュが効きます。

**結果の確認場所**:
- `reports/build-evidence.json` → `"status": "PASS"`
- `reports/build-metadata.json` → `"resolutionMode": "maven-central"`
- `reports/junit/TEST-*.xml`
- 失敗時は `reports/install-failure.txt` と `reports/install.log`

### D-2. 検証実行
```bat
scripts\validate.cmd
```

**結果の確認場所**:
- **`reports/validation-report.md`** ← これが正本
- `reports/validation-report.json`（HTTP応答・version・trace などの生証跡）
- 失敗時は `reports/validation-failure.txt` と `reports/validation-run.log`

**合格基準**: `総合判定: **PASS**`、FAIL 0 件（**42項目**。うち RM-01〜10 がルール管理）

### D-3. 一括実行
```bat
scripts\run-all.cmd
```
= preflight + install + validate。失敗してもウィンドウは閉じません。

### よくある失敗
| 症状 | 対処 |
|---|---|
| `Docker daemon に接続できません` | Docker Desktop を起動し、アイコンが緑になってから再実行 |
| `必要なポートが他プロセスに使用されています` | 表示された PID のプロセスを停止して再実行 |
| `検証フェーズ 'main' に FAIL 項目があります` | **異常終了ではありません。** `reports/validation-report.md` に FAIL の内訳が出ています |
| `SLO-01` / `SLO-02` が WARN | 収束時間・応答時間の目安を超過。必須項目ではないので総合判定には影響しません |

---

## 手順E. 変換デモ（設定を変えると生成コードが変わる）

**目的**: 「ルールを設定するだけで変換が変わる」ことを、**再起動も再ビルドもせずに**目で見る。

**前提**: Executor が動いていること（手順D-2完了、または下の Docker不要版）

```powershell
powershell -File scripts\demo-transform.ps1                                    # Docker版（8081）
powershell -File scripts\demo-transform.ps1 -BaseUrl http://localhost:8082     # Executor B に対して
powershell -File scripts\local-demo.ps1                                        # Docker不要版
```

**何を変えているか**（4ステップ）:
1. ベースライン。`THEN(validate,transform,report)` を公開して実行
2. **テンプレート表だけ**差し替えて再実行 → 出力が変わる
3. **Rule-DBにGroovyスクリプトノードを追加** → 挙動が増える
4. **スクリプト本文だけ**更新 → 出力がまた変わる

**変更するファイル**: なし（すべてHTTP経由でDBを書き換える）
**結果の確認場所**: 画面出力 + `reports/transform-demo.json`
**合格基準**: `判定: PASS`、3つの断言がすべて `True`

### 2ノード同期も見たい場合
手順Eを 8081 に対して実行したあと、`reports/transform-demo.json` の `chainId` を使って **8082** を叩くと、
**一度も教えていないはずの Executor B** が Rule-DB 経由で同じスクリプトを取り込んで実行することを確認できます。

---

## 手順F. コーパス回帰（生成 → コンパイル → 振る舞いテスト）

**目的**: 生成したJavaが**本当に javac でコンパイルでき、本当に期待どおりの値を出す**ことを、12ケースまとめて確認する。

**前提**: Executor が動いていること

```bat
scripts\corpus-run.cmd
```
```powershell
powershell -File scripts\corpus-run.ps1 -BaseUrl http://localhost:8082    # Executor B に対して
powershell -File scripts\corpus-run.ps1 -Profile readable-v1              # 別プロファイル（コンパイルは失敗する）
powershell -File scripts\local-corpus.ps1 -Port 8091                      # Docker不要版
```

**変更するファイル**: なし（ケースを増やす場合は手順N-1）
**結果の確認場所**:
- **`reports/corpus-report.md`** ← ケース別の結果・未カバー行・既知の穴
- `reports/corpus-report.json`（生成コードとコンパイル済みJavaソースを含む）

**合格基準**: `判定: PASS (12/12 cases as expected)`

### 読み方
| 指標 | 意味 |
|---|---|
| 正例のコンパイル成功 | javac が通った正例の数 |
| 振る舞いテスト合格 | 実際に実行して期待値と一致した検査の数 |
| **全体の未カバー率** | **ルール表がまだ認識できていない行の割合。実資産を入れるとこの値が一番重要になります** |

### 負例が2件入っています（落ちるのが正しい）
- `11-uncovered-statements`: `PERFORM` / `EVALUATE` は未対応 → 未カバー率で落ちる
- `12-alphanumeric-if-gap`: **コンパイルは通るのに実行時に壊れる** → 振る舞いテストだけが検出できる

この2件が PASS に変わったらゲートの退行です。

### ケースを追加する

```text
corpus/families/cobol-statements/cases/13-あなたのケース/
  meta.json               ← {"title":"…","maxUncoveredRate":0.0,"expectQualityGate":"PASS"}
  input/source.cbl        ← COBOL文を1行1文で
  output/behaviour.json   ← [{"name":"…","given":{"WS-A":1},"expect":{"WS-B":1}}]
```

手順は [手順N-1](#n-1-ケースを1件足すルールは変えない)、書式の詳細は
[`corpus/README.md`](corpus/README.md)。**実資産の入れ方もそこに書いてあります。**

---

## 手順G. ルールを再ビルドなしで追加する

**目的**: 「ルール追加＝設定変更」であることを実際に確かめる。**jarを一切作り直しません。**

### G-1. ルール表をコピーして編集
```powershell
mkdir D:\my-templates
copy app\src\main\resources\templates\compilable-v1.json D:\my-templates\
```

`D:\my-templates\compilable-v1.json` を編集します。**変更するのはこのファイルだけです。**
- `"version"` を上げる（例: `99`）、`"owner"` を自分に変える
- `"rules"` 配列にエントリを追加する。**順序が優先順位**なので、より限定的なルールを前に置く

```json
{
  "id": "if-compare-alnum",
  "statement": "IF",
  "appliesTo": "IF <a> = <引用符付きリテラル>（英数字比較）",
  "pattern": "^IF\\s+(?<left>[A-Za-z0-9_-]+)\\s*=\\s*(?<right>'[^']*'|\"[^\"]*\")\\s*(?:THEN)?\\s*\\.?\\s*$",
  "template": "if (String.valueOf(${leftExpr}).equals(${rightExpr})) {",
  "notes": "再ビルドせずに追加したルール"
}
```

正規表現の**名前付きグループ**が、そのままテンプレート変数になります。

| 変数 | 内容 |
|---|---|
| `${g}` | マッチした文字列そのまま |
| `${g}Java` | Java安全形式（`WS-A` → `WS_A`、`'ABC'` → `"ABC"`） |
| `${g}Expr` | 値を返すJava式（識別子 → `vars.get("WS-A")`、リテラル → そのまま） |
| `${g}Mapped` | プロファイルの `maps.g` で変換（演算子の `=` → `==` など） |

### G-2. 外部ディレクトリを指定して起動
```powershell
$env:TRANSFORM_TEMPLATEDIR = "D:\my-templates"
java -jar app\target\liteflow-rule-db-validation-app.jar
```
Docker で使う場合は `docker-compose.yml` の executor に以下を追加します。
```yaml
    environment:
      TRANSFORM_TEMPLATEDIR: /templates
    volumes:
      - D:/my-templates:/templates:ro
```

### G-3. 反映の確認
```bash
curl http://localhost:8081/api/templates
```
`version` と `source` が外部ファイルを指していれば成功です。
```json
{"profile":"compilable-v1","version":99,"owner":"...","ruleCount":15,"source":"D:\\my-templates\\compilable-v1.json"}
```

**結果の確認場所**: `GET /api/templates` の応答と、手順Fの再実行結果（未カバー率が下がる）

---

## 手順H. 画面を見る（Grafana / Prometheus）

**前提**: 手順D-2完了

**この基盤で開ける画面はこれで全部です。**

| 画面 | URL | ログイン |
|---|---|---|
| **Grafana**（監視ダッシュボード） | http://localhost:3000 | **ユーザー名 `admin` / パスワード `admin`** |
| **ルール管理**（履歴・差分・ロールバック・承認） | http://localhost:8081/admin/ | **`admin` / `admin123`**、`approver` / `approver123`、`viewer` / `viewer123`（[手順L](#手順l-ルール管理基盤履歴差分ロールバック承認)） |
| Prometheus | http://localhost:9090 | 認証なし |
| Executor A の REST | http://localhost:8081 | 実行APIは認証なし、`/api/rules/**` は認証必要 |
| Executor B の REST | http://localhost:8082 | 同上 |
| 変換先 Spring Boot サンプル（`/login`・`/search`） | http://localhost:8099 | 認証なし。`scripts\samples-build.cmd` が一時的に起動する |

> ⚠ **Grafana のパスワード変更を促されたら必ず Skip すること。** ここで変更すると
> `validate.cmd` の **`OBS-DASHBOARD` が 401 で落ちます**（validator は `admin`/`admin` で
> ダッシュボードを問い合わせるため）。`GF_SECURITY_ADMIN_PASSWORD` は**初期値にしか効かず**、
> 変更後の値は `grafana-data` ボリュームに永続化されるので、環境変数を直しても戻りません。
>
> 変えてしまった場合の復旧（Grafana のボリュームだけ作り直す。Rule-DB は保持される）:
>
> ```bat
> docker compose rm -sf grafana
> docker volume rm liteflow-rule-db-validation_grafana-data
> docker compose up -d grafana
> ```
>
> ここに書いてあるパスワードはすべて**PoC用の初期値**です。**本番利用は禁止です。**

### Grafana でダッシュボードを開く
1. http://localhost:3000 を開き `admin` / `admin` でログイン
2. 左メニュー **Dashboards** → フォルダ **LiteFlow**
3. **LiteFlow Rule-DB Validation**（パネル5枚）を開く
4. 何も表示されない場合は、手順Eか手順Fを実行してから画面右上の更新ボタンを押す（メトリクスは実行して初めて生成されます）

### Prometheus で確認する
1. http://localhost:9090 → **Status** → **Targets** → `executor-a:8080` と `executor-b:8080` が **UP**
2. **Graph** タブで `liteflow_chain_executions_seconds_count` を実行 → 2ノード分の系列が出る

### コマンドで確認する
```bash
curl http://localhost:8081/actuator/health              # {"status":"UP"}
curl http://localhost:8081/actuator/liteflow/ruledb     # active:true, failedTargets:[]
curl http://localhost:8081/actuator/prometheus          # メトリクス（Acceptヘッダを付けないこと）
curl http://localhost:8081/api/templates                # 有効なルールプロファイル
curl http://localhost:8081/api/instance                 # どちらのExecutorか
```

---

## 手順I. 停止と後片付け

```powershell
powershell -File scripts\stop.ps1     # 停止（DBデータは残る）
```
```bash
./scripts/stop.sh
docker compose down -v                # DBボリュームごと削除（完全初期化）
```

---

## 手順J. COBOL 複数ファイルの変換（分岐・ループ・GO TO・CALL）

**目的**: 旧システム刷新で最初にぶつかる形 — **1本の主プログラムが2本の従プログラムを CALL し、
段落と GO TO で流れを作る** — を、**ルール表だけで**Javaへ落とせることを確かめる。
生成物は実際に `javac` して実際に実行し、期待値と突き合わせる。

**前提**: Executor が動いていること（手順D-2完了、または下のDocker不要版）

```bat
scripts\corpus-run.cmd -Family cobol-programs
```
```powershell
powershell -File scripts\local-corpus.ps1 -Port 8091 -Family cobol-programs   # Docker不要版
```

**変更するファイル**: なし（ケースを増やすなら手順N）

**結果の確認場所**: `reports/corpus-report.md` の `cobol-programs` 行と「Findings per case」

**合格基準**
```text
OK  01-main-calls-two-subs     gate=PASS (expected PASS) compile=True tests=4/4 uncovered=0.0%
OK  02-perform-thru-and-goto   gate=PASS (expected PASS) compile=True tests=2/2 uncovered=0.0%
OK  03-unsupported-statements  gate=FAIL (expected FAIL) compile=True tests=0/0 uncovered=66.7%
OK  04-alphanumeric-branch     gate=PASS (expected PASS) compile=True tests=2/2 uncovered=0.0%
判定: PASS (4/4 cases as expected)
```

### 何が起きているか

`corpus/families/cobol-programs/cases/01-main-calls-two-subs/input/` の3ファイルが
まとめて1回のリクエストで送られ、

1. **`analyze`** が `structure` ルールでソースをプログラム／区画／段落に切り分ける
2. **`transform`** が段落ごとに文を変換する
3. **`compile`** が3プログラム＋共有ランタイムを**1回の javac** でコンパイルする
4. **`test`** が `meta.json` の `entryProgram`（= `MAINPGM`）を実際に実行し、4通りの入力で照合する

生成されるJavaの形（1プログラム=1クラス、段落はラベル配列＋ディスパッチャ）と
COBOL構文の対応表は [`corpus/families/cobol-programs/README.md`](corpus/families/cobol-programs/README.md) にある。

| COBOL | 生成されるJava |
|---|---|
| `GO TO X.` | `return "X";` |
| `PERFORM X THRU Y.` | `perform(vars, out, "X", "Y");` |
| `PERFORM X UNTIL c.` | `while (!(c)) { perform(vars, out, "X", "X"); }` |
| `CALL 'SUB' USING A B.` | `generated.SUB.call(vars, out, "A", "B");` |
| `STOP RUN.` / `GOBACK.` | `stopRun();` / `goback();`（**別の信号**。GOBACK は呼び出し元へ戻るだけ） |

### 対応する構文を増やしたいとき

`app/src/main/resources/templates/cobol-programs-v1.json` の `rules` に**1件足すだけ**。
Javaは触らない。手順N-2を参照。

> **`compilable-v1.json` は凍結されている。** あちらの未対応範囲が
> `cobol-statements` の負例と JUnit のゲートそのものなので、触ると2つのゲートが同時に退行する。

---

## 手順K. Struts 1.3.10 → Spring Boot 4.1

**目的**: 旧Web資産の刷新。**Action / ActionForm / struts-config.xml / JSP** の4種類から
**@Controller / フォームBean / Thymeleaf テンプレート** の3種類を組み立てられることを確かめる。

> **判定方法が手順J より弱い。** Webコントローラには「これを呼べば結果が出る」共通の入口が無く、
> 実行して値を突き合わせる手が使えない。ここでの判定は
> ①**事前に用意した正解とのテキスト差分** ②**生成Javaの実コンパイル** の2本だけである。
> **業務的な正しさも意味等価性も、この手順では何も示していない。**

### K-1. 変換とゴールデン差分

**前提**: 生成Javaの実コンパイルには Spring Boot 4.1 の依存jarが要る。
Docker版のイメージには `/app/boot41-libs` として最初から入っている。
**ホスト版（`local-corpus.ps1`）では先に K-2 を一度回して `lib/` を作ること。**

```bat
scripts\corpus-run.cmd -Family struts-springboot
```

**変更するファイル**: なし
**結果の確認場所**: `reports/corpus-report.md` の `struts-springboot` 行

**合格基準**
```text
OK  01-login                   gate=PASS (expected PASS) compile=True golden=3/3 uncovered=0.0%
OK  02-search-list             gate=PASS (expected PASS) compile=True golden=3/3 uncovered=0.0%
OK  03-tiles-and-bean-write    gate=FAIL (expected FAIL) compile=True uncovered=20.8%
判定: PASS (3/3 cases as expected)  ゴールデン成果物一致 6/6
```

### K-2. 両プロジェクトを実際にビルドして画面を見る

```bat
scripts\samples-build.cmd
```
```powershell
powershell -File scripts\samples-build.ps1 -SkipRun    # 起動確認を省く
powershell -File scripts\samples-build.ps1 -Port 8099  # ポートを変える
```

やっていること:
1. ケースの `input/` を **Struts 1.3.10 プロジェクト**へ配置して `mvn package`（war ができる）
2. ケースの `output/` を **Spring Boot 4.1 プロジェクト**へ配置して `mvn package`（jar ができる）
3. Boot 4.1 の依存jarを `apps/target-springboot41/lib/` へ集める（生成コードの javac 用）
4. Boot アプリを実際に起動し、`/login` と `/search` が HTTP 200 を返すことを確認

**結果の確認場所**: `reports/samples-build.json`

**合格基準**
```text
[4/4] Spring Boot 目標プロジェクトの起動確認 (port 8099)
    /login -> HTTP 200 (320 bytes)
    /search -> HTTP 200 (314 bytes)
判定: PASS
```

> **ここで起動して見せる画面は「人手で書いた目標プロジェクト」のものである。**
> 生成物を起動しているのではない。生成物について言えるのは
> 「ゴールデンと一致した」「実際にコンパイルできた」までである。この区別を曖昧にしないこと。

### 変換されるものの実例

| Struts 側（入力） | Spring Boot 側（出力） | どのファイルから来たか |
|---|---|---|
| `public class LoginAction extends Action` | `public class LoginController` | `LoginAction.java` |
| `<action path="/login" …>` | `@RequestMapping("/login")` | `struts-config.xml` |
| `execute(ActionMapping, ActionForm, …)` | `@PostMapping public String submit(…)` | `LoginAction.java` |
| `return mapping.findForward("success")` | `return "menu";` | `struts-config.xml` の `<forward>` |
| `request.setAttribute("userId", …)` | `model.addAttribute("userId", …)` | `LoginAction.java` |
| `<html:text property="userId"/>` | `<input type="text" th:field="*{userId}"/>` | `login.jsp` |

**1つの成果物が3つの入力ファイルから組み立てられている**点が要点である。
これを行ルールだけで書くことはできないので、ルール表に `facts`（ファイル横断変数）と
`artifacts`（成果物の骨組み）という2つの表を追加してある。詳細は
[`corpus/families/struts-springboot/README.md`](corpus/families/struts-springboot/README.md)。

---

## 手順L. ルール管理基盤（履歴・差分・ロールバック・承認）

**目的**: 「設定を変えれば挙動が変わる」の**次**を確かめる。
すなわち**その設定変更を統制できるか** — 誰が変えたか、何が変わったか、戻せるか、承認を通せるか。

> **LiteFlow は履歴を持たない。** `lf_chain` / `lf_script` は発行のたびに本文を上書きし、
> `lf_change_log` はペイロードを持たない。したがって履歴・差分・ロールバック・承認・監査は
> すべて本基盤の自前テーブル（`rm_rule_revision` / `rm_approval` / `rm_audit`）で実装している。

### L-1. コマンドで端から端まで

```bat
scripts\rule-admin-demo.cmd
```

8段階を通す。
1. 無認証で管理APIを叩くと **401**
2. 参照専用ユーザーが書こうとすると **403**、実行APIは**無認証のまま**
3. 3回発行して履歴が3件積まれる
4. 版1と版3の差分が取れる
5. **版1へロールバック** → Executor の挙動が旧版に戻る（**版番号は前へ進む**）
6. 申請 → 承認 → 反映（`PENDING` → `APPLIED`）。承認前は反映されない
7. 承認権限の無いユーザーは承認できない（**403**）
8. 全操作が監査ログに残る

**結果の確認場所**: `reports/rule-admin-demo.json`（`assertions` が全部 `true` であること）

### L-2. 画面で操作する

| 画面 | URL | ログイン |
|---|---|---|
| **ルール管理** | http://localhost:8081/admin/ | 下表のいずれか |

| ユーザー名 | パスワード | できること |
|---|---|---|
| **`admin`** | **`admin123`** | 参照・発行・ロールバック・承認（すべて） |
| **`approver`** | **`approver123`** | 参照・承認／却下 |
| **`viewer`** | **`viewer123`** | 参照のみ |

> **PoC用の初期値である。本番利用は禁止。** 環境変数 `ADMIN_PASSWORD` /
> `APPROVER_PASSWORD` / `VIEWER_PASSWORD` で変更できる。

画面は4枚。
| 画面 | 内容 |
|---|---|
| `index.html` | いま有効なルール一覧（種別・ID・現行版・本文・最終更新） |
| `detail.html` | 履歴一覧、2版を選んで差分表示、**この版へ戻す**ボタン |
| `approvals.html` | 変更申請フォーム、申請一覧、**承認／却下**ボタン。`APPROVED`（承認済みだが発行に失敗して未反映）には**再適用**ボタンが出る |
| `audit.html` | 監査ログ |

### L-3. 認証がかかる範囲（重要）

| パス | 認証 | 理由 |
|---|---|---|
| `/api/rules/**` | **必要** | 管理系。GET=認証済み、POST=ADMIN、承認=APPROVER |
| `/admin/**` | **必要**（フォームログイン） | 管理画面 |
| `/api/flows/**` | 不要 | 変換の実行API。コーパスと42項目の検証が叩く |
| `/actuator/**` | 不要 | Prometheus が無認証でスクレイプする |
| `/api/templates/**`, `/api/instance` | 不要 | 参照のみ |

**この範囲を広げると、validator の42項目・`corpus-run`・`demo-transform` を全部書き換えることになる。**
広げるときは `app/src/main/java/.../config/SecurityConfig.java` と同時に
`validator/validate.py` / `scripts/corpus-run.ps1` / `scripts/demo-transform.ps1` を直すこと。

### L-4. 権限の境界は3つある（1つでも欠けると境界にならない）

| # | 仕掛け | 場所 |
|---|---|---|
| 1 | 発行（POST/PUT/DELETE）は **ADMIN のみ** | `SecurityConfig` |
| 2 | 承認・却下は **APPROVER のみ** | `SecurityConfig` |
| 3 | **申請者は自分の申請を承認できない**（403） | `RuleGovernanceService` |

3が無いと1と2は境界になりません。申請は認証済みなら誰でも出せ、承認は即発行するので、
**APPROVER だけを持つ利用者が「自分で申請して自分で承認」すれば ADMIN 無しで任意の本文を発行できます。**
`admin` は APPROVER も併せ持つため、ロールを分けるだけでは防げません。
却下は自分の申請にも許しています（取り下げにあたるため）。

### L-5. CSRF は画面だけ有効

| パス | CSRF | 送り方 |
|---|---|---|
| `/api/**` | **除外** | スクリプトと validator がトークン無しでPOSTする |
| `/admin/**` | **有効** | `XSRF-TOKEN` cookie を読んで `_csrf`（フォーム）か `X-XSRF-TOKEN`（fetch）で送る |

管理画面は素のHTML+JSで、Thymeleaf は入れていない（`templates/` が変換ルールJSONの置き場と衝突するため）
のでトークンをHTMLへ埋め込む手段がありません。そのため cookie で払い出し、
**トークンの遅延生成も切っています** — 切らないと静的な `login.html` を GET しただけでは cookie が
書かれず、`POST /admin/login` が認証の前に403になって**画面から入れなくなります**。

> この経路は**42項目では守れません**。validator も各スクリプトもすべて Basic 認証で叩くため、
> フォームログインを一度も通らないからです。守っているのは `AdminUiSecurityTest`（10件）と
> `rule-admin-demo.cmd` の 7c です。

---

## 手順M. 全レポートの判定を1枚で見る

**目的**: 「どのレポートを見ればいいのか分からない」を無くす。

```bat
scripts\summary.cmd
```

**結果の確認場所**: `reports/summary.md`

手順ごとに `PASS` / `FAIL` / `未実行` を1枚の表にする。
**何も新しく検証しない。**既に出ている証跡を読むだけである。

> `未実行` は「合格」ではなく「まだ実行していない」の意味である。

---

## 手順N. 自分で実験を追加する

**ここが一番大事な手順である。** 同梱のケースは全部**手書きの合成fixture**であり、
あなたの実資産について何も示していない。自分の題材を入れて初めて意味が出る。

### N-1. ケースを1件足す（ルールは変えない）

**変更するフォルダ**: `corpus/families/<ファミリ名>/cases/<新しいケースID>/`

```text
corpus/families/cobol-programs/cases/05-あなたのケース/
├── meta.json               ← 必須
├── input/                  ← 必須。変換元ファイルを置く（複数可）
│   └── YOURPGM.cbl
└── output/                 ← 必須（空でも作る）
    └── behaviour.json      ← 振る舞い期待値
```

`meta.json`（最小）:
```json
{
  "title": "何を確かめるケースか",
  "purpose": "なぜこのケースが必要か",
  "covers": ["MOVE", "PERFORM"],
  "knownGaps": ["このケースが意図的に扱っていないもの"],
  "maxUncoveredRate": 0.0,
  "expectQualityGate": "PASS",
  "templateProfile": "cobol-programs-v1",
  "entryProgram": "YOURPGM"
}
```

`output/behaviour.json`:
```json
[
  { "name": "説明", "given": {"WS-A": 5}, "expect": {"WS-B": 5}, "expectDisplay": ["任意"] }
]
```

**実験**: `scripts\corpus-run.cmd -Family cobol-programs`
**結果**: `reports/corpus-report.md`。未対応の文があれば「unrecognised lines」に生の行が出る

> **`expectQualityGate: "FAIL"` は負例**。落ちるのが正しい。
> 各ファミリに負例が1件以上必要（`preflight` の PF-17 が検査している）。

### N-2. ルールを1件足す（Javaは触らない）

**変更するファイル**: `app/src/main/resources/templates/<プロファイル>.json` の `rules` 配列に1件

```json
{
  "id": "add-corresponding",
  "statement": "ADD CORRESPONDING",
  "appliesTo": "ADD CORRESPONDING <a> TO <b>",
  "pattern": "^ADD\\s+CORRESPONDING\\s+(?<source>\\S+)\\s+TO\\s+(?<target>[A-Za-z0-9_-]+)\\s*\\.?$",
  "template": "vars.put(\"${target}\", num(vars.get(\"${target}\")) + num(${sourceExpr}));",
  "notes": "なぜこの変換で正しいのか、何を扱っていないのか"
}
```

**ルールは配列順に評価され、最初にマッチしたものが勝つ。より限定的なルールを前に置く。**

使えるテンプレート変数（名前付きグループ `g` ごと）:
| 変数 | 内容 |
|---|---|
| `${g}` | マッチした文字列そのまま |
| `${g}Java` | Java安全形式（`WS-A` → `WS_A`、`'ABC'` → `"ABC"`） |
| `${g}Expr` | 値を返すJava式（識別子 → `vars.get("WS-A")`、リテラル → そのまま） |
| `${g}Mapped` | プロファイルの `maps.g` で変換（`=` → `==` など） |
| `${g}List` | 空白区切りトークンを `"A", "B", "C"` に（引数の数が可変な構文用） |
| `${g}ExprList` | 同じくトークン列だが各要素を「値を返す式」に |
| `${_indent}` | いまのブロック深さに対応する字下げ |
| `${_depth}` | いまのブロック深さ（数値） |

ブロック構造を扱う任意フィールド（宣言しなければ効かない）:
| フィールド | 効果 |
|---|---|
| `opens` / `closes` | ブロック枠を積む／降ろす。`}` がメソッドかクラスかを見分けるのに使う |
| `requires` | この種別が枠の一番上にあるときだけマッチ（「最初にマッチが勝つ」を文脈依存にする） |
| `binds` | `opens` と併用。枠に変数を束縛し、枠の中のルールから参照できる |
| `continueWith` | 描画後、指定グループの中身を改めて1行としてルール表へ通す |
| `appliesToFile` / `emitTo` / `section` | 入力ファイルの絞り込みと、出力成果物・区画の振り分け |

**出力側が `${...}` を使う言語のとき（Thymeleaf など）は `$\{` と書く**とリテラルの `${` になる。

**書き間違いは診断が名指しします。** ルール表は「未知のフィールドを黙って無視する」読み方をするので、
`appliesToFiles`（複数形）のような綴り間違いは例外にならず、**宣言したつもりの効果が何も効かない**まま
静かに違う出力になります。次のどれかで気づけます。

| 見る場所 | いつ |
|---|---|
| `mvn -f app/pom.xml test -Dtest=ProfileDiagnosticsTest` | 手元で1秒未満 |
| `scripts\preflight.cmd` の PF-18 | Docker不要の静的確認 |
| `curl http://localhost:8081/api/templates/diagnostics` | 起動中のExecutorへ |
| Executor の起動ログ（`ルール表に誤りがある`） | 起動時。**例外は投げません** |

**実験の手順**
1. `app/src/main/resources/templates/*.json` を編集
2. **手順C-2**（1秒未満。ルール適用・診断・スナップショット・発火状況）
3. `scripts\local-verify.cmd`（約30秒。81テスト全部）
4. `scripts\corpus-run.cmd`（全ファミリ。**負例が PASS に変わっていないこと**を必ず見る）
5. **再ビルドせずに試したい場合**は手順G（外部ディレクトリのホットロード）

新しいルールを足したら `reports/rule-usage.json` を見てください。**対応するケースを足さないと
「宣言はあるが動く証拠が無いルール」が1本増えます**（現在 `cobol-programs-v1` に11本あります）。

### N-3. ファミリを1つ足す（別の言語・別の判定方法）

**変更するフォルダ**: `corpus/families/<新しいファミリ名>/`

```text
corpus/families/vb6-to-csharp/
├── family.json     ← 必須
├── README.md       ← 必須。このファミリが何を証明しているか
└── cases/...
```

`family.json`:
```json
{
  "family": "vb6-to-csharp",
  "title": "…",
  "purpose": "…",
  "templateProfile": "vb6-to-csharp-v1",
  "chainEl": "THEN(validate,analyze,transform,compile,goldenDiff,qualityGate,report)",
  "inputMode": "multi",
  "grading": "golden"
}
```

| キー | 選び方 |
|---|---|
| `inputMode` | `single` = `input/` の1ファイルを `sourceLines` で送る／`multi` = 全ファイルを `sourceFiles` で送る |
| `chainEl` | 生成物を**実行して**確かめるなら `test` を含める。**テキスト差分**なら `goldenDiff` を含める |
| `grading` | `behaviour` / `golden` / `both`（レポートの見出しに出る） |

あわせて `app/src/main/resources/templates/<プロファイル>.json` を新規作成する。

**忘れやすい追随作業**（これを飛ばすと `preflight` が落ちる）
| 追加したもの | 追随させるファイル |
|---|---|
| 必須ファイル（README等） | `tools/preflight.py` の `required` 一覧（PF-01） |
| `scripts/*.cmd` | `tools/preflight.py` の `cmd_files`（PF-13） |
| `scripts/*.ps1` | `tools/preflight.py` の `ps_files`（PF-14）。`$ErrorActionPreference = "Stop"` を必ず書く |
| 新しいJava API | `tools/static_compile.py` の `STUBS`（PF-09） |
| 新しい検証項目 | `validator/validate.py` の `phase_main` |

### N-4. 変更したら必ず回すもの

| 変更したもの | 回すもの |
|---|---|
| ルール表（まず最速で） | 手順C-2（**1秒未満**。Docker も Spring も不要） |
| Java / ルール表 / スクリプト | `scripts\local-verify.cmd`（約30秒。81テスト） |
| ルール表 | 追加で `scripts\corpus-run.cmd`（**負例の退行を必ず確認**） |
| ファイル構成 / スクリプト | `scripts\preflight.cmd` |
| ノードの guard / 認証範囲 | `scripts\install.cmd` → `scripts\validate.cmd`（**42項目 PASS が正式判定**） |

---

## 4. 結果ファイル一覧（`reports/`）

| ファイル | 出力元 | 見るべき点 |
|---|---|---|
| `preflight-report.md` / `.json` | 手順B | `Overall`、FAIL 件数 |
| `local-verify.json` / `local-verify.log` | 手順C | `status`、`junit.failures` |
| `junit-local/TEST-*.xml` | 手順C | ホスト側テスト結果 |
| `rule-usage.json` | 手順C | ルール発火状況。`status: PASS` は「**新しい**死んだルールが無い」の意味。`unexercisedRuleCount` が「宣言はあるが証拠が無い」本数 |
| `build-evidence.json` | 手順D-1 | `status`、`imageId` |
| `build-metadata.json` | 手順D-1 | `resolutionMode`（LiteFlowの取得経路） |
| `junit/TEST-*.xml` | 手順D-1 | コンテナ内テスト結果 |
| **`validation-report.md` / `.json`** | 手順D-2 | **正式判定。総合判定と42項目**（うち RM-01〜10 がルール管理） |
| `validation-run.log` / `install.log` | 手順D | 失敗時の生ログ |
| `*-failure.txt` | 各手順 | 失敗した工程と理由（成功時は自動削除） |
| `transform-demo.json` | 手順E | 3つの断言と各段階の生成コード |
| **`corpus-report.md` / `.json`** | 手順F/J/K | **ファミリ別サマリ・未カバー率・コンパイル率・振る舞い合格率・ゴールデン一致数** |
| `samples-build.json` | 手順K-2 | Struts と Spring Boot 両プロジェクトのビルド結果、画面のHTTPステータス |
| **`rule-admin-demo.json`** | 手順L | **認証・履歴・差分・ロールバック・承認・監査の断言15件** |
| **`summary.md` / `summary.json`** | 手順M | **全レポートの判定を1枚で** |

**まず見るべきもの**: `summary.md`（全体）→ `validation-report.md`（正式判定）→ 気になった個別レポート。

---

## 5. 主なAPI

> `/api/rules/**` は認証が必要です。以下の例では `-u admin:admin123` を付けています。
> 実行API（`/api/flows/**`）と `/actuator/**` は認証不要です。

### Chain公開（実行順を決める）
```bash
curl -u admin:admin123 -X POST http://localhost:8081/api/rules/chains \
  -H 'Content-Type: application/json' \
  -d '{"chainId":"sampleChain","el":"THEN(validate,analyze,transform,compile,test,qualityGate,report)","expectedVersion":0,"comment":"初版"}'
```
`expectedVersion` は楽観ロックです。古い版を指定すると **409** が返ります。
`comment` は履歴（`rm_rule_revision`）に残る変更理由です。

### ルール管理（履歴・差分・ロールバック・承認・監査）
```bash
curl -u admin:admin123 http://localhost:8081/api/rules                                    # 一覧
curl -u admin:admin123 http://localhost:8081/api/rules/CHAIN/sampleChain                  # 現行版
curl -u admin:admin123 http://localhost:8081/api/rules/CHAIN/sampleChain/revisions        # 履歴
curl -u admin:admin123 "http://localhost:8081/api/rules/CHAIN/sampleChain/diff?from=1&to=2"  # 差分
curl -u admin:admin123 http://localhost:8081/api/rules/audit?limit=50                     # 監査ログ

# ロールバック（旧本文を前向きに再発行する。版番号は進む）
curl -u admin:admin123 -X POST http://localhost:8081/api/rules/CHAIN/sampleChain/rollback \
  -H 'Content-Type: application/json' -d '{"toVersion":1,"comment":"戻す理由"}'

# 承認フロー（申請は承認まで LiteFlow へ反映されない）
curl -u admin:admin123 -X POST http://localhost:8081/api/rules/approvals \
  -H 'Content-Type: application/json' \
  -d '{"targetType":"CHAIN","targetId":"sampleChain","body":"THEN(validate,report)","comment":"簡素化したい"}'
curl -u admin:admin123 "http://localhost:8081/api/rules/approvals?status=PENDING"
curl -u approver:approver123 -X POST http://localhost:8081/api/rules/approvals/1/approve \
  -H 'Content-Type: application/json' -d '{"note":"承認します"}'
```

**ロールバックは「戻す」のではなく「古い本文を前向きに再発行する」操作です。**
LiteFlow に版を戻す原語は無いため、v3 の状態で v2 へ戻すと **v4** になります。履歴は消えません。

### Script node公開（変換ロジック自体をDBへ）
```bash
curl -X POST http://localhost:8081/api/rules/scripts \
  -H 'Content-Type: application/json' \
  -d '{"nodeId":"postProcess","script":"migrationContext.emit(\"// done\");","type":"script","language":"groovy","expectedVersion":0}'
```

### 変換の実行（生成 → コンパイル → 振る舞いテスト）
```bash
curl -X POST http://localhost:8081/api/flows/sampleChain/execute \
  -H 'Content-Type: application/json' \
  -d '{
        "templateProfile": "compilable-v1",
        "sourceLines": ["MOVE WS-A TO WS-B.", "ADD 1 TO WS-N."],
        "expectations": [
          {"name":"copy and count",
           "given":  {"WS-A":5,"WS-B":0,"WS-N":0},
           "expect": {"WS-B":5,"WS-N":1}}
        ],
        "maxUncoveredRate": 0.0
      }'
```
応答に `generatedCode` / `compile`（javacの実結果と診断）/ `tests`（ケース別結果）/ `coverage`（未カバー率）/ `qualityGate` が入ります。
コンパイル失敗・振る舞い不一致・未カバー率超過のいずれかで `success=false` になります。

### 参照系
```bash
curl http://localhost:8081/api/templates                # プロファイル一覧
curl http://localhost:8081/api/templates/compilable-v1  # ルール全文
curl http://localhost:8081/actuator/liteflow/ruledb     # Rule-DB同期状態
```

---

## 6. 設定の変更場所

| 変えたいもの | 場所 |
|---|---|
| **変換ルール・テンプレート** | `app/src/main/resources/templates/*.json`、または `TRANSFORM_TEMPLATEDIR` の外部ディレクトリ（手順G）。**Javaは触らない** |
| **実行順（chain）・スクリプトノード** | MariaDB の `lf_*` テーブル。`POST /api/rules/chains` / `/api/rules/scripts` で更新（**ファイルではない**） |
| 回帰ケース | `corpus/families/<ファミリ>/cases/<ID>/`（手順N-1） |
| コーパスのファミリ設定 | `corpus/families/<ファミリ>/family.json`（手順N-3） |
| 管理画面の利用者とパスワード | `app/src/main/resources/application.properties` の `admin.users.*`、または環境変数 `ADMIN_PASSWORD` / `APPROVER_PASSWORD` / `VIEWER_PASSWORD` |
| **認証がかかる範囲** | `app/src/main/java/.../config/SecurityConfig.java`（変えたら validator と3スクリプトも直す） |
| 履歴・承認・監査のテーブル | `app/src/main/resources/schema.sql`（`rm_*`。LiteFlow の `lf_*` とは別） |
| 管理画面の見た目・挙動 | `app/src/main/resources/static/admin/`（素のHTML+JS） |
| 生成コードの javac クラスパス | 環境変数 `TRANSFORM_EXTRA_CLASSPATH`（Dockerイメージでは `/app/boot41-libs`） |
| 変換先 Spring Boot の依存 | `app/boot41-classpath.pom.xml` と `corpus/families/struts-springboot/apps/target-springboot41/pom.xml`（**両方合わせる**） |
| DB接続・ポート・同期周期 | `docker-compose.yml` の `environment` |
| LiteFlow設定・actuator公開範囲 | `app/src/main/resources/application.properties` |
| Prometheusのスクレイプ対象 | `monitoring/prometheus.yml` |
| Grafanaのダッシュボード | `monitoring/grafana/dashboards/liteflow-dashboard.json` |

---

## 7. 既知の制約と上流不具合

### 上流不具合の回避（重要）
`liteflow-spring-boot4-starter:2.16.1` の公開JARは `-parameters` なしでコンパイルされており、Spring Framework 7 は `LocalVariableTableParameterNameDiscoverer` を削除しているため、LiteFlow の actuator エンドポイントの引数名を解決できず**アプリが起動しません**。

回避策として `LiteflowMetricsAutoConfiguration` を除外し、メトリクスBeanを `config/LiteflowMetricsConfig` で再登録、`/actuator/liteflow` 系は `controller/LiteflowMetaController` が提供しています。**パスも応答内容も本来と同じ**です。上流が `-parameters` 付きで再公開したら、この2クラスは削除できます。

### 実行イメージが JRE ではなく JDK
`CompileNode` が `ToolProvider.getSystemJavaCompiler()` で javac を実際に起動するためです。JRE では null が返ります。

### 変換ルールの適用範囲
現在14ルール（MOVE / ADD / ADD-GIVING / SUBTRACT / MULTIPLY / DIVIDE / COMPUTE×2 / IF / ELSE / END-IF / DISPLAY / CONTINUE / コメント）。
**`PERFORM` と `EVALUATE` は未対応**です。数値は `double` で扱うため、COMP-3 の定点十進とは一致しません。
`corpus/cases/*/meta.json` の `knownGaps` に、ケースごとの既知の穴を明記しています。

### 認証はPoC級（管理系だけ保護）
`/api/rules/**` と `/admin/**` には認証がかかり、参照（認証済み）・変更（`ADMIN`）・承認（`APPROVER`）が
ロールで分かれています（[手順L-3](#l-3-認証がかかる範囲重要)）。実行API（`/api/flows/**`）と
`/actuator/**` は**意図的に無認証のまま**です。

ただし本番水準ではありません。
- 利用者は**インメモリ**、既定パスワードは**平文**（`admin123` など）。実IdP連携（OIDC/LDAP）は無い
- **多要素認証もユーザー管理も無い**
- **公開されたGroovyスクリプトのサンドボックスが無い。** `ADMIN` ロールを取れば任意コードを
  全Executorで実行させられます。ここは承認フローで緩和しているだけで、封じてはいません
- 承認は**申請者自身が別ロールを持てば自己承認できる**（`admin` は `APPROVER` も兼ねている）。
  実運用では兼務を外すこと

詳細は `docs/STRUCTURE_REPORT.md` の P1 を参照。

---

## 8. 本番適用前に追加すべきもの

**今回作ったもの**（PoC水準では動いている）: 管理系の認証・認可とロール分離 / 発行履歴 / 版間差分 /
ロールバック / 承認フロー / 監査ログ / 管理画面

**まだ足りないもの**:
- **実IdP連携**（OIDC / LDAP）。いまはインメモリ利用者と平文の既定パスワード
- **多要素認証とユーザー管理**
- **公開されたGroovyスクリプトのサンドボックス**。`ADMIN` を取れば任意コードが全Executorで動く
- **承認の職務分離**。いまは `admin` が `APPROVER` を兼ねており自己承認できる
- **有効期間・予約公開**（「来週から適用」）と期間切れの自動失効
- **Release Bundle / Blue-Green またはルールversion固定**（複数ルールを一括で切り替える単位）
- **Actuatorの管理ネットワーク分離** / DB実行ユーザーの読取専用化 / 秘密情報管理
- **バックアップ・復旧と `lf_change_log` / `rm_*` の保持期間設計**
- **障害注入試験**（DB断・通知欠落からの再照合回復）と**無停止切替の確認**
- **実資産による容量・性能試験**
- **COBOL・Java 同値性テスト基盤**と**Struts・Spring Boot の業務等価性検証**

---

## 9. ドキュメント

| 文書 | 内容 |
|---|---|
| [`docs/STRUCTURE_REPORT.md`](docs/STRUCTURE_REPORT.md) | **構造・実測結果・修正した欠陥一覧・次にやること** |
| [`docs/USE_CASE_SCENARIOS.md`](docs/USE_CASE_SCENARIOS.md) | 想定10シナリオの元資料（適合度と検証すべき機能の一覧）。§1 の達成度表はこれに対応している |
| [`docs/TECHNICAL_REPORT.md`](docs/TECHNICAL_REPORT.md) | 検証項目の定義 |
| [`docs/COBOL_EXTENSION_BOUNDARY.md`](docs/COBOL_EXTENSION_BOUNDARY.md) | COBOL変換へ拡張する際の責務境界と合格基準 |
| [`corpus/README.md`](corpus/README.md) | コーパスのファミリ索引・共通書式・**実資産の投入方法** |
| [`corpus/families/cobol-statements/README.md`](corpus/families/cobol-statements/README.md) | COBOL 1文変換（**凍結**の理由） |
| [`corpus/families/cobol-programs/README.md`](corpus/families/cobol-programs/README.md) | **COBOL 複数ファイル変換**。対応構文一覧と生成されるJavaの形 |
| [`corpus/families/struts-springboot/README.md`](corpus/families/struts-springboot/README.md) | **Struts → Spring Boot 変換**。ルール表の3つの表（facts / artifacts / rules） |
| [`CLAUDE.md`](CLAUDE.md) | Claude Code で開発する際のガイド（規約・地雷・禁止事項） |
