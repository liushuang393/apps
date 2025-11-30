import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:triprize_mobile/features/admin/presentation/pages/privacy_policy_page.dart';

/// PrivacyPolicyPageのウィジェットテスト
/// 目的: プライバシーポリシー画面の表示をテスト
void main() {
  group('PrivacyPolicyPage Widget Tests', () {
    testWidgets('displays privacy policy content', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: PrivacyPolicyPage(),
        ),
      );

      // タイトルが表示されることを確認
      expect(find.text('プライバシーポリシー'), findsOneWidget);
      
      // セクションが表示されることを確認
      expect(find.text('1. 個人情報の取得'), findsOneWidget);
      expect(find.text('2. 個人情報の利用目的'), findsOneWidget);
      expect(find.text('3. 個人情報の第三者提供'), findsOneWidget);
      expect(find.text('8. お問い合わせ窓口'), findsOneWidget);
    });

    testWidgets('displays update date', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: PrivacyPolicyPage(),
        ),
      );

      expect(find.text('最終更新日: 2025年1月1日'), findsOneWidget);
    });

    testWidgets('is scrollable', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: PrivacyPolicyPage(),
        ),
      );

      // SingleChildScrollViewが存在することを確認
      expect(find.byType(SingleChildScrollView), findsOneWidget);
    });
  });
}
