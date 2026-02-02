import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// Application logger utility
/// 目的: アプリケーション全体のログ出力を管理
/// 注意点: エラーログは本番環境でも出力される
class AppLogger {
  // Private constructor to prevent instantiation
  AppLogger._();

  static const String _prefix = '[TriPrize]';

  /// Log debug message
  static void debug(String message, [dynamic error, StackTrace? stackTrace]) {
    if (kDebugMode) {
      debugPrint('$_prefix [DEBUG] $message');
      if (error != null) {
        debugPrint('Error: $error');
      }
      if (stackTrace != null) {
        debugPrint('Stack trace: $stackTrace');
      }
    }
  }

  /// Log info message
  static void info(String message) {
    if (kDebugMode) {
      debugPrint('$_prefix [INFO] $message');
    }
  }

  /// Log warning message
  static void warning(String message, [dynamic error]) {
    if (kDebugMode) {
      debugPrint('$_prefix [WARN] $message');
      if (error != null) {
        debugPrint('Error: $error');
      }
    }
  }

  /// Log error message
  /// 目的: エラーメッセージをログ出力
  /// I/O: メッセージ、エラーオブジェクト、スタックトレースを受け取り、詳細情報を出力
  /// 注意点: FirebaseAuthExceptionなどのエラーオブジェクトの詳細情報（code、message）を出力
  static void error(String message, [dynamic error, StackTrace? stackTrace]) {
    debugPrint('$_prefix [ERROR] $message');
    
    if (error != null) {
      // FirebaseAuthExceptionの詳細情報を出力
      if (error is FirebaseAuthException) {
        debugPrint('Error type: FirebaseAuthException');
        debugPrint('Error code: ${error.code}');
        debugPrint('Error message: ${error.message ?? "No message"}');
        debugPrint('Plugin: ${error.plugin}');
              if (error.stackTrace != null) {
          debugPrint('Stack trace: ${error.stackTrace}');
        }
      } else if (error is Exception) {
        final errorStr = error.toString();
        debugPrint('Error type: ${error.runtimeType}');
        debugPrint('Error: $errorStr');
      } else {
        debugPrint('Error: $error');
      }
      
      // エラーオブジェクトの詳細情報を出力
      try {
        if (error is Map) {
          error.forEach((key, value) {
            debugPrint('  $key: $value');
          });
        }
      } catch (_) {
        // Mapでない場合は無視
      }
    }
    
    // スタックトレースを出力
    if (stackTrace != null) {
      debugPrint('Stack trace: $stackTrace');
    }

    // 本番環境ではFirebase Crashlyticsに送信することを推奨
    // 実装例:
    // if (kReleaseMode) {
    //   FirebaseCrashlytics.instance.recordError(error, stackTrace);
    // }
  }

  /// Log network request
  static void logRequest(String method, String url, [dynamic data]) {
    if (kDebugMode) {
      debugPrint('$_prefix [HTTP] $method $url');
      if (data != null) {
        debugPrint('Request data: $data');
      }
    }
  }

  /// Log network response
  static void logResponse(int statusCode, String url, [dynamic data]) {
    if (kDebugMode) {
      debugPrint('$_prefix [HTTP] $statusCode $url');
      if (data != null) {
        debugPrint('Response data: $data');
      }
    }
  }
}
