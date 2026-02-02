# Features (機能モジュール)

このフォルダには、機能別に分離されたモジュールが格納されています。
Clean Architecture パターンに基づいて構成されています。

## ディレクトリ構成

各機能モジュールは以下の構造を持ちます：

```
feature_name/
├── data/               # データ層
│   ├── datasources/    # API呼び出し、ローカルストレージ
│   ├── models/         # DTOモデル
│   └── repositories/   # リポジトリ実装
├── domain/             # ドメイン層
│   ├── entities/       # ビジネスエンティティ
│   ├── repositories/   # リポジトリインターフェース
│   └── usecases/       # ユースケース
└── presentation/       # UI層
    ├── pages/          # 画面
    ├── providers/      # 状態管理（Provider/BLoC）
    └── widgets/        # UIコンポーネント
```

## 業務モジュール（TriPrize固有）

以下のモジュールは TriPrize 固有の業務ロジックです。
新規アプリを作成する際は、これらを削除または置換してください：

### 削除対象モジュール

| モジュール | 説明 | 新規アプリ作成時 |
|-----------|------|----------------|
| `campaign/` | キャンペーン管理 | 🗑️ 削除 |
| `lottery/` | 抽選機能 | 🗑️ 削除 |
| `purchase/` | 購入機能 | 🗑️ 削除 |
| `payment/` | 決済機能 | ✏️ 必要に応じて修正して再利用 |

### 再利用可能モジュール

| モジュール | 説明 | 新規アプリ作成時 |
|-----------|------|----------------|
| `auth/` | 認証機能（Firebase） | ✅ そのまま使用可能 |
| `admin/` | 管理者機能 | ✏️ 必要に応じて修正して再利用 |

## 共通コンポーネント（core/）

`lib/core/` 以下の共通コンポーネントは削除しないでください：

- `constants/` - アプリ設定、テーマ
- `di/` - 依存性注入
- `network/` - API クライアント
- `services/` - 共通サービス
- `storage/` - ローカルストレージ
- `utils/` - ユーティリティ
- `widgets/` - 共通UIコンポーネント

## 新規機能モジュール作成手順

1. `lib/features/` に新しいフォルダを作成
2. Clean Architecture に基づいてサブフォルダを作成
3. エンティティ、リポジトリ、ユースケースを実装
4. `lib/core/di/injection.dart` に依存性を登録
5. `lib/main.dart` にProviderを追加（必要に応じて）

## 新規アプリ作成手順

1. TriPrize 業務モジュールを削除:
   ```bash
   rm -rf lib/features/campaign
   rm -rf lib/features/lottery
   rm -rf lib/features/purchase
   ```

2. `lib/core/di/injection.dart` から削除したモジュールの登録を削除

3. `lib/main.dart` から削除したProviderを削除

4. 新しい業務モジュールを作成

5. 環境変数（.env）を更新

