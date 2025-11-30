import 'package:firebase_auth/firebase_auth.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/utils/logger.dart';
import '../../../../core/services/mock_auth_service.dart';

/// Auth remote data source interface
/// 目的: 認証データソースのインターフェース
/// 注意点: registerメソッドでroleパラメータをサポート
abstract class AuthRemoteDataSource {
  Future<User> register(String email, String password, String displayName, {String? role});
  Future<User> login(String email, String password);
  Future<void> logout();
  Future<User?> getCurrentUser();
  Future<bool> checkAdminExists();
  Future<Map<String, dynamic>> getUserProfile();
}

/// Auth remote data source implementation
class AuthRemoteDataSourceImpl implements AuthRemoteDataSource {
  final ApiClient apiClient;
  final FirebaseAuth _firebaseAuth;

  AuthRemoteDataSourceImpl({
    required this.apiClient,
    FirebaseAuth? firebaseAuth,
  }) : _firebaseAuth = firebaseAuth ?? FirebaseAuth.instance;

  @override
  Future<User> register(
    String email,
    String password,
    String displayName, {
    String? role,
  }) async {
    try {
      // Check if using mock authentication
      if (MockAuthService.isEnabled) {
        AppLogger.info('Using mock authentication for registration, role: $role');

        // Use mock authentication
        final mockResult = await MockAuthService.mockRegister(
          email: email,
          password: password,
          displayName: displayName,
        );

        // Use Firebase Anonymous Auth as a workaround (doesn't require API key)
        // Then we'll use the mock token for backend API calls
        final userCredential = await _firebaseAuth.signInAnonymously();
        final user = userCredential.user;

        if (user == null) {
          throw Exception('Failed to create anonymous user');
        }

        // Update display name (local only)
        await user.updateDisplayName(displayName);

        // Create user profile in backend with mock token
        try {
          await apiClient.post(
            '/api/auth/register',
            data: {
              'firebase_token': mockResult.token,
              'email': email,
              'display_name': displayName,
              if (role != null) 'role': role, // 役割をバックエンドに送信
            },
          );
          AppLogger.info('Mock user created in backend: ${mockResult.uid}, role: $role');
        } catch (e, stackTrace) {
          AppLogger.error('Failed to create user in backend', e, stackTrace);
          throw Exception('Failed to register user in backend: $e');
        }

        AppLogger.info('Mock registration successful');
        return user;
      }

      // 本番環境: 後端で Firebase + DB を一括登録
      // これにより、失敗時のロールバックが可能になる
      final response = await apiClient.post(
        '/api/auth/register',
        data: {
          'email': email,
          'password': password,
          'display_name': displayName,
          if (role != null) 'role': role,
        },
      );

      // 後端での登録成功後、Firebase にログインして User オブジェクトを取得
      final userCredential = await _firebaseAuth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );

      final user = userCredential.user;
      if (user == null) {
        throw Exception('Failed to sign in after registration');
      }

      AppLogger.info('User registered successfully: ${user.uid}, role: $role, response: $response');
      return user;
    } on FirebaseAuthException catch (e, stackTrace) {
      AppLogger.error('Registration failed', e, stackTrace);
      throw _handleFirebaseError(e);
    } catch (e, stackTrace) {
      AppLogger.error('Registration failed', e, stackTrace);
      throw Exception('Failed to register: $e');
    }
  }

  @override
  Future<User> login(String email, String password) async {
    try {
      // Check if using mock authentication
      if (MockAuthService.isEnabled) {
        AppLogger.info('Using mock authentication for login');

        // Use mock authentication
        final mockResult = await MockAuthService.mockLogin(
          email: email,
          password: password,
        );

        // Use Firebase Anonymous Auth as a workaround
        final userCredential = await _firebaseAuth.signInAnonymously();
        final user = userCredential.user;

        if (user == null) {
          throw Exception('Failed to sign in anonymously');
        }

        // Update display name
        await user.updateDisplayName(mockResult.displayName);

        // Update last login in backend with mock token
        try {
          await apiClient.post(
            '/api/auth/login',
            data: {
              'firebase_token': mockResult.token,
            },
          );
          AppLogger.info('Mock login successful in backend: ${mockResult.uid}');
        } catch (e, stackTrace) {
          AppLogger.error('Failed to login in backend', e, stackTrace);
          throw Exception('Failed to login in backend: $e');
        }

        AppLogger.info('Mock login successful');
        return user;
      }

      final userCredential = await _firebaseAuth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );

      final user = userCredential.user;
      if (user == null) {
        throw Exception('Failed to login');
      }

      // Get Firebase ID token
      final idToken = await user.getIdToken();

      // Update last login in backend
      await apiClient.post(
        '/api/auth/login',
        data: {
          'firebase_token': idToken,
        },
      );

      AppLogger.info('User logged in successfully: ${user.uid}');
      return user;
    } on FirebaseAuthException catch (e, stackTrace) {
      AppLogger.error('Login failed', e, stackTrace);
      throw _handleFirebaseError(e);
    } catch (e, stackTrace) {
      AppLogger.error('Login failed', e, stackTrace);
      throw Exception('Failed to login: $e');
    }
  }

  @override
  Future<void> logout() async {
    try {
      await _firebaseAuth.signOut();
      AppLogger.info('User logged out successfully');
    } catch (e, stackTrace) {
      AppLogger.error('Logout failed', e, stackTrace);
      throw Exception('Failed to logout: $e');
    }
  }

  @override
  Future<User?> getCurrentUser() async {
    return _firebaseAuth.currentUser;
  }

  /// Check if admin user exists
  /// 目的: 管理者ユーザーが存在するかチェック
  /// I/O: APIレスポンスから管理者の存在有無を返す
  /// 注意点: エラー時はセキュリティのため管理者が存在すると仮定
  @override
  Future<bool> checkAdminExists() async {
    try {
      AppLogger.info('管理者チェックAPI呼び出し開始: /api/users/check-admin');
      final response = await apiClient.get('/api/users/check-admin');
      AppLogger.logResponse(response.statusCode ?? 0, '/api/users/check-admin', response.data);
      final data = response.data as Map<String, dynamic>;
      final hasAdmin = data['data']?['hasAdmin'] ?? false;
      AppLogger.info('管理者チェックAPI結果: hasAdmin=$hasAdmin');
      return hasAdmin;
    } catch (e, stackTrace) {
      AppLogger.error('管理者チェックAPIエラー', e, stackTrace);
      // エラー時は管理者が存在すると仮定（セキュリティのため）
      AppLogger.warning('エラーのため、管理者が存在すると仮定します');
      return true;
    }
  }

  /// Get user profile from backend
  /// 目的: バックエンドからユーザープロフィールを取得
  @override
  Future<Map<String, dynamic>> getUserProfile() async {
    try {
      final response = await apiClient.get('/api/users/me');
      final data = response.data as Map<String, dynamic>;
      return data['data'] as Map<String, dynamic>;
    } catch (e, stackTrace) {
      AppLogger.error('Failed to get user profile', e, stackTrace);
      rethrow;
    }
  }

  /// Handle Firebase Auth errors
  /// 目的: Firebase認証エラーを処理して詳細なエラーメッセージを返す
  /// I/O: FirebaseAuthExceptionを受け取り、詳細なExceptionを返す
  /// 注意点: エラーコードに基づいて適切なエラーメッセージを返す
  Exception _handleFirebaseError(FirebaseAuthException e) {
    AppLogger.error('Firebase Auth error occurred', e, e.stackTrace);
    
    switch (e.code) {
      case 'weak-password':
        return Exception('The password is too weak');
      case 'email-already-in-use':
        return Exception('An account with this email already exists');
      case 'invalid-email':
        return Exception('Invalid email address');
      case 'user-not-found':
        return Exception('No user found with this email');
      case 'wrong-password':
        return Exception('Incorrect password');
      case 'user-disabled':
        return Exception('This account has been disabled');
      case 'too-many-requests':
        return Exception('Too many attempts. Please try again later');
      case 'configuration-not-found':
        return Exception('Firebase configuration not found. Please check Firebase setup.');
      case 'network-request-failed':
        return Exception('Network request failed. Please check your internet connection.');
      case 'invalid-api-key':
        return Exception('Invalid API key. Please check Firebase configuration.');
      default:
        return Exception('Authentication failed: ${e.code} - ${e.message ?? "Unknown error"}');
    }
  }
}
