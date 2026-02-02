import 'package:firebase_auth/firebase_auth.dart';
import '../repositories/auth_repository.dart';

/// Register use case
class RegisterUseCase {
  final AuthRepository repository;

  RegisterUseCase({required this.repository});

  Future<User> call({
    required String email,
    required String password,
    required String displayName,
  }) async {
    // Validate inputs
    // 目的: 入力値のバリデーション
    // 注意点: セキュリティ強化のため、パスワード要件を厳格化
    if (email.isEmpty) {
      throw Exception('Email is required');
    }

    if (password.isEmpty) {
      throw Exception('Password is required');
    }

    // パスワード強度チェック（セキュリティ強化）
    if (password.length < 8) {
      throw Exception('パスワードは8文字以上必要です');
    }
    if (!RegExp(r'[A-Z]').hasMatch(password)) {
      throw Exception('パスワードに大文字を含めてください');
    }
    if (!RegExp(r'[a-z]').hasMatch(password)) {
      throw Exception('パスワードに小文字を含めてください');
    }
    if (!RegExp(r'[0-9]').hasMatch(password)) {
      throw Exception('パスワードに数字を含めてください');
    }
    if (!RegExp(r"[!@#$%^&*(),.?:{}|<>_\-+=\[\]\\/`~';]").hasMatch(password)) {
      throw Exception('パスワードに特殊文字（!@#\$%^&*など）を含めてください');
    }

    if (displayName.isEmpty) {
      throw Exception('Display name is required');
    }

    return await repository.register(email, password, displayName, role: null);
  }
}
