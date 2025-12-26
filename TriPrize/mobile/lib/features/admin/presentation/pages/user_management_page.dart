import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../data/models/user_model.dart';
import '../providers/user_provider.dart';

/// User management page for admin
class UserManagementPage extends StatefulWidget {
  const UserManagementPage({super.key});

  @override
  State<UserManagementPage> createState() => _UserManagementPageState();
}

class _UserManagementPageState extends State<UserManagementPage> {
  @override
  void initState() {
    super.initState();
    // Fetch users when page loads
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<UserProvider>().fetchUsers();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ユーザー管理'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              context.read<UserProvider>().fetchUsers();
            },
          ),
        ],
      ),
      body: Consumer<UserProvider>(
        builder: (context, provider, child) {
          if (provider.isLoading) {
            return const Center(
              child: CircularProgressIndicator(),
            );
          }

          if (provider.hasError) {
            // 403エラーの場合は権限不足を明示
            final is403Error = provider.errorMessage?.contains('403') == true ||
                provider.errorMessage?.contains('FORBIDDEN') == true ||
                provider.errorMessage?.contains('Insufficient') == true;

            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    is403Error ? Icons.lock_outline : Icons.error_outline,
                    size: 64,
                    color: is403Error ? Colors.orange : Colors.red,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    is403Error ? 'アクセス権限がありません' : 'ユーザーの読み込みに失敗しました',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Text(
                      is403Error
                          ? 'この機能は管理者のみ利用可能です。\n管理者アカウントでログインしてください。'
                          : (provider.errorMessage ?? '不明なエラー'),
                      style: Theme.of(context).textTheme.bodyMedium,
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (!is403Error)
                    ElevatedButton(
                      onPressed: () {
                        provider.clearError();
                        provider.fetchUsers();
                      },
                      child: const Text('再試行'),
                    ),
                ],
              ),
            );
          }

          if (provider.users.isEmpty) {
            return const Center(
              child: Text('ユーザーが見つかりません'),
            );
          }

          return RefreshIndicator(
            onRefresh: () => provider.fetchUsers(),
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: provider.users.length,
              itemBuilder: (context, index) {
                return _buildUserCard(context, provider.users[index]);
              },
            ),
          );
        },
      ),
    );
  }

  Widget _buildUserCard(BuildContext context, UserModel user) {
    final numberFormat = NumberFormat('#,###', 'ja_JP');
    final dateFormat = DateFormat('yyyy/MM/dd HH:mm', 'ja_JP');

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // User info header
            Row(
              children: [
                // Avatar
                CircleAvatar(
                  radius: 28,
                  backgroundImage: user.avatarUrl != null
                      ? NetworkImage(user.avatarUrl!)
                      : null,
                  child: user.avatarUrl == null
                      ? Text(
                          user.displayName?.substring(0, 1).toUpperCase() ??
                              user.email.substring(0, 1).toUpperCase(),
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.bold,
                          ),
                        )
                      : null,
                ),
                const SizedBox(width: 16),
                // Name and email
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user.displayName ?? 'No Name',
                        style: AppTheme.heading3,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        user.email,
                        style: AppTheme.body2,
                      ),
                    ],
                  ),
                ),
                // Role badge
                _buildRoleBadge(user.role),
              ],
            ),
            const SizedBox(height: 16),
            const Divider(),
            const SizedBox(height: 12),

            // Statistics
            Row(
              children: [
                Expanded(
                  child: _buildStatItem(
                    '総購入数',
                    '${user.totalPurchases}回',
                    Icons.shopping_cart,
                  ),
                ),
                Expanded(
                  child: _buildStatItem(
                    '総支払額',
                    '¥${numberFormat.format(user.totalSpent)}',
                    Icons.attach_money,
                  ),
                ),
                Expanded(
                  child: _buildStatItem(
                    '当選数',
                    '${user.prizesWon}回',
                    Icons.emoji_events,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Timestamps
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.person_add,
                      size: 16,
                      color: AppTheme.textSecondaryColor,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      '登録: ${dateFormat.format(user.createdAt)}',
                      style: AppTheme.caption,
                    ),
                  ],
                ),
                if (user.lastLoginAt != null)
                  Row(
                    children: [
                      const Icon(
                        Icons.login,
                        size: 16,
                        color: AppTheme.textSecondaryColor,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '最終: ${dateFormat.format(user.lastLoginAt!)}',
                        style: AppTheme.caption,
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 16),

            // Actions
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton.icon(
                  onPressed: () => _showRoleChangeDialog(context, user),
                  icon: const Icon(Icons.edit, size: 18),
                  label: const Text('ロール変更'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRoleBadge(String role) {
    final isAdmin = role == 'admin';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: isAdmin
            ? AppTheme.primaryColor.withValues(alpha: 0.1)
            : AppTheme.successColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isAdmin ? Icons.admin_panel_settings : Icons.person,
            size: 16,
            color: isAdmin ? AppTheme.primaryColor : AppTheme.successColor,
          ),
          const SizedBox(width: 4),
          Text(
            isAdmin ? '管理者' : '一般ユーザー',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: isAdmin ? AppTheme.primaryColor : AppTheme.successColor,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatItem(String label, String value, IconData icon) {
    return Column(
      children: [
        Icon(icon, color: AppTheme.primaryColor, size: 24),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: AppTheme.textPrimaryColor,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: AppTheme.caption,
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  void _showRoleChangeDialog(BuildContext context, UserModel user) {
    final provider = context.read<UserProvider>();
    String? selectedRole = user.role;

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('ロール変更'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('ユーザー: ${user.displayName ?? user.email}'),
              const SizedBox(height: 16),
              const Text('新しいロール:'),
              const SizedBox(height: 8),
              RadioListTile<String>(
                title: const Text('一般ユーザー'),
                value: 'customer',
                groupValue: selectedRole,
                onChanged: (value) {
                  setState(() {
                    selectedRole = value;
                  });
                },
              ),
              RadioListTile<String>(
                title: const Text('管理者'),
                value: 'admin',
                groupValue: selectedRole,
                onChanged: (value) {
                  setState(() {
                    selectedRole = value;
                  });
                },
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('キャンセル'),
            ),
            ElevatedButton(
              onPressed: () async {
                if (selectedRole != null && selectedRole != user.role) {
                  try {
                    await provider.updateUserRole(user.userId, selectedRole!);
                    if (context.mounted) {
                      Navigator.of(context).pop();
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('ロールを更新しました'),
                          backgroundColor: AppTheme.successColor,
                        ),
                      );
                    }
                  } catch (e) {
                    if (context.mounted) {
                      Navigator.of(context).pop();
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('ロール更新に失敗しました: $e'),
                          backgroundColor: AppTheme.errorColor,
                        ),
                      );
                    }
                  }
                } else {
                  Navigator.of(context).pop();
                }
              },
              child: const Text('更新'),
            ),
          ],
        ),
      ),
    );
  }
}
