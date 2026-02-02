import 'package:firebase_auth/firebase_auth.dart';
import '../repositories/auth_repository.dart';

/// Login use case
class LoginUseCase {
  final AuthRepository repository;

  LoginUseCase({required this.repository});

  Future<User> call({
    required String email,
    required String password,
  }) async {
    // Validate inputs
    if (email.isEmpty) {
      throw Exception('Email is required');
    }

    if (password.isEmpty) {
      throw Exception('Password is required');
    }

    return await repository.login(email, password);
  }
}
