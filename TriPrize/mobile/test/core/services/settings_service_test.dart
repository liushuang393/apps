import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:triprize_mobile/core/services/settings_service.dart';

/// SettingsServiceのユニットテスト
/// 目的: 設定サービスの保存・取得機能をテスト
/// 注意点: SharedPreferencesのモックを使用
void main() {
  late SettingsService settingsService;

  setUp(() {
    settingsService = SettingsService();
  });

  group('SettingsService Tests', () {
    test('getPushNotificationEnabled returns default true when not set', () async {
      // テスト用にSharedPreferencesをクリア
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      await prefs.clear();

      final result = await settingsService.getPushNotificationEnabled();
      expect(result, isTrue);
    });

    test('setPushNotificationEnabled saves and retrieves value correctly', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      await prefs.clear();

      // falseに設定
      final saveResult = await settingsService.setPushNotificationEnabled(false);
      expect(saveResult, isTrue);

      // 値を取得して確認
      final getResult = await settingsService.getPushNotificationEnabled();
      expect(getResult, isFalse);

      // trueに変更
      await settingsService.setPushNotificationEnabled(true);
      final getResult2 = await settingsService.getPushNotificationEnabled();
      expect(getResult2, isTrue);
    });

    test('getEmailNotificationEnabled returns default true when not set', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      await prefs.clear();

      final result = await settingsService.getEmailNotificationEnabled();
      expect(result, isTrue);
    });

    test('setEmailNotificationEnabled saves and retrieves value correctly', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      await prefs.clear();

      // falseに設定
      final saveResult = await settingsService.setEmailNotificationEnabled(false);
      expect(saveResult, isTrue);

      // 値を取得して確認
      final getResult = await settingsService.getEmailNotificationEnabled();
      expect(getResult, isFalse);

      // trueに変更
      await settingsService.setEmailNotificationEnabled(true);
      final getResult2 = await settingsService.getEmailNotificationEnabled();
      expect(getResult2, isTrue);
    });

    test('push and email notification settings are independent', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      await prefs.clear();

      // プッシュ通知をfalse、メール通知をtrueに設定
      await settingsService.setPushNotificationEnabled(false);
      await settingsService.setEmailNotificationEnabled(true);

      // それぞれ独立して保存されていることを確認
      expect(await settingsService.getPushNotificationEnabled(), isFalse);
      expect(await settingsService.getEmailNotificationEnabled(), isTrue);

      // 逆に設定
      await settingsService.setPushNotificationEnabled(true);
      await settingsService.setEmailNotificationEnabled(false);

      expect(await settingsService.getPushNotificationEnabled(), isTrue);
      expect(await settingsService.getEmailNotificationEnabled(), isFalse);
    });
  });
}
