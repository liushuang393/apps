/// TriPrize Mobile Widget Tests
///
/// Widgetテストファイル
/// 目的: 主要なWidgetの動作をテスト
/// 注意点: 基本的なWidgetのレンダリングとインタラクションをテスト
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:triprize_mobile/core/constants/app_theme.dart';

void main() {
  group('AppTheme Tests', () {
    test('lightTheme should have correct primary color', () {
      final theme = AppTheme.lightTheme;
      expect(theme.primaryColor, AppTheme.primaryColor);
      expect(theme.brightness, Brightness.light);
    });

    test('darkTheme should have correct brightness', () {
      final theme = AppTheme.darkTheme;
      expect(theme.brightness, Brightness.dark);
      expect(theme.scaffoldBackgroundColor, const Color(0xFF111827));
    });

    test('text styles should have correct properties', () {
      expect(AppTheme.heading1.fontSize, 32);
      expect(AppTheme.heading1.fontWeight, FontWeight.bold);
      expect(AppTheme.heading2.fontSize, 24);
      expect(AppTheme.heading3.fontSize, 20);
      expect(AppTheme.body1.fontSize, 16);
      expect(AppTheme.body2.fontSize, 14);
      expect(AppTheme.caption.fontSize, 12);
    });
  });

  group('Basic Widget Tests', () {
    testWidgets('Text widget displays correctly', (WidgetTester tester) async {
      const testText = 'Test Text';
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: Text(testText),
          ),
        ),
      );

      expect(find.text(testText), findsOneWidget);
    });

    testWidgets('Button widget can be tapped', (WidgetTester tester) async {
      bool wasTapped = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ElevatedButton(
              onPressed: () {
                wasTapped = true;
              },
              child: const Text('Tap Me'),
            ),
          ),
        ),
      );

      expect(wasTapped, isFalse);
      await tester.tap(find.text('Tap Me'));
      await tester.pump();
      expect(wasTapped, isTrue);
    });

    testWidgets('Card widget renders correctly', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(
            body: Card(
              child: ListTile(
                title: Text('Card Title'),
                subtitle: Text('Card Subtitle'),
              ),
            ),
          ),
        ),
      );

      expect(find.text('Card Title'), findsOneWidget);
      expect(find.text('Card Subtitle'), findsOneWidget);
    });
  });
}
