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
    if (email.isEmpty) {
      throw Exception('Email is required');
    }

    if (password.isEmpty) {
      throw Exception('Password is required');
    }

    if (password.length < 6) {
      throw Exception('Password must be at least 6 characters');
    }

    if (displayName.isEmpty) {
      throw Exception('Display name is required');
    }

    return await repository.register(email, password, displayName, role: null);
  }
}
