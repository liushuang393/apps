import 'package:firebase_auth/firebase_auth.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/auth_remote_datasource.dart';

/// Auth repository implementation
class AuthRepositoryImpl implements AuthRepository {
  final AuthRemoteDataSource remoteDataSource;
  final FirebaseAuth _firebaseAuth = FirebaseAuth.instance;

  AuthRepositoryImpl({required this.remoteDataSource});

  @override
  Future<User> register(
    String email,
    String password,
    String displayName, {
    String? role,
  }) async {
    return await remoteDataSource.register(email, password, displayName, role: role);
  }

  @override
  Future<User> login(String email, String password) async {
    return await remoteDataSource.login(email, password);
  }

  @override
  Future<void> logout() async {
    return await remoteDataSource.logout();
  }

  @override
  Future<User?> getCurrentUser() async {
    return await remoteDataSource.getCurrentUser();
  }

  @override
  Stream<User?> authStateChanges() {
    return _firebaseAuth.authStateChanges();
  }

  @override
  Future<bool> checkAdminExists() async {
    return await remoteDataSource.checkAdminExists();
  }

  @override
  Future<Map<String, dynamic>> getUserProfile() async {
    return await remoteDataSource.getUserProfile();
  }
}
