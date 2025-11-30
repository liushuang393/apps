import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../../core/services/settings_service.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
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
              if (mounted) {
                Navigator.of(context).pop(); // 設定画面も閉じる
                // ログイン画面に戻る（必要に応じて実装）
              }
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
}
