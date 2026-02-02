import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/mockito.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:triprize_mobile/features/admin/presentation/pages/settings_page.dart';
import 'package:triprize_mobile/features/auth/presentation/providers/auth_provider.dart';

/// SettingsPageのウィジェットテスト
/// 目的: 設定画面のUIとインタラクションをテスト
/// 注意点: AuthProviderのモックを使用
class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockAuthProvider mockAuthProvider;

  setUp(() {
    mockAuthProvider = MockAuthProvider();
    // SharedPreferencesをモック初期化
    SharedPreferences.setMockInitialValues({});
  });

  Widget createTestWidget(Widget child) {
    return MaterialApp(
      home: MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: mockAuthProvider),
        ],
        child: child,
      ),
    );
  }

  group('SettingsPage Widget Tests', () {
    testWidgets('displays loading indicator initially', (WidgetTester tester) async {
      await tester.pumpWidget(createTestWidget(const SettingsPage()));
      
      // ローディングインジケーターが表示されることを確認
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('displays settings sections after loading', (WidgetTester tester) async {
      await tester.pumpWidget(createTestWidget(const SettingsPage()));
      await tester.pumpAndSettle();

      // セクションタイトルが表示されることを確認
      expect(find.text('通知設定'), findsOneWidget);
      expect(find.text('アプリ情報'), findsOneWidget);
      expect(find.text('その他'), findsOneWidget);

      // 設定項目が表示されることを確認
      expect(find.text('プッシュ通知'), findsOneWidget);
      expect(find.text('メール通知'), findsOneWidget);
      expect(find.text('利用規約'), findsOneWidget);
      expect(find.text('プライバシーポリシー'), findsOneWidget);
      expect(find.text('ログアウト'), findsOneWidget);
    });

    testWidgets('toggles push notification setting', (WidgetTester tester) async {
      await tester.pumpWidget(createTestWidget(const SettingsPage()));
      await tester.pumpAndSettle();

      // Switchをタップ
      final switchFinder = find.byType(Switch).first;
      expect(switchFinder, findsOneWidget);
      
      await tester.tap(switchFinder);
      await tester.pumpAndSettle();

      // 設定が保存されていることを確認（SharedPreferencesに保存される）
      final prefs = await SharedPreferences.getInstance();
      final savedValue = prefs.getBool('push_notification_enabled');
      expect(savedValue, isFalse);
    });

    testWidgets('shows logout dialog when logout is tapped', (WidgetTester tester) async {
      when(mockAuthProvider.logout()).thenAnswer((_) async => {});

      await tester.pumpWidget(createTestWidget(const SettingsPage()));
      await tester.pumpAndSettle();

      // ログアウトをタップ
      await tester.tap(find.text('ログアウト'));
      await tester.pumpAndSettle();

      // ダイアログが表示されることを確認
      expect(find.text('ログアウト'), findsNWidgets(2)); // リストアイテムとダイアログタイトル
      expect(find.text('ログアウトしますか？'), findsOneWidget);
      expect(find.text('キャンセル'), findsOneWidget);
    });

    testWidgets('navigates to terms of service page', (WidgetTester tester) async {
      await tester.pumpWidget(createTestWidget(const SettingsPage()));
      await tester.pumpAndSettle();

      // 利用規約をタップ
      await tester.tap(find.text('利用規約'));
      await tester.pumpAndSettle();

      // 利用規約画面に遷移することを確認
      expect(find.text('利用規約'), findsOneWidget); // 画面タイトル
    });

    testWidgets('navigates to privacy policy page', (WidgetTester tester) async {
      await tester.pumpWidget(createTestWidget(const SettingsPage()));
      await tester.pumpAndSettle();

      // プライバシーポリシーをタップ
      await tester.tap(find.text('プライバシーポリシー'));
      await tester.pumpAndSettle();

      // プライバシーポリシー画面に遷移することを確認
      expect(find.text('プライバシーポリシー'), findsOneWidget); // 画面タイトル
    });
  });
}
