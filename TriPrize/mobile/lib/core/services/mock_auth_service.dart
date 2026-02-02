import 'package:flutter_dotenv/flutter_dotenv.dart';
import '../utils/logger.dart';

/// Mock authentication service for testing
/// 目的: 在测试模式下提供模拟认证功能
/// I/O: 生成mock token，不依赖Firebase
/// 注意点: 仅在USE_MOCK_AUTH=true时使用
class MockAuthService {
  /// Mock認証が有効かどうかを環境変数から取得
  /// 目的: 本番環境とテスト環境を切り替え
  /// 注意点: .envファイルのUSE_MOCK_AUTHを参照、デフォルトはfalse
  static bool get isEnabled {
    try {
      final envValue = dotenv.env['USE_MOCK_AUTH'];
      final enabled = envValue?.toLowerCase() == 'true';
      AppLogger.info('MockAuthService.isEnabled: $enabled (env: $envValue)');
      return enabled;
    } catch (e) {
      AppLogger.warning('Failed to read USE_MOCK_AUTH from .env, defaulting to false');
      return false; // デフォルトは本番モード（Mock認証オフ）
    }
  }

  /// Generate a mock Firebase token for testing
  /// 目的: 生成模拟的Firebase token
  static String generateMockToken(String email) {
    // Format: mock_email@example.com
    return 'mock_$email';
  }

  /// Mock user registration
  /// 目的: 模拟用户注册，返回mock token
  static Future<MockAuthResult> mockRegister({
    required String email,
    required String password,
    required String displayName,
  }) async {
    AppLogger.info('Mock registration: $email');
    
    // Simulate network delay
    await Future.delayed(const Duration(milliseconds: 500));
    
    // Generate mock UID from email
    final uid = 'mock_${email.replaceAll(RegExp(r'[^a-zA-Z0-9]'), '_')}';
    final token = generateMockToken(email);
    
    return MockAuthResult(
      uid: uid,
      email: email,
      displayName: displayName,
      token: token,
    );
  }

  /// Mock user login
  /// 目的: 模拟用户登录，返回mock token
  static Future<MockAuthResult> mockLogin({
    required String email,
    required String password,
  }) async {
    AppLogger.info('Mock login: $email');
    
    // Simulate network delay
    await Future.delayed(const Duration(milliseconds: 500));
    
    // Generate mock UID from email
    final uid = 'mock_${email.replaceAll(RegExp(r'[^a-zA-Z0-9]'), '_')}';
    final token = generateMockToken(email);
    
    return MockAuthResult(
      uid: uid,
      email: email,
      displayName: email.split('@')[0],
      token: token,
    );
  }

  /// Mock anonymous login
  /// 目的: 模拟匿名登录
  static Future<MockAuthResult> mockAnonymousLogin() async {
    AppLogger.info('Mock anonymous login');
    
    // Simulate network delay
    await Future.delayed(const Duration(milliseconds: 300));
    
    final uid = 'mock_anonymous_${DateTime.now().millisecondsSinceEpoch}';
    const token = 'mock_anonymous@triprize.test';
    
    return MockAuthResult(
      uid: uid,
      email: 'anonymous@triprize.test',
      displayName: 'Anonymous User',
      token: token,
    );
  }
}

/// Mock authentication result
/// 目的: 存储模拟认证的结果
class MockAuthResult {
  final String uid;
  final String email;
  final String displayName;
  final String token;

  MockAuthResult({
    required this.uid,
    required this.email,
    required this.displayName,
    required this.token,
  });
}

