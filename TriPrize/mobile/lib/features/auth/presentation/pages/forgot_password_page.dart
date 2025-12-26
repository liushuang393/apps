import 'package:flutter/material.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../../core/utils/logger.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/di/injection.dart';

/// Forgot Password page
/// 目的: パスワードリセットメール送信画面
/// I/O: メールアドレスを入力してリセットメールを送信
/// 注意点: Firebase Auth経由でパスワードリセットメールを送信
class ForgotPasswordPage extends StatefulWidget {
  const ForgotPasswordPage({super.key});

  @override
  State<ForgotPasswordPage> createState() => _ForgotPasswordPageState();
}

class _ForgotPasswordPageState extends State<ForgotPasswordPage> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  bool _isLoading = false;
  String? _errorMessage;
  bool _emailSent = false;

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      appBar: AppBar(
        title: const Text('パスワードを忘れた方'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: _emailSent ? _buildSuccessContent() : _buildFormContent(),
        ),
      ),
    );
  }

  Widget _buildSuccessContent() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const SizedBox(height: 48),
        Container(
          width: 80,
          height: 80,
          decoration: BoxDecoration(
            color: AppTheme.successColor.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(40),
          ),
          child: const Icon(
            Icons.mark_email_read_outlined,
            size: 48,
            color: AppTheme.successColor,
          ),
        ),
        const SizedBox(height: 24),
        const Text(
          'メールを送信しました',
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.bold,
            color: AppTheme.textPrimaryColor,
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        Text(
          '${_emailController.text} にパスワードリセット用のリンクを送信しました。\n\nメールをご確認ください。',
          style: const TextStyle(
            fontSize: 14,
            color: AppTheme.textSecondaryColor,
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 32),
        ElevatedButton(
          onPressed: () => Navigator.of(context).pop(),
          style: ElevatedButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 48, vertical: 16),
          ),
          child: const Text('ログイン画面に戻る'),
        ),
      ],
    );
  }

  Widget _buildFormContent() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 32),
          // アイコン
          Center(
            child: Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: AppTheme.primaryColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(40),
              ),
              child: const Icon(
                Icons.lock_reset,
                size: 48,
                color: AppTheme.primaryColor,
              ),
            ),
          ),
          const SizedBox(height: 24),
          // タイトル
          const Text(
            'パスワードをリセット',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: AppTheme.textPrimaryColor,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          // 説明
          const Text(
            '登録済みのメールアドレスを入力してください。\nパスワードリセット用のリンクを送信します。',
            style: TextStyle(fontSize: 14, color: AppTheme.textSecondaryColor),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 40),
          // メールアドレス入力
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
          const SizedBox(height: 24),
          // エラーメッセージ
          if (_errorMessage != null) ...[
            _buildErrorMessage(),
            const SizedBox(height: 16),
          ],
          // 送信ボタン
          ElevatedButton(
            onPressed: _isLoading ? null : _handleSubmit,
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.all(16),
              textStyle: const TextStyle(fontSize: 16),
            ),
            child: _isLoading
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                  )
                : const Text('リセットメールを送信'),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorMessage() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.errorColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.errorColor.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppTheme.errorColor, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _errorMessage!,
              style: const TextStyle(fontSize: 13, color: AppTheme.errorColor),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final apiClient = inject<ApiClient>();
      AppLogger.info('パスワードリセット要求: ${_emailController.text.trim()}');

      // API路径需要包含 /api 前缀，与其他API调用保持一致
      await apiClient.post('/api/auth/forgot-password', data: {
        'email': _emailController.text.trim(),
      });

      AppLogger.info('パスワードリセットメール送信成功');
      if (mounted) {
        setState(() {
          _emailSent = true;
          _isLoading = false;
        });
      }
    } catch (e, stackTrace) {
      AppLogger.error('パスワードリセット失敗', e, stackTrace);
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = '送信に失敗しました。しばらく時間をおいて再度お試しください。';
        });
      }
    }
  }
}

