# Business Modules (業務モジュール)

このフォルダには、アプリケーション固有のビジネスロジックが格納されます。

## 目的

フレームワークのコア機能と業務固有のコードを分離することで：
- 新規アプリ作成時に業務モジュールを削除/置換しやすくする
- 共通機能の再利用性を高める

## 現在のモジュール構成

### TriPrize 業務モジュール

以下のファイルは TriPrize 固有の業務ロジックです。新規アプリを作成する際は、これらを削除または置換してください：

#### Models（データモデル）
- `src/models/campaign.entity.ts` - キャンペーンエンティティ
- `src/models/lottery.entity.ts` - 抽選エンティティ
- `src/models/purchase.entity.ts` - 購入エンティティ
- `src/models/payment.entity.ts` - 決済エンティティ

#### Controllers（コントローラー）
- `src/controllers/campaign.controller.ts` - キャンペーン管理
- `src/controllers/lottery.controller.ts` - 抽選処理
- `src/controllers/purchase.controller.ts` - 購入処理
- `src/controllers/payment.controller.ts` - 決済処理

#### Services（サービス）
- `src/services/campaign.service.ts` - キャンペーンビジネスロジック
- `src/services/lottery.service.ts` - 抽選ビジネスロジック
- `src/services/purchase.service.ts` - 購入ビジネスロジック
- `src/services/payment.service.ts` - 決済ビジネスロジック
- `src/services/mock-payment.service.ts` - モック決済サービス

#### Routes（ルーティング）
- `src/routes/campaign.routes.ts` - キャンペーンAPI
- `src/routes/lottery.routes.ts` - 抽選API
- `src/routes/purchase.routes.ts` - 購入API
- `src/routes/payment.routes.ts` - 決済API

#### Migrations（マイグレーション）
- `migrations/*.sql` - データベーススキーマ

## 共通モジュール（削除しないでください）

以下は共通機能で、新規アプリでも再利用可能です：

#### Models
- `src/models/user.entity.ts` - ユーザーエンティティ

#### Controllers
- `src/controllers/user.controller.ts` - ユーザー管理

#### Services
- `src/services/user.service.ts` - ユーザービジネスロジック
- `src/services/notification.service.ts` - 通知サービス
- `src/services/idempotency.service.ts` - 冪等性サービス

#### Routes
- `src/routes/auth.routes.ts` - 認証API
- `src/routes/user.routes.ts` - ユーザーAPI

#### Config
- `src/config/` - 全ての設定ファイル

#### Middleware
- `src/middleware/` - 全てのミドルウェア

#### Utils
- `src/utils/` - 全てのユーティリティ

## 新規アプリ作成手順

1. TriPrize 業務モジュールを削除
2. 新しいモデル、コントローラー、サービス、ルートを作成
3. `src/app.ts` のルート定義を更新
4. `migrations/` に新しいマイグレーションファイルを追加
5. 環境変数を更新

