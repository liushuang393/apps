# COBOL→Java実装への拡張境界

## 1. 本PoCのNodeについて

`analyze`、`transform`、`compile`、`test` などのNodeは、LiteFlowの実行順序、Rule-DB同期、失敗伝播、監視を検証するための**トレース用スタブ**である。COBOL解析器、Java生成器、コンパイラ連携、同値性検証を実装したものではない。

## 2. 実運用で置き換えるコンポーネント

| Node | 実装責務 | 最低限の出力証跡 |
|---|---|---|
| `sourceInventory` | COBOL、COPY、JCL、DDL、外部CALLの棚卸し | ファイル一覧、hash、依存関係 |
| `cobolParse` | 方言を考慮した構文解析 | AST、未解析構文、位置情報 |
| `semanticModel` | PIC、COMP-3、REDEFINES、OCCURS、PERFORM等の意味モデル化 | 型モデル、制御フロー、データフロー |
| `migrationDesign` | Java構造、DB、トランザクション、例外設計 | 変換方針、対応表、リスク |
| `javaGenerate` | Java／Spring Bootコード生成 | 生成物、生成ルールversion、由来 |
| `compile` | Maven／Gradleによる実コンパイル | compiler log、warning、error分類 |
| `unitTestGenerate` | JUnit、境界値、異常系の生成 | テストコード、対象要件 |
| `differentialTest` | COBOLとJavaの入出力比較 | ケース別差分、許容誤差、証跡 |
| `qualityGate` | 品質基準の機械判定 | gate結果、失敗理由 |
| `report` | 変換・試験・未対応事項の報告 | Markdown／JSON／HTML |

## 3. 必須データセット

COBOL→Javaの有効性を判断するには、少なくとも以下が必要である。

- 実COBOL資産とCOPYBOOK
- 正常系、境界値、異常系の入力データ
- 現行COBOL実行結果
- 期待Java実行結果または業務ルール
- DB更新前後、ファイル出力、帳票、外部CALLの証跡
- 方言・コンパイラオプション
- 数値丸め、文字コード、日時、トランザクション仕様

## 4. 合格基準例

- 構文解析成功率だけで合格としない
- コンパイル成功率だけで合格としない
- 業務入出力同値率、DB差分、例外動作を主要指標とする
- 未変換・推測変換・人手確認箇所を明示する
- 変換ルールversionと生成物hashを保存する
- 差分再変換後も未変更領域の回帰試験を行う

## 5. LiteFlowの責務

LiteFlowは上記コンポーネントの順序、分岐、再試行、停止、監視を担当する。変換精度は各Nodeの実装と評価データセットによって決まり、LiteFlowを採用しただけでは向上しない。
