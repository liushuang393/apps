import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:triprize_mobile/features/admin/presentation/pages/terms_of_service_page.dart';

/// TermsOfServicePageのウィジェットテスト
/// 目的: 利用規約画面の表示をテスト
void main() {
  group('TermsOfServicePage Widget Tests', () {
    testWidgets('displays terms of service content', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: TermsOfServicePage(),
        ),
      );

      // タイトルが表示されることを確認
      expect(find.text('利用規約'), findsOneWidget);
      
      // セクションが表示されることを確認
      expect(find.text('第1条（適用）'), findsOneWidget);
      expect(find.text('第2条（利用登録）'), findsOneWidget);
      expect(find.text('第3条（利用料金）'), findsOneWidget);
      expect(find.text('第4条（禁止事項）'), findsOneWidget);
      expect(find.text('第10条（準拠法・裁判管轄）'), findsOneWidget);
    });

    testWidgets('displays update date', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: TermsOfServicePage(),
        ),
      );

      expect(find.text('最終更新日: 2025年1月1日'), findsOneWidget);
    });

    testWidgets('is scrollable', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: TermsOfServicePage(),
        ),
      );

      // SingleChildScrollViewが存在することを確認
      expect(find.byType(SingleChildScrollView), findsOneWidget);
    });
  });
}
