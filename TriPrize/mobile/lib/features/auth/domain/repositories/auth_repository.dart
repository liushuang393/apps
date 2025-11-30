import 'package:firebase_auth/firebase_auth.dart';

/// Auth repository interface
/// 目的: 認証機能のインターフェース定義
/// 注意点: roleパラメータで顧客/管理者を区別
abstract class AuthRepository {
  Future<User> register(String email, String password, String displayName, {String? role});
  Future<User> login(String email, String password);
  Future<void> logout();
  Future<User?> getCurrentUser();
  Stream<User?> authStateChanges();
  Future<bool> checkAdminExists();
  Future<Map<String, dynamic>> getUserProfile();
}
