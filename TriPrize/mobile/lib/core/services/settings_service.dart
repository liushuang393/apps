import 'package:shared_preferences/shared_preferences.dart';
import '../utils/logger.dart';

/// 設定サービス
/// 目的: アプリ設定をローカルストレージに保存・取得
/// I/O: SharedPreferencesを使用して設定を永続化
/// 注意点: 設定はデバイスローカルに保存される
class SettingsService {
  static const String _keyPushNotification = 'push_notification_enabled';
  static const String _keyEmailNotification = 'email_notification_enabled';

  /// プッシュ通知設定を取得
  /// 目的: プッシュ通知の有効/無効状態を取得
  /// 戻り値: 有効な場合はtrue、デフォルトはtrue
  Future<bool> getPushNotificationEnabled() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getBool(_keyPushNotification) ?? true;
    } catch (e) {
      AppLogger.error('Failed to get push notification setting', e);
      return true; // デフォルト値
    }
  }

  /// プッシュ通知設定を保存
  /// 目的: プッシュ通知の有効/無効状態を保存
  /// I/O: enabledを受け取り、SharedPreferencesに保存
  Future<bool> setPushNotificationEnabled(bool enabled) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return await prefs.setBool(_keyPushNotification, enabled);
    } catch (e) {
      AppLogger.error('Failed to save push notification setting', e);
      return false;
    }
  }

  /// メール通知設定を取得
  /// 目的: メール通知の有効/無効状態を取得
  /// 戻り値: 有効な場合はtrue、デフォルトはtrue
  Future<bool> getEmailNotificationEnabled() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getBool(_keyEmailNotification) ?? true;
    } catch (e) {
      AppLogger.error('Failed to get email notification setting', e);
      return true; // デフォルト値
    }
  }

  /// メール通知設定を保存
  /// 目的: メール通知の有効/無効状態を保存
  /// I/O: enabledを受け取り、SharedPreferencesに保存
  Future<bool> setEmailNotificationEnabled(bool enabled) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return await prefs.setBool(_keyEmailNotification, enabled);
    } catch (e) {
      AppLogger.error('Failed to save email notification setting', e);
      return false;
    }
  }
}
