import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Application Configuration
///
/// 目的: アプリケーション全体の設定を一元管理
/// 注意点: 新規アプリを作成する際はここの値とenv変数を変更してください
///
/// このファイルを編集することで、フレームワークを新しいアプリに適用できます。
class AppConfig {
  // Private constructor to prevent instantiation
  AppConfig._();

  // ===========================
  // アプリケーション識別情報
  // ===========================

  /// アプリケーション名（英語）
  static String get appName => dotenv.env['APP_NAME'] ?? 'TriPrize';

  /// アプリケーション名（表示用）
  static String get displayName => dotenv.env['APP_DISPLAY_NAME'] ?? 'TriPrize';

  /// アプリケーションの説明
  static String get description =>
      dotenv.env['APP_DESCRIPTION'] ?? '三角形抽選販売プラットフォーム';

  /// アプリケーションバージョン
  static String get version => dotenv.env['APP_VERSION'] ?? '1.0.0';

  // ===========================
  // API設定
  // ===========================

  /// APIベースURL
  static String get apiBaseUrl =>
      dotenv.env['API_BASE_URL'] ?? 'http://localhost:3000';

  /// API タイムアウト (秒)
  static int get apiTimeout =>
      int.tryParse(dotenv.env['API_TIMEOUT'] ?? '') ?? 30;

  // ===========================
  // 決済設定
  // ===========================

  /// Stripe公開キー
  static String get stripePublishableKey =>
      dotenv.env['STRIPE_PUBLISHABLE_KEY'] ?? '';

  /// 決済モック使用フラグ
  static bool get useMockPayment => dotenv.env['USE_MOCK_PAYMENT'] == 'true';

  // ===========================
  // 認証設定
  // ===========================

  /// Mock認証使用フラグ
  static bool get useMockAuth => dotenv.env['USE_MOCK_AUTH'] == 'true';

  // ===========================
  // 機能フラグ
  // ===========================

  /// デバッグログ有効化
  static bool get enableDebugLogging =>
      dotenv.env['ENABLE_DEBUG_LOGGING'] == 'true';

  /// プッシュ通知有効化
  static bool get enablePushNotifications =>
      dotenv.env['ENABLE_PUSH_NOTIFICATIONS'] != 'false';

  // ===========================
  // ロケール設定
  // ===========================

  /// デフォルトロケール
  static String get defaultLocale => dotenv.env['DEFAULT_LOCALE'] ?? 'ja_JP';

  /// サポートされるロケール
  static List<String> get supportedLocales =>
      (dotenv.env['SUPPORTED_LOCALES'] ?? 'ja_JP,en_US').split(',');
}

