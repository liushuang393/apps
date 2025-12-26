import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'dart:async';
import '../../../../core/constants/app_theme.dart';
import '../providers/auth_provider.dart';
import '../../../campaign/presentation/pages/campaign_list_page.dart';
import '../../../admin/presentation/pages/admin_dashboard_page.dart';

/// Registration page
/// 目的: 新規ユーザー登録画面
/// I/O: メールアドレス、パスワード、表示名、役割で登録
/// 注意点: Firebase Authを使用、エラーメッセージは日本語、管理者が存在する場合は管理者登録を非表示
class RegisterPage extends StatefulWidget {
  final bool showAppBar;
  final String? initialRole; // 初期ロール（'admin' or 'customer'）
  
  const RegisterPage({super.key, this.showAppBar = true, this.initialRole});

  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _displayNameController = TextEditingController();
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
  // ignore: unused_field
  bool _hasAdmin = false;
  // ignore: unused_field
  bool _isCheckingAdmin = true;
  String? _selectedRole; // 'admin' or 'customer', null if admin exists

  @override
  void initState() {
    super.initState();
    _checkAdminExists();
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _displayNameController.dispose();
    super.dispose();
  }

  /// 管理者が存在するかチェック
  /// 目的: DBに管理者データがあるか確認
  /// I/O: 管理者の存在有無を返す
  /// 注意点: initialRoleが指定されている場合はそれを優先
  Future<void> _checkAdminExists() async {
    final authProvider = context.read<AuthProvider>();
    try {
      final hasAdmin = await authProvider.checkAdminExists();
      if (mounted) {
        setState(() {
          _hasAdmin = hasAdmin;
          _isCheckingAdmin = false;
          // initialRoleが指定されている場合はそれを優先
          if (widget.initialRole != null) {
            _selectedRole = widget.initialRole;
          } else {
            // 管理者が存在しない場合のみ管理者登録を許可
            _selectedRole = hasAdmin ? 'customer' : null;
          }
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _hasAdmin = true; // エラー時はセキュリティのため管理者が存在すると仮定
          _isCheckingAdmin = false;
          _selectedRole = widget.initialRole ?? 'customer';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      appBar: widget.showAppBar
          ? AppBar(
              title: const Text('新規登録'),
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
                  'アカウント作成',
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
                  '必要な情報を入力してください',
                  style: TextStyle(
                    fontSize: 14,
                    color: AppTheme.textSecondaryColor,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 40),

                // Display name field
                TextFormField(
                  controller: _displayNameController,
                  decoration: const InputDecoration(
                    labelText: '表示名',
                    hintText: '山田太郎',
                    prefixIcon: Icon(Icons.person_outlined),
                    border: OutlineInputBorder(),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return '表示名を入力してください';
                    }
                    if (value.length < 2) {
                      return '表示名は2文字以上必要です';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),

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
                    hintText: '8文字以上、大小文字・数字・記号を含む',
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
                    if (value.length < 8) {
                      return 'パスワードは8文字以上必要です';
                    }
                    if (!RegExp(r'[A-Z]').hasMatch(value)) {
                      return 'パスワードに大文字を含めてください';
                    }
                    if (!RegExp(r'[a-z]').hasMatch(value)) {
                      return 'パスワードに小文字を含めてください';
                    }
                    if (!RegExp(r'[0-9]').hasMatch(value)) {
                      return 'パスワードに数字を含めてください';
                    }
                    if (!RegExp(r"[!@#$%^&*(),.?:{}|<>_\-+=\[\]\\/`~';]").hasMatch(value)) {
                      return 'パスワードに特殊文字（!@#\$%^&*など）を含めてください';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),

                // Confirm password field
                TextFormField(
                  controller: _confirmPasswordController,
                  obscureText: _obscureConfirmPassword,
                  decoration: InputDecoration(
                    labelText: 'パスワード（確認）',
                    hintText: 'もう一度入力',
                    prefixIcon: const Icon(Icons.lock_outlined),
                    suffixIcon: IconButton(
                      icon: Icon(
                        _obscureConfirmPassword
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined,
                      ),
                      onPressed: () {
                        setState(() {
                          _obscureConfirmPassword = !_obscureConfirmPassword;
                        });
                      },
                    ),
                    border: const OutlineInputBorder(),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'パスワードを再入力してください';
                    }
                    if (value != _passwordController.text) {
                      return 'パスワードが一致しません';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 24),

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

                // Register button
                Consumer<AuthProvider>(
                  builder: (context, authProvider, child) {
                    return ElevatedButton(
                      onPressed: authProvider.isLoading
                          ? null
                          : () => _handleRegister(context),
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
                          : const Text('登録'),
                    );
                  },
                ),
                const SizedBox(height: 24),

                // Terms note
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    '登録することで、利用規約とプライバシーポリシーに同意したものとみなします。',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.grey[600],
                      height: 1.5,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
                const SizedBox(height: 24),

                // Login link
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'すでにアカウントをお持ちの方',
                      style: TextStyle(fontSize: 14),
                    ),
                    TextButton(
                      onPressed: () {
                        Navigator.of(context).pop();
                      },
                      child: const Text(
                        'ログイン',
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

  Future<void> _handleRegister(BuildContext context) async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    // 役割が選択されていない場合（管理者が存在する場合は顧客として登録）
    final role = _selectedRole ?? 'customer';

    final authProvider = context.read<AuthProvider>();
    authProvider.clearError();

    final success = await authProvider.registerWithEmail(
      email: _emailController.text.trim(),
      password: _passwordController.text,
      displayName: _displayNameController.text.trim(),
      role: role,
    );

    if (!mounted) return;

    if (success && mounted) {
      // データベースからユーザーの役割を取得
      await authProvider.fetchUserProfile();
      if (!context.mounted) return;
      
      // データベースの役割に応じて画面遷移
      final userRole = authProvider.userRole ?? 'customer';
      final targetPage = userRole == 'admin'
          ? const AdminDashboardPage()
          : const CampaignListPage();
      
      unawaited(
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(
            builder: (context) => targetPage,
          ),
          (route) => false,
        ),
      );
    }
  }

  /// 役割選択ウィジェット（管理者が存在しない場合のみ表示）
  // ignore: unused_element
  Widget _buildRoleSelection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          '役割を選択',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: AppTheme.textPrimaryColor,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _buildRoleOption(
                '管理者',
                'admin',
                Icons.admin_panel_settings,
                AppTheme.primaryColor,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildRoleOption(
                '顧客',
                'customer',
                Icons.person,
                AppTheme.successColor,
              ),
            ),
          ],
        ),
        const SizedBox(height: 24),
      ],
    );
  }

  Widget _buildRoleOption(String title, String role, IconData icon, Color color) {
    final isSelected = _selectedRole == role;
    return InkWell(
      onTap: () {
        setState(() {
          _selectedRole = role;
        });
      },
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isSelected ? color.withValues(alpha: 0.1) : Colors.transparent,
          border: Border.all(
            color: isSelected ? color : Colors.grey[300]!,
            width: isSelected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Icon(
              icon,
              color: isSelected ? color : Colors.grey[600],
              size: 32,
            ),
            const SizedBox(height: 8),
            Text(
              title,
              style: TextStyle(
                fontSize: 14,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                color: isSelected ? color : Colors.grey[600],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
