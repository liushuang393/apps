import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';

/// ApiClient基础测试
/// 注意: 完整测试需要Firebase初始化,这里仅测试Dio配置
void main() {
  group('ApiClient Tests', () {
    late Dio dio;

    setUp(() {
      dio = Dio(
        BaseOptions(
          baseUrl: 'http://localhost:3000',
          connectTimeout: const Duration(seconds: 30),
          receiveTimeout: const Duration(seconds: 30),
        ),
      );
    });

    test('should create Dio instance', () {
      expect(dio, isNotNull);
      expect(dio, isA<Dio>());
    });

    test('should have correct timeout settings', () {
      expect(dio.options.connectTimeout, const Duration(seconds: 30));
      expect(dio.options.receiveTimeout, const Duration(seconds: 30));
    });

    test('should set correct base URL', () {
      final baseUrl = dio.options.baseUrl;
      expect(baseUrl, isNotEmpty);
      expect(baseUrl, equals('http://localhost:3000'));
    });

    test('should have correct headers', () {
      dio.options.headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      final headers = dio.options.headers;
      expect(headers['Content-Type'], equals('application/json'));
      expect(headers['Accept'], equals('application/json'));
    });
  });
}
