import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../../core/network/auth_interceptor.dart';
import '../../../../core/utils/logger.dart';
import '../../domain/repositories/auth_repository.dart';

  /// Authentication provider for state management
  /// 目的: 管理用户认证状态
  /// I/O: 从AuthRepository获取数据，管理Firebase Auth状态
  /// 注意点: 处理登录、注册、登出、token管理。通过依赖注入方式接收FirebaseAuth，
  ///       以便在单元测试中可以注入Mock，避免直接访问真实Firebase环境。
  class AuthProvider with ChangeNotifier {
    final AuthRepository repository;
    final AuthInterceptor authInterceptor;
    final FirebaseAuth _firebaseAuth;

    AuthProvider({
      required this.repository,
      required this.authInterceptor,
      FirebaseAuth? firebaseAuth,
    }) : _firebaseAuth = firebaseAuth ?? FirebaseAuth.instance;

  // State
  User? _user;
  String? _userRole; // 'admin' or 'customer'
  bool _isLoading = false;
  bool _isAuthenticated = false;
  String? _errorMessage;

  // Getters
  User? get user => _user;
  String? get userRole => _userRole;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _isAuthenticated;
  String? get errorMessage => _errorMessage;
  bool get hasError => _errorMessage != null;
  bool get isAdmin => _userRole == 'admin';
  bool get isCustomer => _userRole == 'customer';

    /// Initialize auth state
    /// 目的: 初始化认证状态，监听Firebase Auth变化
    Future<void> initialize() async {
      _firebaseAuth.authStateChanges().listen((User? user) {
      _user = user;
      _isAuthenticated = user != null;

      if (user != null) {
        _updateAuthToken(user);
      }
      // AuthInterceptor automatically handles null user
      notifyListeners();
    });

    // Check if user is already signed in
      _user = _firebaseAuth.currentUser;
    _isAuthenticated = _user != null;

    if (_user != null) {
      await _updateAuthToken(_user!);
    }

    notifyListeners();
  }

  /// Update auth token in interceptor
  /// 目的: AuthInterceptor自动从FirebaseAuth获取token，此方法仅记录日志
  Future<void> _updateAuthToken(User user) async {
    try {
      // AuthInterceptor automatically fetches token from FirebaseAuth
      // This method just logs for debugging
      final token = await user.getIdToken();
      if (token != null) {
        AppLogger.info('Auth token refreshed');
      }
    } catch (e, stackTrace) {
      AppLogger.error('Failed to get auth token', e, stackTrace);
    }
  }

  /// Login with email and password
  /// 目的: 使用邮箱密码登录
  Future<bool> loginWithEmail({
    required String email,
    required String password,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

      try {
        AppLogger.info('Logging in with email: $email');

        final userCredential = await _firebaseAuth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );

      _user = userCredential.user;
      _isAuthenticated = true;

      if (_user != null) {
        await _updateAuthToken(_user!);
        // ログイン成功後、バックエンドからユーザープロフィールを取得してロールを設定
        await fetchUserProfile();
      }

      AppLogger.info('Login successful');
      _isLoading = false;
      notifyListeners();

      return true;
    } on FirebaseAuthException catch (e, stackTrace) {
      AppLogger.error('Login failed', e, stackTrace);
      _errorMessage = _getFirebaseErrorMessage(e);
      _isLoading = false;
      notifyListeners();
      return false;
    } catch (e, stackTrace) {
      AppLogger.error('Login failed', e, stackTrace);
      _errorMessage = 'ログインに失敗しました: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// Register with email and password
  /// 目的: 使用邮箱密码注册，支持指定角色
  /// 注意点: 通过repository注册，并将角色传递给后端API
  Future<bool> registerWithEmail({
    required String email,
    required String password,
    required String displayName,
    String? role, // 'admin' or 'customer'
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      AppLogger.info('Registering with email: $email, role: $role');

      // Use repository for registration (supports role parameter)
      // register(email, password, displayName, {role}) - 位置参数 + 可选命名参数
      final user = await repository.register(
        email,
        password,
        displayName,
        role: role,
      );

      _user = user;
      _isAuthenticated = true;

      if (_user != null) {
        await _updateAuthToken(_user!);
      }

      AppLogger.info('Registration successful');
      _isLoading = false;
      notifyListeners();

      return true;
    } on FirebaseAuthException catch (e, stackTrace) {
      AppLogger.error('Registration failed', e, stackTrace);
      _errorMessage = _getFirebaseErrorMessage(e);
      _isLoading = false;
      notifyListeners();
      return false;
    } catch (e, stackTrace) {
      AppLogger.error('Registration failed', e, stackTrace);
      _errorMessage = '登録に失敗しました: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// Anonymous login (for testing)
  /// 目的: 匿名登录（测试用）
  Future<bool> loginAnonymously() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

      try {
        AppLogger.info('Logging in anonymously');

        final userCredential = await _firebaseAuth.signInAnonymously();

      _user = userCredential.user;
      _isAuthenticated = true;

      if (_user != null) {
        await _updateAuthToken(_user!);
      }

      AppLogger.info('Anonymous login successful');
      _isLoading = false;
      notifyListeners();

      return true;
    } catch (e, stackTrace) {
      AppLogger.error('Anonymous login failed', e, stackTrace);
      _errorMessage = '匿名ログインに失敗しました: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// Logout
  /// 目的: 登出
  Future<void> logout() async {
    _isLoading = true;
    notifyListeners();

      try {
        AppLogger.info('Logging out');

        await _firebaseAuth.signOut();

      _user = null;
      _isAuthenticated = false;
      _userRole = null;
      // AuthInterceptor will automatically detect null user

      AppLogger.info('Logout successful');
      _isLoading = false;
      notifyListeners();
    } catch (e, stackTrace) {
      AppLogger.error('Logout failed', e, stackTrace);
      _errorMessage = 'ログアウトに失敗しました: $e';
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Set user role
  /// 目的: 设置用户角色（admin/customer）
  void setUserRole(String role) {
    _userRole = role;
    AppLogger.info('User role set to: $role');
    notifyListeners();
  }

  /// Fetch user profile from backend
  /// 目的: バックエンドからユーザープロフィールを取得してロールを設定
  Future<void> fetchUserProfile() async {
    if (_user == null) {
      AppLogger.warning('Cannot fetch profile: user is null');
      return;
    }

    try {
      final profile = await repository.getUserProfile();
      final role = profile['role'] as String?;
      if (role != null) {
        _userRole = role;
        AppLogger.info('User role fetched from backend: $role');
        notifyListeners();
      }
    } catch (e, stackTrace) {
      AppLogger.error('Failed to fetch user profile', e, stackTrace);
      // エラー時はロールを設定しない（デフォルトのまま）
    }
  }

  /// Check if admin user exists
  /// 目的: 管理者ユーザーが存在するかチェック
  Future<bool> checkAdminExists() async {
    try {
      return await repository.checkAdminExists();
    } catch (e, stackTrace) {
      AppLogger.error('Failed to check admin exists', e, stackTrace);
      // エラー時は管理者が存在すると仮定（セキュリティのため）
      return true;
    }
  }

  /// Clear error message
  /// 目的: 清除错误消息
  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  /// Get Firebase error message in Japanese
  /// 目的: 将Firebase错误转换为日语消息
  String _getFirebaseErrorMessage(FirebaseAuthException e) {
    switch (e.code) {
      case 'user-not-found':
        return 'このメールアドレスは登録されていません';
      case 'wrong-password':
        return 'パスワードが正しくありません';
      case 'email-already-in-use':
        return 'このメールアドレスは既に使用されています';
      case 'invalid-email':
        return 'メールアドレスの形式が正しくありません';
      case 'weak-password':
        return 'パスワードが弱すぎます（6文字以上必要）';
      case 'user-disabled':
        return 'このアカウントは無効化されています';
      case 'too-many-requests':
        return 'ログイン試行回数が多すぎます。しばらく待ってから再試行してください';
      default:
        return '認証エラー: ${e.message}';
    }
  }
}
