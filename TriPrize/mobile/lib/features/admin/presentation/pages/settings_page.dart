import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../../core/services/settings_service.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import 'address_edit_page.dart';
import 'terms_of_service_page.dart';
import 'privacy_policy_page.dart';

/// 設定画面
/// 目的: 管理者向けの設定画面
/// I/O: アプリ設定、通知設定、その他の設定項目を管理
/// 注意点: 設定はローカルストレージに保存される
class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final SettingsService _settingsService = SettingsService();
  bool _pushNotificationEnabled = true;
  bool _emailNotificationEnabled = true;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  /// 設定を読み込む
  /// 目的: 保存された設定を読み込んで表示
  Future<void> _loadSettings() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final pushEnabled = await _settingsService.getPushNotificationEnabled();
      final emailEnabled = await _settingsService.getEmailNotificationEnabled();

      setState(() {
        _pushNotificationEnabled = pushEnabled;
        _emailNotificationEnabled = emailEnabled;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('設定の読み込みに失敗しました'),
            backgroundColor: AppTheme.errorColor,
          ),
        );
      }
    }
  }

  /// プッシュ通知設定を更新
  /// 目的: プッシュ通知の有効/無効を切り替えて保存
  Future<void> _updatePushNotification(bool enabled) async {
    setState(() {
      _pushNotificationEnabled = enabled;
    });

    final success = await _settingsService.setPushNotificationEnabled(enabled);
    if (!success && mounted) {
      setState(() {
        _pushNotificationEnabled = !enabled; // 元に戻す
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('設定の保存に失敗しました'),
          backgroundColor: AppTheme.errorColor,
        ),
      );
    }
  }

  /// メール通知設定を更新
  /// 目的: メール通知の有効/無効を切り替えて保存
  Future<void> _updateEmailNotification(bool enabled) async {
    setState(() {
      _emailNotificationEnabled = enabled;
    });

    final success = await _settingsService.setEmailNotificationEnabled(enabled);
    if (!success && mounted) {
      setState(() {
        _emailNotificationEnabled = !enabled; // 元に戻す
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('設定の保存に失敗しました'),
          backgroundColor: AppTheme.errorColor,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('設定'),
        ),
        body: const Center(
          child: CircularProgressIndicator(),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('設定'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // アカウント設定セクション
          _buildSectionTitle('アカウント設定'),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.local_shipping),
                  title: const Text('配送先住所'),
                  subtitle: const Text('当選した賞品の配送先を設定'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (context) => const AddressEditPage(),
                      ),
                    );
                  },
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.lock_outline),
                  title: const Text('パスワード変更'),
                  subtitle: const Text('ログインパスワードを変更'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _showChangePasswordDialog(context),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // 通知設定セクション
          _buildSectionTitle('通知設定'),
          Card(
            child: Column(
              children: [
                SwitchListTile(
                  title: const Text('プッシュ通知'),
                  subtitle: const Text('重要なイベントの通知を受け取る'),
                  value: _pushNotificationEnabled,
                  onChanged: _updatePushNotification,
                ),
                const Divider(height: 1),
                SwitchListTile(
                  title: const Text('メール通知'),
                  subtitle: const Text('メールでの通知を受け取る'),
                  value: _emailNotificationEnabled,
                  onChanged: _updateEmailNotification,
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // アプリ情報セクション
          _buildSectionTitle('アプリ情報'),
          Card(
            child: Column(
              children: [
                const ListTile(
                  title: Text('バージョン'),
                  subtitle: Text('1.0.0'),
                  trailing: Icon(Icons.info_outline),
                ),
                const Divider(height: 1),
                ListTile(
                  title: const Text('利用規約'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (context) => const TermsOfServicePage(),
                      ),
                    );
                  },
                ),
                const Divider(height: 1),
                ListTile(
                  title: const Text('プライバシーポリシー'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (context) => const PrivacyPolicyPage(),
                      ),
                    );
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // その他セクション
          _buildSectionTitle('その他'),
          Card(
            child: Column(
              children: [
                ListTile(
                  title: const Text('ログアウト'),
                  leading: const Icon(Icons.logout, color: AppTheme.errorColor),
                  textColor: AppTheme.errorColor,
                  onTap: () {
                    _showLogoutDialog(context);
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.bold,
          color: AppTheme.textSecondaryColor,
        ),
      ),
    );
  }

  /// ログアウト確認ダイアログを表示
  /// 目的: ユーザーにログアウトの確認を求め、確認後にセッションをクリアしてログイン画面に戻る
  void _showLogoutDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('ログアウト'),
        content: const Text('ログアウトしますか？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('キャンセル'),
          ),
          TextButton(
            onPressed: () async {
              Navigator.of(context).pop(); // ダイアログを閉じる
              final authProvider = context.read<AuthProvider>();
              await authProvider.logout();
              if (!context.mounted) return;
              // ログイン画面（役割選択画面）に戻る - 全ての画面スタックをクリア
              await Navigator.of(context).pushNamedAndRemoveUntil(
                '/',
                (route) => false,
              );
            },
            child: const Text(
              'ログアウト',
              style: TextStyle(color: AppTheme.errorColor),
            ),
          ),
        ],
      ),
    );
  }

  /// パスワード変更ダイアログを表示
  /// 目的: 現在のパスワードと新しいパスワードを入力させて変更
  void _showChangePasswordDialog(BuildContext context) {
    final currentPasswordController = TextEditingController();
    final newPasswordController = TextEditingController();
    final confirmPasswordController = TextEditingController();
    final formKey = GlobalKey<FormState>();
    bool isLoading = false;

    showDialog(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('パスワード変更'),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: currentPasswordController,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: '現在のパスワード',
                    prefixIcon: Icon(Icons.lock),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return '現在のパスワードを入力してください';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: newPasswordController,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: '新しいパスワード',
                    prefixIcon: Icon(Icons.lock_outline),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return '新しいパスワードを入力してください';
                    }
                    if (value.length < 8) {
                      return 'パスワードは8文字以上必要です';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: confirmPasswordController,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: '新しいパスワード（確認）',
                    prefixIcon: Icon(Icons.lock_outline),
                  ),
                  validator: (value) {
                    if (value != newPasswordController.text) {
                      return 'パスワードが一致しません';
                    }
                    return null;
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: isLoading ? null : () => Navigator.of(dialogContext).pop(),
              child: const Text('キャンセル'),
            ),
            TextButton(
              onPressed: isLoading
                  ? null
                  : () async {
                      if (!formKey.currentState!.validate()) return;

                      setDialogState(() => isLoading = true);

                      try {
                        final authProvider = context.read<AuthProvider>();
                        await authProvider.changePassword(
                          currentPasswordController.text,
                          newPasswordController.text,
                        );
                        if (!dialogContext.mounted) return;
                        Navigator.of(dialogContext).pop();
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('パスワードを変更しました'),
                            backgroundColor: AppTheme.successColor,
                          ),
                        );
                      } catch (e) {
                        setDialogState(() => isLoading = false);
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text('パスワード変更に失敗しました: $e'),
                            backgroundColor: AppTheme.errorColor,
                          ),
                        );
                      }
                    },
              child: isLoading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('変更する'),
            ),
          ],
        ),
      ),
    );
  }
}
