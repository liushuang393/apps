# LiteFlow Rule-DB 検証基盤に適した使用シナリオ Top 10

## 1. 目的

LiteFlow Rule-DB の検証基盤では、単に「DBからルールを読み込めるか」を確認するだけでは不十分である。

特に、以下の能力を実業務に近い条件で確認する必要がある。

- ルールの動的変更

- 複数実行ノードへの反映

- 大量ルールの遅延ロード

- ルールのバージョン管理・競合制御

- 障害発生後の自動収束

- 監視・性能・運用性

- 旧方式からの移行可能性

Rule-DB は、ルール保存先を正本とし、JVMにはルール一覧・影オブジェクト・状態インデックスを常駐させ、EL本文やスクリプトを必要時にロードする仕組みである。また、変更通知と定期照合による複数ノードの最終的な収束、統一された `RulePublisher` API、Actuatorによる状態確認を提供する。([LiteFlow](https://liteflow.cc/pages/8ff02a/ "🚀whats new in v2.16.1 | LiteFlow"))

LiteFlowは、通常のJavaコードを減らすためのフレームワークではない。

**「複雑で、組み替えが必要で、頻繁に変更される業務フロー」をJavaコードから分離して管理するためのフレームワークである。**

単純で安定した処理はJavaに残し、変化が多く外部管理の価値がある部分だけにLiteFlow／Rule-DBを適用することが、最も現実的な使用方法である。

## 使用境界のまとめ

### 適している

- 複雑で変更頻度が高い業務フロー
- 再デプロイせずに変更したいルール
- 複数の業務機能を組み替える処理
- 顧客・商品・地域別に異なるフロー
- 実行履歴やルールバージョン管理が必要な業務
- 複数ノードで同じルールを共有するシステム

---

# 2. 使用シナリオ総合ランキング

| 順位  | 使用シナリオ                                      | 適合度   | 主に検証できる機能                      |
| --- | ------------------------------------------- | ----- | ------------------------------ |
| 1   | EC注文処理・配送ルート動的切替                            | ★★★★★ | 動的更新、複数ノード同期、障害時収束             |
| 2   | 大量ルールを持つ審査・判定基盤                             | ★★★★★ | 遅延ロード、キャッシュ、メモリ削減              |
| 3   | 業務ルール管理画面・ルール公開基盤                           | ★★★★★ | RulePublisher、楽観ロック、履歴管理       |
| 4   | マルチテナント型SaaS業務フロー                           | ★★★★☆ | application-name分離、共通基盤化       |
| 5   | レガシーシステム移行・ルール外出し                           | ★★★★☆ | 旧プラグイン移行、差分検証、回帰試験             |
| 6   | キャンペーン・料金・割引ルール管理                           | ★★★★☆ | 頻繁なルール更新、即時反映、ロールバック           |
| 7   | 複数ノード同期・障害回復検証                              | ★★★★☆ | 通知欠落、再照合、最終一致性                 |
| 8   | スクリプト型業務ロジックの動的配信                           | ★★★★☆ | Groovy等のスクリプト更新、遅延コンパイル        |
| 9   | 監視・SRE・性能評価基盤*Site Reliability Engineering* | ★★★☆☆ | Micrometer、Prometheus、Actuator |
| 10  | 複数バックエンド比較・選定基盤                             | ★★★☆☆ | SQL、Redis、Nacos、etcd等の比較       |

---

# 3. 詳細

## 第1位：EC注文処理・配送ルート動的切替

### 概要

注文内容、在庫状況、配送先、顧客ランク、商品分類などに応じて、処理フローを動的に変更するシナリオである。

### 処理例

```text
注文受付
  ↓
在庫確認
  ↓
顧客ランク判定
  ↓
高額注文の場合は不正検知
  ↓
配送拠点選択
  ↓
決済
  ↓
出荷通知
```

LiteFlowのルール例：

```text
IF(highValueOrder, THEN(fraudCheck, manualReview), normalCheck)
```

キャンペーン期間だけ次のように変更する。

```text
IF(highValueOrder, THEN(fraudCheck, campaignReview), normalCheck)
```

### Rule-DBが適する理由

注文サービスが複数ノードで稼働していても、ルール変更を各ノードに通知し、通知漏れが発生した場合は周期的な照合で再収束できる。SQL系バックエンドでは標準で数秒間隔の変更検知を行い、さらに定期的な全件照合を行う。([LiteFlow](https://liteflow.cc/pages/8ff02a/ "🚀whats new in v2.16.1 | LiteFlow"))

### 検証項目

- ルール公開後、各ノードに反映されるまでの時間

- 更新前後の注文がどのバージョンで処理されたか

- 1ノード停止中にルールを変更した場合の復帰動作

- DB一時停止時の既存キャッシュによる処理継続

- 誤ったルール公開時のロールバック

- 同一注文に対する二重実行防止

### 重要KPI

| KPI          | 目標例       |
| ------------ | --------- |
| ルール反映時間      | 5秒以内      |
| ルール同期成功率     | 99.99%以上  |
| 通常時キャッシュヒット率 | 95%以上     |
| 注文処理P95      | 既存比＋10%以内 |
| ルール変更による処理停止 | 0件        |

### 注意点

Rule-DBは最終一致性であり、全ノードを同じ瞬間に原子的に切り替えるものではない。反映途中では旧版と新版が一時的に混在する可能性があるため、注文ごとに適用ルールバージョンを記録する設計が必要である。([LiteFlow](https://liteflow.cc/pages/8ff02a/ "🚀whats new in v2.16.1 | LiteFlow"))

---

## 第2位：大量ルールを持つ審査・判定基盤

### 概要

商品、地域、顧客区分、契約種別などによって、数千～数万件の判定ルールを保有する業務を想定する。

例：

- 保険引受条件

- 与信事前判定

- 商品掲載審査

- 不正取引スクリーニング

- 契約条件チェック

- 製造品質判定

### Rule-DBが適する理由

旧方式ではルール本文やスクリプトを全件JVMにロードしていたが、Rule-DBでは起動時に軽量な影オブジェクトを作成し、実際に使われるルールだけをロードする。ロード済みルールはCaffeineの有界キャッシュに保存され、アクセス頻度に応じて入れ替えられる。公式説明では、デフォルトのキャッシュ容量は500 chainである。([LiteFlow](https://liteflow.cc/pages/8ff02a/ "🚀whats new in v2.16.1 | LiteFlow"))

### 検証データ例

```text
ルール総数          50,000件
1日利用ルール       2,000件
高頻度ルール          300件
低頻度ルール       47,700件
実行ノード              10台
```

### 検証項目

- 1,000、10,000、50,000ルールでの起動時間

- 起動直後のヒープ使用量

- 初回実行時のロード時間

- キャッシュヒット時の処理時間

- キャッシュ追い出し後の再ロード時間

- 複数ノードでの総メモリ使用量

- ルール一覧数増加による影オブジェクトのメモリ影響

### 重要KPI

| KPI             | 目標例       |
| --------------- | --------- |
| 50,000ルール時の起動時間 | 60秒以内     |
| 初回ロードP95        | 200ms以内   |
| キャッシュヒット時P95    | 20ms以内    |
| JVMヒープ削減率       | 旧方式比30%以上 |
| OutOfMemory発生   | 0件        |

### 注意点

Rule-DBでも、ルール一覧、影オブジェクト、バージョン、状態インデックスはルール数に比例して増加する。したがって「ルール数が増えてもメモリが増えない」わけではなく、実データ量での測定が必要である。([LiteFlow](https://liteflow.cc/pages/8ff02a/ "🚀whats new in v2.16.1 | LiteFlow"))

---

## 第3位：業務ルール管理画面・ルール公開基盤

### 概要

業務担当者または運用担当者が、管理画面からルールを登録、更新、削除、公開するシナリオである。

### 代表機能

```text
ルール一覧
ルール編集
構文チェック
差分表示
テスト実行
承認申請
本番公開
公開履歴
ロールバック
ノード反映状況
```

### Rule-DBが適する理由

Rule-DBでは、直接SQLを書き換えるのではなく、統一された `RulePublisher` を利用する。公開時には、内容更新、バージョン増加、MD5再計算、変更履歴などをバックエンドのトランザクション、LuaまたはCASで処理する。`expectedVersion` を利用した楽観ロックも可能である。([LiteFlow](https://liteflow.cc/pages/ruledb-overview/ "🏦Rule-DB是什么 | LiteFlow"))

### 実装構成

```text
[ルール管理UI]
      ↓ REST API
[Rule Management Service]
      ↓ RulePublisher
[Rule-DB]
      ↓ 通知・ポーリング
[LiteFlow実行ノード群]
```

### 検証項目

- 新規登録時の `expectedVersion=0`

- 同時編集時のバージョン競合

- 更新・削除の履歴保存

- 公開前の構文チェック

- 開発、検証、本番環境の昇格

- 公開後の各ノード反映状態

- ロールバック時の再公開処理

- 権限別操作制限

### 必須追加機能

RulePublisherは、公開時にEL全体をコンパイルして、存在しないJavaコンポーネントや子chainまで検証するわけではない。誤った参照は、実行ノードが初めてロード・コンパイルした時点で判明する可能性がある。したがって、管理基盤側に「公開前コンパイル・テスト実行」を追加すべきである。([LiteFlow](https://liteflow.cc/pages/ruledb-overview/ "🏦Rule-DB是什么 | LiteFlow"))

### 推奨公開フロー

```text
編集
 ↓
構文検査
 ↓
参照コンポーネント検査
 ↓
単体テスト
 ↓
影響chain抽出
 ↓
承認
 ↓
検証環境公開
 ↓
本番公開
 ↓
同期確認
```

---

## 第4位：マルチテナント型SaaS業務フロー

### 概要

複数の顧客企業に同じ業務サービスを提供しながら、顧客ごとに異なる処理ルールを設定する。

### 例

```text
tenant-a-order-service
tenant-b-order-service
tenant-c-order-service
```

またはサービス単位で分離する。

```text
order-service
billing-service
support-service
```

### Rule-DBが適する理由

`liteflow.rule-db.application-name` によってルールの隔離名を設定できる。同じデータベースを利用していても、異なるapplication-nameのルールは相互に参照されない。Spring Bootでは、未指定時に `spring.application.name` が利用される。([LiteFlow](https://liteflow.cc/pages/ruledb-sql/ "🐬快速开始(SQL) | LiteFlow"))

### 検証項目

- テナント間でのルール参照混入

- Publisher側と実行側のapplication-name不一致

- テナント追加時の初期化

- テナントごとのルール数上限

- テナント単位の監視

- テナント単位のロールバック

- 共通ルールと個別ルールの継承方法

### 設計上の注意

Rule-DBのapplication-nameは基本的な分離単位であり、完全なマルチテナント管理機能ではない。

以下は別途実装が必要である。

- テナント別認可

- テナント別公開承認

- 利用量制限

- 監査ログ

- テナント別暗号化

- 共通ルールの継承・上書き

---

## 第5位：レガシーシステムの部分移行・業務フロー外出し

## 1. 概要

COBOL、PL/I、Struts、旧Javaシステムなどに埋め込まれている業務フローのうち、**変更頻度が高い処理順序や分岐構造だけをLiteFlowへ段階的に移行する**。

既存システム全体をLiteFlowへ置き換えるのではなく、以下のように役割を分ける。

- 既存の業務ロジック：原則として既存Serviceに残す

- 処理順序・分岐構造：LiteFlowのchainへ移す

- 頻繁に変わる条件：必要に応じてRule-DBへ外出しする

- DB更新・API呼び出し・トランザクション：既存実装を再利用する

LiteFlowはレガシーコードの自動変換ツールではないため、移行対象は、複雑で変更頻度の高い業務フローに限定する。

---

## 2. 移行対象となる既存処理

### 既存コード例

```java
@Service
public class ApprovalService {

    public void approve(Order order) {

        validate(order);

        if ("A".equals(order.getCustomerRank())
                && order.getAmount() > 100000) {
            manualApprove(order);
        } else {
            autoApprove(order);
        }

        notifyResult(order);
    }

    private void validate(Order order) {
        // 入力検証
    }

    private void manualApprove(Order order) {
        // 人工承認登録
    }

    private void autoApprove(Order order) {
        // 自動承認処理
    }

    private void notifyResult(Order order) {
        // 結果通知
    }
}
```

既存処理の流れは次のとおりである。

```text
ApprovalService.approve
        │
        ├─ validate
        │
        ├─ 条件判定
        │    ├─ 顧客ランクがA
        │    └─ 金額が100,000超
        │
        ├─ manualApprove または autoApprove
        │
        └─ notifyResult
```

---

## 3. 移行方針

推奨するのは、既存の業務処理を全面的に書き換えず、LiteFlowから呼び出せるように薄いコンポーネントを追加する方式である。

```text
移行前
Controller
   ↓
ApprovalService.approve
   ↓
既存ロジックを直接実行
```

```text
移行後
Controller
   ↓
ApprovalFlowService
   ↓
LiteFlow FlowExecutor
   ↓
LiteFlow Chain
   ↓
各LiteFlowコンポーネント
   ↓
既存ApprovalService
```

この構成により、LiteFlowはフロー制御だけを担当し、既存Serviceは実際の業務処理を担当する。

---

## 4. 移行後の全体構成

```text
┌──────────────────────────────┐
│ ApprovalController           │
│ 承認APIの受付                │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ ApprovalFlowService          │
│ FlowExecutorを呼び出す       │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ LiteFlow Chain               │
│ approvalChain                │
│                              │
│ THEN(                        │
│   validateOrder,             │
│   IF(                        │
│     requiresManualApproval,  │
│     manualApprove,           │
│     autoApprove              │
│   ),                         │
│   notifyResult               │
│ )                            │
└──────────────┬───────────────┘
               │
       ┌───────┼────────┬────────────┐
       ▼       ▼        ▼            ▼
 validateOrder 条件判定 manualApprove autoApprove
       │                  │            │
       └──────────┬───────┴──────┬─────┘
                  ▼              ▼
          既存ApprovalService
                  │
                  ▼
         Repository・外部API
```

---

## 5. 移行後のchain定義

移行後のフロー全体は、次のように定義する。

```text
THEN(
    validateOrder,
    IF(
        requiresManualApproval,
        manualApprove,
        autoApprove
    ),
    notifyResult
)
```

一行で記述する場合：

```text
THEN(validateOrder, IF(requiresManualApproval, manualApprove, autoApprove), notifyResult);
```

各要素の役割は以下のとおりである。

| コンポーネント                  | 種別         | 役割           |
| ------------------------ | ---------- | ------------ |
| `validateOrder`          | 通常ノード      | 注文情報を検証する    |
| `requiresManualApproval` | Booleanノード | 人工承認が必要か判定する |
| `manualApprove`          | 通常ノード      | 人工承認処理を呼び出す  |
| `autoApprove`            | 通常ノード      | 自動承認処理を呼び出す  |
| `notifyResult`           | 通常ノード      | 承認結果を通知する    |

---

## 6. 移行時に追加するコンポーネント

### 6.1 ApprovalFlowContext

各LiteFlowコンポーネント間で注文情報や処理結果を共有するためのコンテキストを追加する。

```java
public class ApprovalFlowContext {

    private Order order;
    private ApprovalResult approvalResult;

    public Order getOrder() {
        return order;
    }

    public void setOrder(Order order) {
        this.order = order;
    }

    public ApprovalResult getApprovalResult() {
        return approvalResult;
    }

    public void setApprovalResult(ApprovalResult approvalResult) {
        this.approvalResult = approvalResult;
    }
}
```

---

### 6.2 ValidateOrderComponent

既存の入力検証処理を呼び出すコンポーネントを追加する。

```java
@LiteflowComponent("validateOrder")
public class ValidateOrderComponent extends NodeComponent {

    private final ApprovalService approvalService;

    public ValidateOrderComponent(ApprovalService approvalService) {
        this.approvalService = approvalService;
    }

    @Override
    public void process() {
        ApprovalFlowContext context = getFirstContextBean();
        approvalService.validate(context.getOrder());
    }
}
```

---

### 6.3 RequiresManualApprovalComponent

既存コードに存在した条件式を担当するBooleanコンポーネントを追加する。

```java
@LiteflowComponent("requiresManualApproval")
public class RequiresManualApprovalComponent
        extends NodeBooleanComponent {

    @Override
    public boolean processBoolean() {

        ApprovalFlowContext context = getFirstContextBean();
        Order order = context.getOrder();

        return "A".equals(order.getCustomerRank())
                && order.getAmount() > 100000;
    }
}
```

既存コードの以下の条件は、このコンポーネントへ移動する。

```java
"A".equals(order.getCustomerRank())
        && order.getAmount() > 100000
```

ただし、この条件が固定的でほとんど変更されない場合は、無理にRule-DBへ外出しする必要はない。

---

### 6.4 ManualApproveComponent

既存の人工承認処理を呼び出すコンポーネントを追加する。

```java
@LiteflowComponent("manualApprove")
public class ManualApproveComponent extends NodeComponent {

    private final ApprovalService approvalService;

    public ManualApproveComponent(ApprovalService approvalService) {
        this.approvalService = approvalService;
    }

    @Override
    public void process() {

        ApprovalFlowContext context = getFirstContextBean();

        ApprovalResult result =
                approvalService.manualApprove(context.getOrder());

        context.setApprovalResult(result);
    }
}
```

---

### 6.5 AutoApproveComponent

既存の自動承認処理を呼び出すコンポーネントを追加する。

```java
@LiteflowComponent("autoApprove")
public class AutoApproveComponent extends NodeComponent {

    private final ApprovalService approvalService;

    public AutoApproveComponent(ApprovalService approvalService) {
        this.approvalService = approvalService;
    }

    @Override
    public void process() {

        ApprovalFlowContext context = getFirstContextBean();

        ApprovalResult result =
                approvalService.autoApprove(context.getOrder());

        context.setApprovalResult(result);
    }
}
```

---

### 6.6 NotifyResultComponent

既存の結果通知処理を呼び出すコンポーネントを追加する。

```java
@LiteflowComponent("notifyResult")
public class NotifyResultComponent extends NodeComponent {

    private final ApprovalService approvalService;

    public NotifyResultComponent(ApprovalService approvalService) {
        this.approvalService = approvalService;
    }

    @Override
    public void process() {

        ApprovalFlowContext context = getFirstContextBean();

        approvalService.notifyResult(
                context.getOrder(),
                context.getApprovalResult()
        );
    }
}
```

---

### 6.7 ApprovalFlowService

既存のControllerからLiteFlowを呼び出すためのフロー実行Serviceを追加する。

```java
@Service
public class ApprovalFlowService {

    private final FlowExecutor flowExecutor;

    public ApprovalFlowService(FlowExecutor flowExecutor) {
        this.flowExecutor = flowExecutor;
    }

    public ApprovalResult execute(Order order) {

        ApprovalFlowContext context = new ApprovalFlowContext();
        context.setOrder(order);

        LiteflowResponse response =
                flowExecutor.execute2Resp(
                        "approvalChain",
                        null,
                        context
                );

        if (!response.isSuccess()) {
            throw new ApprovalFlowException(
                    response.getMessage()
            );
        }

        return context.getApprovalResult();
    }
}
```

---

## 7. 既存クラスで変更する箇所

### 7.1 ApprovalController

移行前は既存の `ApprovalService.approve()` を直接呼び出している。

```java
@RestController
public class ApprovalController {

    private final ApprovalService approvalService;

    public ApprovalResult approve(Order order) {
        return approvalService.approve(order);
    }
}
```

移行後は `ApprovalFlowService` を呼び出す。

```java
@RestController
public class ApprovalController {

    private final ApprovalFlowService approvalFlowService;

    public ApprovalResult approve(Order order) {
        return approvalFlowService.execute(order);
    }
}
```

変更点は、呼び出し先を次のように切り替えることである。

```text
変更前：
ApprovalController
    → ApprovalService.approve

変更後：
ApprovalController
    → ApprovalFlowService.execute
    → LiteFlow
    → ApprovalServiceの個別メソッド
```

---

### 7.2 ApprovalService

既存の `approve()` メソッドに含まれていたフロー制御を分離する。

#### 移行前

```java
public ApprovalResult approve(Order order) {

    validate(order);

    ApprovalResult result;

    if ("A".equals(order.getCustomerRank())
            && order.getAmount() > 100000) {
        result = manualApprove(order);
    } else {
        result = autoApprove(order);
    }

    notifyResult(order, result);

    return result;
}
```

#### 移行後

```java
@Service
public class ApprovalService {

    public void validate(Order order) {
        // 既存の入力検証処理
    }

    public ApprovalResult manualApprove(Order order) {
        // 既存の人工承認処理
        return new ApprovalResult();
    }

    public ApprovalResult autoApprove(Order order) {
        // 既存の自動承認処理
        return new ApprovalResult();
    }

    public void notifyResult(
            Order order,
            ApprovalResult result) {
        // 既存の通知処理
    }
}
```

既存の業務ロジックは残し、処理順序だけをLiteFlowへ移す。

---

## 8. 追加・変更対象一覧

### 新規追加するクラス

| クラス                               | 役割                  |
| --------------------------------- | ------------------- |
| `ApprovalFlowService`             | LiteFlowのchainを実行する |
| `ApprovalFlowContext`             | 注文情報と処理結果を共有する      |
| `ValidateOrderComponent`          | 既存検証処理を呼び出す         |
| `RequiresManualApprovalComponent` | 人工承認条件を判定する         |
| `ManualApproveComponent`          | 既存人工承認処理を呼び出す       |
| `AutoApproveComponent`            | 既存自動承認処理を呼び出す       |
| `NotifyResultComponent`           | 既存通知処理を呼び出す         |
| `ApprovalFlowException`           | フロー実行エラーを表現する       |

### 新規追加する設定・データ

| 対象            | 内容                           |
| ------------- | ---------------------------- |
| Rule-DB chain | `approvalChain`              |
| LiteFlow設定    | Rule-DB接続情報、application-name |
| テストデータ        | ランク、金額、期待承認方法                |
| 監視設定          | chain失敗数、実行時間、Rule-DB同期状態    |

### 変更する既存クラス

| 既存クラス                | 変更内容                           |
| -------------------- | ------------------------------ |
| `ApprovalController` | 呼び出し先を`ApprovalFlowService`へ変更 |
| `ApprovalService`    | フロー制御を削除し、個別業務処理を公開            |
| 既存テスト                | LiteFlow経由のフロー試験を追加            |
| 例外処理                 | LiteFlow実行例外を既存API例外へ変換        |

### 原則として変更しないもの

| 対象          | 方針                |
| ----------- | ----------------- |
| Repository  | 既存実装を再利用          |
| DBアクセス処理    | 既存Service経由で利用    |
| 外部APIクライアント | 既存実装を再利用          |
| DTO・Entity  | 必要がなければ変更しない      |
| 業務計算ロジック    | 原則として既存Serviceに残す |

---

## 9. 移行後の実行シーケンス

### Aランク・150,000円の場合

```text
1. ApprovalControllerが注文を受け付ける
2. ApprovalFlowService.executeを呼び出す
3. FlowExecutorがapprovalChainを開始する
4. validateOrderが注文を検証する
5. requiresManualApprovalが条件を判定する
6. 条件結果がtrueになる
7. manualApproveが既存Serviceを呼び出す
8. ApprovalResultをContextへ保存する
9. notifyResultが通知処理を呼び出す
10. ApprovalFlowServiceが結果をControllerへ返却する
```

呼び出し関係：

```text
ApprovalController
    ↓
ApprovalFlowService
    ↓
FlowExecutor
    ↓
approvalChain
    ↓
ValidateOrderComponent
    ↓
ApprovalService.validate
    ↓
RequiresManualApprovalComponent
    ↓ true
ManualApproveComponent
    ↓
ApprovalService.manualApprove
    ↓
NotifyResultComponent
    ↓
ApprovalService.notifyResult
```

### Bランク・150,000円の場合

```text
ApprovalController
    ↓
ApprovalFlowService
    ↓
FlowExecutor
    ↓
approvalChain
    ↓
ValidateOrderComponent
    ↓
RequiresManualApprovalComponent
    ↓ false
AutoApproveComponent
    ↓
ApprovalService.autoApprove
    ↓
NotifyResultComponent
```

---

## 10. 条件もRule-DBへ外出しする場合

前述の構成では、以下の条件はJavaコンポーネント内に残る。

```java
"A".equals(order.getCustomerRank())
        && order.getAmount() > 100000
```

この場合、金額条件を変更するには、Javaコードの修正と再デプロイが必要である。

条件を頻繁に変更する必要がある場合は、BooleanスクリプトとしてRule-DBへ保存する方式を検討する。

### Rule-DBで管理する対象

```text
Chain：
THEN(
    validateOrder,
    IF(
        requiresManualApproval,
        manualApprove,
        autoApprove
    ),
    notifyResult
)
```

```text
Booleanスクリプト：
customerRank == "A"
かつ
amount > 100000
```

この方式では、Rule-DB上の条件を変更することで、アプリケーションを再デプロイせずに閾値を変更できる。

ただし、以下の追加対策が必要になる。

- 公開前のスクリプト構文検査

- テスト実行

- 承認フロー

- バージョン管理

- ロールバック

- 不正スクリプト対策

- 実行時間制限

固定的な条件であればJavaに残し、頻繁に変わる条件だけをRule-DBへ外出しする。

---

## 11. トランザクション設計上の注意

既存の `approve()` メソッド全体が一つのトランザクションであった場合、LiteFlow化によってトランザクション境界が変わる可能性がある。

移行前：

```text
ApprovalService.approve
    └─ 一つのトランザクション
```

移行後：

```text
validateOrder
manualApproveまたはautoApprove
notifyResult
```

各コンポーネントが個別にServiceを呼び出すため、既存のトランザクション要件を確認する必要がある。

対応方法としては、以下が考えられる。

1. `ApprovalFlowService.execute()` 全体にトランザクションを設定する

2. 各業務処理単位でトランザクションを分割する

3. 通知処理だけをトランザクション外にする

4. 外部API処理には補償処理を設ける

単純にコンポーネントへ分割するだけでは、既存システムと同じ動作になるとは限らない。

---

## 12. 推奨する移行手順

### Step 1：現行処理を分析する

- 現在の処理順序

- 条件分岐

- DB更新

- 外部API呼び出し

- トランザクション境界

- 例外処理

- 処理結果

### Step 2：LiteFlow化する範囲を決める

以下だけを対象にする。

- 変更頻度が高い処理順序

- 複雑化した業務分岐

- 複数業務で再利用できる処理

- 顧客・商品別に異なるフロー

単純な入力チェックや局所的な `if` はJavaに残す。

### Step 3：既存Serviceを業務単位に分離する

```text
validate
manualApprove
autoApprove
notifyResult
```

### Step 4：薄いLiteFlowコンポーネントを追加する

コンポーネント内部で業務処理を再実装せず、既存Serviceを呼び出す。

### Step 5：Contextを設計する

- 入力データ

- 中間結果

- 承認結果

- エラー情報

- 適用ルールバージョン

### Step 6：ChainをRule-DBへ登録する

```text
THEN(
    validateOrder,
    IF(
        requiresManualApproval,
        manualApprove,
        autoApprove
    ),
    notifyResult
)
```

### Step 7：Controllerの呼び出し先を切り替える

```text
ApprovalService
    ↓
ApprovalFlowService
```

### Step 8：新旧比較テストを実施する

同じ入力データを旧処理と新処理に投入し、以下を比較する。

- 承認結果

- DB更新内容

- 外部API呼び出し

- 通知内容

- 例外

- 実行順序

- 処理時間

### Step 9：段階的に切り替える

- 特定の顧客だけLiteFlow経由にする

- 特定の商品だけ対象にする

- Feature Flagで旧新処理を切り替える

- 問題発生時は旧処理へ戻せるようにする

---

## 13. 移行前後の比較

| 項目        | 移行前             | 移行後                    |
| --------- | --------------- | ---------------------- |
| フロー定義     | Javaコード内部       | LiteFlow chain         |
| 業務処理      | ApprovalService | 既存Serviceを継続利用         |
| 条件判定      | Javaのif文        | Booleanコンポーネントまたはスクリプト |
| 処理順序変更    | Java修正・再デプロイ    | Rule-DB更新              |
| 既存Service | 直接呼び出し          | LiteFlowコンポーネント経由      |
| データ共有     | メソッド引数・戻り値      | FlowContext            |
| 実行経路      | コード解析が必要        | chainと実行ログで確認          |
| 移行コスト     | なし              | コンポーネント・Context・テスト追加  |
| 侵入性       | なし              | 呼び出し入口とフロー制御を変更        |

---

## 14. 適用判断

この移行方式が適しているのは、次の条件を満たす場合である。

- フローの変更が多い

- 複数の分岐が存在する

- 顧客や商品によって処理順序が異なる

- 既存Serviceを再利用できる

- 再デプロイせずにフローを変更したい

- 実行経路やルール履歴を管理したい

一方、次のような単純な処理には適用しない。

```java
if ("A".equals(customerRank) && amount > 100000) {
    manualApprove();
} else {
    autoApprove();
}
```

この条件だけで処理が完結し、変更頻度も低い場合は、通常のJavaコードのまま維持した方がよい。

LiteFlow化するのは、単純な `if` そのものではなく、次のように複数の業務処理と分岐が組み合わされたフローである。

```text
入力検証
   ↓
顧客情報取得
   ↓
リスク判定
   ↓
人工承認または自動承認
   ↓
コンプライアンス確認
   ↓
結果保存
   ↓
通知
```

## 15. まとめ

レガシーシステム移行におけるLiteFlowの役割は、既存業務ロジックを全面的に置き換えることではない。

**既存Serviceを維持したまま、変更頻度の高い処理順序と分岐構造だけを外部化すること**が基本となる。

移行担当者は、以下を明確にしたうえで改造を行う必要がある。

1. 既存クラスのどの処理を残すか

2. どの処理をLiteFlowコンポーネントとして公開するか

3. どのchainをRule-DBへ追加するか

4. Controllerの呼び出し先をどこへ変更するか

5. Contextでどのデータを共有するか

6. トランザクション境界をどう維持するか

7. 新旧処理をどのように比較・切り替えるか

そのため、LiteFlow導入は単純なコード変換ではなく、**業務フローの分離と再編成を伴う部分的なアーキテクチャ変更**として計画する必要がある。

---

## 第6位：キャンペーン・料金・割引ルール管理

### 概要

期間、商品、顧客ランク、地域、購入数量などにより、価格や割引条件を頻繁に変更する。

### ルール例

```text
通常割引
会員割引
期間限定割引
セット割引
地域別送料
クーポン適用
上限金額判定
```

### 処理例

```text
THEN(
  validateCoupon,
  IF(isCampaignPeriod, campaignDiscount, normalDiscount),
  applyMemberDiscount,
  checkDiscountLimit
)
```

### Rule-DBが適する理由

アプリケーションを再デプロイせずに、RulePublisherを通してルールを変更できる。複数ノードでは、通知またはポーリングと周期照合によって更新が収束する。([LiteFlow](https://liteflow.cc/pages/8ff02a/ "🚀whats new in v2.16.1 | LiteFlow"))

### 検証項目

- 開始日時・終了日時の境界

- 複数割引の適用順序

- 割引上限

- ルール反映途中の旧新バージョン混在

- 公開予約

- 緊急停止

- 旧版への戻し

- 誤設定による売上影響の防止

### 推奨設計

価格計算結果には次を保存する。

```json
{
  "ruleId": "summer-campaign",
  "ruleVersion": 12,
  "basePrice": 10000,
  "discount": 1500,
  "finalPrice": 8500
}
```

これにより、後から「どのルールで価格が決定されたか」を追跡できる。

---

## 第7位：複数ノード同期・障害回復検証

### 概要

Rule-DB固有の複数ノード同期機構を直接評価するための技術検証シナリオである。

### 構成例

```text
Rule-DB
  ├─ LiteFlow Node 1
  ├─ LiteFlow Node 2
  ├─ LiteFlow Node 3
  └─ LiteFlow Node 4
```

### 障害試験パターン

1. Node 3を停止する

2. ルールをVersion 10から11へ更新する

3. Node 1、2、4の反映を確認する

4. Node 3を再起動する

5. Version 11へ自動収束するか確認する

追加試験：

- 更新通知の意図的な遮断

- DB接続切断

- 変更シーケンス欠落

- ノードのネットワーク分断

- ルールロード中の再更新

- 複数回連続公開

- 古いバージョンによる競合更新

### 観測方法

`/actuator/liteflow/ruledb` では、同期水位や以下の状態を確認できる。

- `shadow`

- `ready`

- `stale`

- `failed`

これにより、各ノードが新しいルールを認識したか、ロードに失敗したかを判断できる。([LiteFlow](https://liteflow.cc/pages/8ff02a/ "🚀whats new in v2.16.1 | LiteFlow"))

### 合格条件例

```text
通知正常時：5秒以内に全ノード収束
通知欠落時：次回全件照合後に自動収束
ノード復旧時：手動操作なしで最新バージョンへ収束
failed状態：監視システムへアラート通知
```

---

## 第8位：スクリプト型業務ロジックの動的配信

### 概要

単純な処理順序だけでなく、計算式や変換処理をGroovy等のスクリプトとして保存・変更する。

### 例

- 手数料計算

- 点数計算

- データ補正

- 商品分類

- 文字列変換

- リスクスコア算出

### Rule-DBが適する理由

スクリプトソースもRule-DBで管理し、必要時にロード・コンパイルできる。ただし、Rule-DBバックエンドとStarterだけではスクリプト実装は含まれず、Groovyを利用する場合は対応するスクリプトモジュールを追加する必要がある。([LiteFlow](https://liteflow.cc/pages/ruledb-sql/ "🐬快速开始(SQL) | LiteFlow"))

### 検証項目

- スクリプト初回コンパイル時間

- コンパイル済みキャッシュの効果

- 構文エラー発生時の状態

- 無限ループや長時間処理

- 使用可能クラスの制限

- 外部ファイル・ネットワークアクセス制限

- スクリプト更新中の実行安定性

- Javaコンポーネントとの入出力互換性

### セキュリティ対策

検証基盤には最低限、以下を追加すべきである。

- 公開前コンパイル

- 実行時間上限

- 許可APIのホワイトリスト

- 禁止パッケージ検査

- スクリプトサイズ上限

- 操作者・承認者の分離

- 実行履歴・監査ログ

---

## 第9位：監視・SRE・性能評価基盤

### 概要

Rule-DBの機能評価だけでなく、実運用時の監視方法、性能劣化、障害検知を検証する。

LiteFlow 2.16.1では、chain、node、slotの実行データをMicrometer経由でPrometheusやGrafanaへ連携できる。([LiteFlow](https://liteflow.cc/pages/8ff02a/ "🚀whats new in v2.16.1 | LiteFlow"))

### 推奨ダッシュボード

#### 実行メトリクス

- chain実行回数

- node実行回数

- 成功数・失敗数

- 平均処理時間

- 最大処理時間

- 実行中件数

- 例外種別

#### Rule-DBメトリクス

- 同期水位

- shadow数

- ready数

- stale数

- failed数

- 初回ロード時間

- キャッシュヒット率

- DBアクセス数

- 公開から反映までの時間

### 推奨アラート

```text
failed > 0
stale状態が60秒以上継続
ルール反映時間 > 10秒
初回ロードP95 > 500ms
chainエラー率 > 1%
DB接続エラーが連続発生
JVMヒープ使用率 > 80%
```

### 検証上のポイント

P95、P99を取得する場合、標準のcount、sum、maxだけでは計算できないため、Micrometer側でヒストグラムまたは分位数設定を有効化する必要がある。([LiteFlow](https://liteflow.cc/pages/8ff02a/?utm_source=chatgpt.com "whats new in v2.16.1 | LiteFlow"))

---

## 第10位：複数バックエンド比較・選定基盤

### 概要

同じ業務ルールと負荷条件で、Rule-DBの各バックエンドを比較する。

Rule-DB 2.16.1では、以下のバックエンドが提供されている。([LiteFlow](https://liteflow.cc/pages/8ff02a/ "🚀whats new in v2.16.1 | LiteFlow"))

| バックエンド        | 変更検知        | 主な用途              |
| ------------- | ----------- | ----------------- |
| MySQL／MariaDB | seqポーリング＋照合 | 一般的な業務システム        |
| PostgreSQL    | seqポーリング＋照合 | PostgreSQL標準環境    |
| MongoDB       | seqポーリング＋照合 | ドキュメントDB中心環境      |
| Redis         | seqポーリング＋照合 | 低遅延重視             |
| ZooKeeper     | watch＋照合    | 既存ZK運用環境          |
| etcd          | watch＋照合    | Kubernetes／クラウド基盤 |
| Nacos         | Listener＋照合 | Nacos中心のJava基盤    |

### 比較項目

- 公開処理時間

- ノード反映時間

- 初回ロード時間

- キャッシュヒット時性能

- 障害復旧時間

- 運用難易度

- データバックアップ

- セキュリティ

- クラスタ構成

- 総運用コスト

### 制約

- 同一実行環境ではRule-DBバックエンドを1種類だけ選択する。

- `liteflow.rule-source` とRule-DBは併用できない。

- MongoDBはReplica SetまたはSharded Clusterが必要で、Standalone構成には対応しない。

- Redis Clusterでは、関連キーを同一slotに配置するためのkey-hash-tag設計が必要である。

- 2.16.1時点ではApollo用Rule-DBバックエンドと標準管理画面は提供されていない。([LiteFlow](https://liteflow.cc/pages/8ff02a/ "🚀whats new in v2.16.1 | LiteFlow"))

---

# 4. 検証基盤として最初に実装すべき3シナリオ

最初のPoCでは、10シナリオを同時に実装せず、以下の3本に絞るのが最も効果的である。

## PoC-1：注文処理フロー

目的：

- 基本的なchain実行

- ルール動的更新

- 複数ノード反映

- バージョン記録

## PoC-2：10,000件ルール性能試験

目的：

- 起動時間

- JVMメモリ

- 初回ロード

- キャッシュ効果

- 大量ルール時の安定性

## PoC-3：ルール管理・公開画面

目的：

- RulePublisher

- 楽観ロック

- 公開前テスト

- 履歴

- ロールバック

- ノード反映状況

この3本だけで、Rule-DBの主要価値である「動的ルール管理」「大量ルール対応」「複数ノード収束」「運用管理」をほぼ網羅できる。

---

# 5. 推奨する検証基盤構成

```text
┌─────────────────────────────┐
│ Rule Management Web UI      │
│ ・編集 ・比較 ・承認 ・公開 │
└──────────────┬──────────────┘
               │ REST API
┌──────────────▼──────────────┐
│ Rule Management Service     │
│ ・構文検査                  │
│ ・参照整合性検査            │
│ ・テスト実行                │
│ ・RulePublisher             │
│ ・履歴／ロールバック        │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│ Rule-DB                     │
│ MySQL / PostgreSQL等        │
└───────┬───────────┬─────────┘
        │           │
┌───────▼──────┐ ┌──▼───────────┐
│ Executor 1   │ │ Executor 2   │
│ LiteFlow     │ │ LiteFlow     │
└───────┬──────┘ └──┬───────────┘
        │            │
        └──────┬─────┘
               │
┌──────────────▼──────────────┐
│ Prometheus / Grafana        │
│ Actuator / Rule-DB状態監視  │
└─────────────────────────────┘
```

---

# 6. 総合評価

LiteFlow Rule-DBが最も効果を発揮するのは、次の条件を持つシステムである。

1. ルールをアプリケーション再デプロイなしで変更したい

2. 実行ノードが複数存在する

3. ルール数が多く、全件メモリ常駐を避けたい

4. ルール公開をAPI・履歴・バージョンで統制したい

5. ルール反映状態を運用側から確認したい

一方、以下の要件にはそのままでは適さない。

- 全ノードを完全に同時刻に切り替える必要がある

- 複数ルールを一括して原子的に切り替える必要がある

- 公開時点で完全なコンパイル保証が必要

- ApolloをRule-DBとして利用したい

- 標準管理画面だけで運用を完結したい

したがって、検証基盤の中心テーマは、「**Rule-DBが動くか」ではなく、「ルール変更を安全に検査・承認・公開・追跡・回復できるか**」に置くべきである。
