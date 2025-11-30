# 設定機能ドキュメント

## 概要

設定機能は、ユーザーがアプリの通知設定やその他の設定を管理できる機能です。設定はデバイスのローカルストレージ（SharedPreferences）に保存されます。

## 機能一覧

### 1. 通知設定

#### プッシュ通知
- **説明**: 重要なイベントのプッシュ通知を受け取るかどうかを設定
- **デフォルト値**: 有効（true）
- **保存場所**: SharedPreferences (`push_notification_enabled`)

#### メール通知
- **説明**: メールでの通知を受け取るかどうかを設定
- **デフォルト値**: 有効（true）
- **保存場所**: SharedPreferences (`email_notification_enabled`)

### 2. アプリ情報

#### バージョン情報
- アプリのバージョン番号を表示（現在: 1.0.0）

#### 利用規約
- アプリの利用規約を表示する画面へのリンク

#### プライバシーポリシー
- プライバシーポリシーを表示する画面へのリンク

### 3. その他

#### ログアウト
- ユーザーをログアウトし、認証状態をクリア

## 実装詳細

### SettingsService (`mobile/lib/core/services/settings_service.dart`)

設定の保存・取得を担当するサービスクラス。

#### メソッド

- `getPushNotificationEnabled()`: プッシュ通知設定を取得
- `setPushNotificationEnabled(bool enabled)`: プッシュ通知設定を保存
- `getEmailNotificationEnabled()`: メール通知設定を取得
- `setEmailNotificationEnabled(bool enabled)`: メール通知設定を保存

### SettingsPage (`mobile/lib/features/admin/presentation/pages/settings_page.dart`)

設定画面のUIコンポーネント。

#### 状態管理

- `_pushNotificationEnabled`: プッシュ通知の有効/無効状態
- `_emailNotificationEnabled`: メール通知の有効/無効状態
- `_isLoading`: 設定読み込み中の状態

#### 主要メソッド

- `_loadSettings()`: 保存された設定を読み込む
- `_updatePushNotification(bool enabled)`: プッシュ通知設定を更新
- `_updateEmailNotification(bool enabled)`: メール通知設定を更新
- `_showLogoutDialog(BuildContext context)`: ログアウト確認ダイアログを表示

### TermsOfServicePage (`mobile/lib/features/admin/presentation/pages/terms_of_service_page.dart`)

利用規約を表示する画面。

### PrivacyPolicyPage (`mobile/lib/features/admin/presentation/pages/privacy_policy_page.dart`)

プライバシーポリシーを表示する画面。

## テスト

### ユニットテスト

- `mobile/test/core/services/settings_service_test.dart`: SettingsServiceのテスト
- `mobile/test/features/admin/presentation/pages/settings_page_test.dart`: SettingsPageのウィジェットテスト
- `mobile/test/features/admin/presentation/pages/terms_of_service_page_test.dart`: TermsOfServicePageのテスト
- `mobile/test/features/admin/presentation/pages/privacy_policy_page_test.dart`: PrivacyPolicyPageのテスト

### テスト実行方法

```bash
cd mobile
flutter test test/core/services/settings_service_test.dart
flutter test test/features/admin/presentation/pages/
```

## 使用方法

### 設定画面へのアクセス

1. 管理者ダッシュボードのAppBarにある設定アイコンをタップ
2. 設定画面が表示される

### 通知設定の変更

1. 設定画面で「通知設定」セクションを確認
2. プッシュ通知またはメール通知のスイッチをタップ
3. 設定が自動的に保存される

### 利用規約・プライバシーポリシーの閲覧

1. 設定画面で「アプリ情報」セクションを確認
2. 「利用規約」または「プライバシーポリシー」をタップ
3. それぞれの画面が表示される

### ログアウト

1. 設定画面で「その他」セクションを確認
2. 「ログアウト」をタップ
3. 確認ダイアログで「ログアウト」を選択
4. ログアウトが実行され、認証状態がクリアされる

## 注意事項

1. **設定の永続化**: 設定はデバイスのローカルストレージに保存されるため、アプリを再インストールすると設定はリセットされます。

2. **デフォルト値**: 設定が保存されていない場合、デフォルト値（true）が使用されます。

3. **エラーハンドリング**: 設定の読み込みや保存に失敗した場合、エラーメッセージが表示されますが、アプリの動作には影響しません。

4. **利用規約・プライバシーポリシー**: 現在の内容はテンプレートです。実際のサービス提供前に、法律専門家に確認の上、適切な内容に更新してください。

## 今後の拡張予定

- [ ] 設定のクラウド同期機能
- [ ] より詳細な通知設定（カテゴリ別の通知設定など）
- [ ] テーマ設定（ダークモード/ライトモードの切り替え）
- [ ] 言語設定
