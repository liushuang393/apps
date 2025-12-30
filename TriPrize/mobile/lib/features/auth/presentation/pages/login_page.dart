import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../../core/navigation/navigation_service.dart';
import '../../../../core/utils/logger.dart';
import '../providers/auth_provider.dart';
import 'register_page.dart';
import 'forgot_password_page.dart';
import 'dart:async' show unawaited;

/// Login page
/// 目的: ユーザーログイン画面
/// I/O: メールアドレスとパスワードで認証、データベースから役割を取得して画面遷移
/// 注意点: Firebase Authを使用、エラーメッセージは日本語、データベースの役割に応じて画面遷移
class LoginPage extends StatefulWidget {
  final bool showAppBar;
  
  const LoginPage({super.key, this.showAppBar = true});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      appBar: widget.showAppBar
          ? AppBar(
              title: const Text('ログイン'),
              backgroundColor: Colors.transparent,
              elevation: 0,
            )
          : null,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 32),

                // Logo
                Center(
                  child: Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      color: AppTheme.primaryColor,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: const Icon(
                      Icons.landscape,
                      size: 48,
                      color: Colors.white,
                    ),
                  ),
                ),
                const SizedBox(height: 24),

                // Title
                const Text(
                  'TriPrizeにログイン',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimaryColor,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),

                // Subtitle
                const Text(
                  'アカウント情報を入力してください',
                  style: TextStyle(
                    fontSize: 14,
                    color: AppTheme.textSecondaryColor,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 40),

                // Email field
                TextFormField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(
                    labelText: 'メールアドレス',
                    hintText: 'example@email.com',
                    prefixIcon: Icon(Icons.email_outlined),
                    border: OutlineInputBorder(),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'メールアドレスを入力してください';
                    }
                    if (!value.contains('@')) {
                      return '有効なメールアドレスを入力してください';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),

                // Password field
                TextFormField(
                  controller: _passwordController,
                  obscureText: _obscurePassword,
                  decoration: InputDecoration(
                    labelText: 'パスワード',
                    hintText: '6文字以上',
                    prefixIcon: const Icon(Icons.lock_outlined),
                    suffixIcon: IconButton(
                      icon: Icon(
                        _obscurePassword
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined,
                      ),
                      onPressed: () {
                        setState(() {
                          _obscurePassword = !_obscurePassword;
                        });
                      },
                    ),
                    border: const OutlineInputBorder(),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'パスワードを入力してください';
                    }
                    if (value.length < 6) {
                      return 'パスワードは6文字以上必要です';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 8),

                // Forgot password link
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (context) => const ForgotPasswordPage(),
                        ),
                      );
                    },
                    child: const Text(
                      'パスワードを忘れた方',
                      style: TextStyle(
                        fontSize: 14,
                        color: AppTheme.primaryColor,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // Error message
                Consumer<AuthProvider>(
                  builder: (context, authProvider, child) {
                    if (authProvider.hasError) {
                      return Container(
                        padding: const EdgeInsets.all(12),
                        margin: const EdgeInsets.only(bottom: 16),
                        decoration: BoxDecoration(
                          color: AppTheme.errorColor.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: AppTheme.errorColor.withValues(alpha: 0.3),
                          ),
                        ),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.error_outline,
                              color: AppTheme.errorColor,
                              size: 20,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                authProvider.errorMessage ?? 'エラーが発生しました',
                                style: const TextStyle(
                                  fontSize: 13,
                                  color: AppTheme.errorColor,
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    }
                    return const SizedBox.shrink();
                  },
                ),

                // Login button
                Consumer<AuthProvider>(
                  builder: (context, authProvider, child) {
                    return ElevatedButton(
                      onPressed: authProvider.isLoading
                          ? null
                          : () => _handleLogin(context),
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.all(16),
                        textStyle: const TextStyle(fontSize: 16),
                      ),
                      child: authProvider.isLoading
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor:
                                    AlwaysStoppedAnimation<Color>(Colors.white),
                              ),
                            )
                          : const Text('ログイン'),
                    );
                  },
                ),
                const SizedBox(height: 24),

                // Register link
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'アカウントをお持ちでない方',
                      style: TextStyle(fontSize: 14),
                    ),
                    TextButton(
                      onPressed: () {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (context) => const RegisterPage(),
                          ),
                        );
                      },
                      child: const Text(
                        '新規登録',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _handleLogin(BuildContext context) async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    final authProvider = context.read<AuthProvider>();
    authProvider.clearError();

    AppLogger.info('ログイン試行開始: ${_emailController.text.trim()}');
    
    final success = await authProvider.loginWithEmail(
      email: _emailController.text.trim(),
      password: _passwordController.text,
    );

    if (!mounted) return;

    if (success) {
      AppLogger.info('ログイン成功');
      // データベースからユーザーの役割を取得
      try {
        await authProvider.fetchUserProfile();
        AppLogger.info('ユーザープロフィール取得成功');
      } catch (e, stackTrace) {
        AppLogger.error('ユーザープロフィール取得エラー', e, stackTrace);
      }

      // データベースの役割に応じて画面遷移
      final userRole = authProvider.userRole ?? 'customer';
      AppLogger.info('ユーザーロール: $userRole');

      // NavigationServiceにユーザーロールを設定
      NavigationService.setUserRole(userRole);

      // ignore: use_build_context_synchronously, unawaited_futures
      unawaited(
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(
            builder: (context) => NavigationService.getHomePageForRole(userRole),
          ),
          (route) => false,
        ),
      );
    } else {
      AppLogger.warning('ログイン失敗: ${authProvider.errorMessage}');
    }
  }
}
