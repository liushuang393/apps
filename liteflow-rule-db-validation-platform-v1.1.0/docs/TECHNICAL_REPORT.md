# LiteFlow v2.16.1 Rule-DB 検証基盤 技術報告

Package version: 1.1.0

## 1. 目的

本基盤は、LiteFlow v2.16.1のRule-DBを企業システムで採用できるかについて、文書上の評価だけでなく、再現可能な実行証跡に基づいて判断するためのPoC環境である。

## 2. 検証対象

| 分類 | 検証内容 | 方法 |
|---|---|---|
| ビルド | Spring Boot 4とLiteFlow 2.16.1の依存整合性 | Docker内Mavenビルド・JUnit |
| Rule-DB | MariaDBを正本としてChainを保存 | RulePublisher API |
| 公開 | 新規公開、version更新 | PublishChainRequest |
| 競合 | 古いversionによる更新拒否 | expectedVersion |
| 同期 | 2台のExecutorが同じversionへ収束 | Aで公開、Bでポーリング実行 |
| 動的変更 | v1とv2でNode順序が変わる | 実行trace比較 |
| 障害 | 例外Nodeを含むChain | LiteflowResponseの失敗確認 |
| 並列性 | 複数HTTP要求を同時実行 | 50件並列検証 |
| 永続性 | Executor再起動後の既存Chain実行 | B再起動後に再実行 |
| 可観測性 | Rule-DB状態と実行指標 | Actuator／Prometheus |
| 監視 | Prometheus target、Grafana health | HTTP API |

## 2.1 依存関係の再現性

2.16.1公開直後のMaven Central同期遅延を考慮し、ビルドは二段階で依存関係を解決する。

1. Maven Centralから2.16.1のStarterとRule-DB SQLを取得する。
2. 取得できない場合、公式GitHubリポジトリの固定コミットを取得し、必要モジュールのみ `mvn install` する。

利用した経路とコミットはDockerイメージ内の `build-metadata.json` に保存し、最終レポートへ取り込む。これにより、単に「2.16.1」と記録するだけでなく、実際に利用したソースを追跡できる。

## 3. 非対象

この検証結果から、COBOL→Java変換が容易である、または変換精度が十分であるとは判断しない。

LiteFlowは処理順序を制御する基盤であり、COBOLの意味解析、Java生成、データ型変換、業務同値性を提供しない。これらは別の変換エンジンと評価データセットが必要である。

## 4. 採用判断の考え方

次の条件を満たした場合、LiteFlowを「変換処理のオーケストレーション層」として次段階のPoCへ進める。

- 2台のExecutorでルールが許容時間内に収束する
- ルール更新競合を検出できる
- 再起動後もルールを再ロードできる
- 失敗Chainを正常Chainと区別して監視できる
- Chain／Nodeメトリクスを監視基盤へ連携できる
- Nodeの追加・削除によって処理フローを外部変更できる

## 5. 実行後の証跡

実行結果は `reports/validation-report.md` と `reports/validation-report.json` に出力される。

レポートには、単なる「成功／失敗」ではなく、以下の観測値を記録する。

- 公開versionとchange sequence
- Executor A／Bの実行trace
- v2への収束時間
- 楽観ロック時のHTTP statusと例外内容
- 並列実行成功数
- HTTP実行時間のP50／P95
- Rule-DB runtime snapshot
- LiteFlowメトリクス名
- Prometheus target状態
- 再起動後の実行結果

## 6. 判定上の注意

本PoCでPASSになっても、本番導入を自動的に承認するものではない。Rule-DBは最終整合性であり、全ノードを同一時刻に切り替える仕組みではない。重要処理では、業務データへのルールversion記録、Release Bundle、Blue-Green、流量制御などを追加する必要がある。


## 7. Packaging verification status

The package includes an actually executed host preflight report at `reports/preflight-report.md`.
Docker, MariaDB, Maven dependency download, and multi-node E2E remain explicitly unverified in the packaging environment because Docker is unavailable there. They are never marked PASS until `run-all.cmd` or `run-all.sh` produces `reports/validation-report.md`.
