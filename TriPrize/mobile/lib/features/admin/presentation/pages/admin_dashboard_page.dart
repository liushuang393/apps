import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/widgets/user_avatar.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../campaign/presentation/providers/campaign_provider.dart';
import '../providers/user_provider.dart';
import 'user_management_page.dart';
import 'create_campaign_page.dart';
import 'admin_campaign_list_page.dart';
import 'settings_page.dart';

/// 管理者ダッシュボード
/// 目的: 管理者がキャンペーンを作成・管理する画面
class AdminDashboardPage extends StatelessWidget {
  const AdminDashboardPage({super.key});

  @override
  Widget build(BuildContext context) {
    final authProvider = context.watch<AuthProvider>();
    final user = authProvider.user;
    final userRole = authProvider.userRole ?? 'customer';
    
    return Scaffold(
      appBar: AppBar(
        title: const Text('管理者ダッシュボード'),
        actions: [
          // ユーザーアバター
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8.0),
            child: UserAvatar(
              displayName: user?.displayName,
              email: user?.email ?? '',
              avatarUrl: user?.photoURL,
              role: userRole,
              radius: 20,
              showRoleBadge: true,
              onTap: () {
                // ユーザープロフィールページに遷移（必要に応じて実装）
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('ユーザー: ${user?.displayName ?? user?.email ?? "Unknown"}'),
                  ),
                );
              },
            ),
          ),
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (context) => const SettingsPage(),
                ),
              );
            },
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Welcome message
            Card(
              color: AppTheme.primaryColor,
              child: Padding(
                padding: const EdgeInsets.all(20.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        // ユーザーアバター（大きめ）
                        UserAvatar(
                          displayName: user?.displayName,
                          email: user?.email ?? '',
                          avatarUrl: user?.photoURL,
                          role: userRole,
                          radius: 32,
                          showRoleBadge: true,
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'ようこそ、${user?.displayName ?? "管理者"}さん',
                                style: const TextStyle(
                                  fontSize: 20,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.white,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                userRole == 'admin' 
                                    ? 'キャンペーンを管理しましょう'
                                    : 'キャンペーンを閲覧しましょう',
                                style: const TextStyle(
                                  fontSize: 14,
                                  color: Colors.white70,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Statistics Cards
            Row(
              children: [
                Expanded(
                  child: _buildStatCard(
                    '総キャンペーン数',
                    '12',
                    Icons.campaign,
                    AppTheme.primaryColor,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildStatCard(
                    '進行中',
                    '5',
                    Icons.play_circle,
                    AppTheme.successColor,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _buildStatCard(
                    '完了',
                    '7',
                    Icons.check_circle,
                    AppTheme.warningColor,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildStatCard(
                    '総売上',
                    '¥1.2M',
                    Icons.attach_money,
                    AppTheme.errorColor,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 32),

            // Action Buttons
            ElevatedButton.icon(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) => ChangeNotifierProvider(
                      create: (_) => inject<CampaignProvider>(),
                      child: const CreateCampaignPage(),
                    ),
                  ),
                );
              },
              icon: const Icon(Icons.add),
              label: const Text('新規キャンペーン作成'),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.all(16),
                textStyle: const TextStyle(fontSize: 16),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) => ChangeNotifierProvider(
                      create: (_) => inject<CampaignProvider>(),
                      child: const AdminCampaignListPage(),
                    ),
                  ),
                );
              },
              icon: const Icon(Icons.list),
              label: const Text('キャンペーン一覧'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.all(16),
                textStyle: const TextStyle(fontSize: 16),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) => ChangeNotifierProvider(
                      create: (_) => inject<UserProvider>(),
                      child: const UserManagementPage(),
                    ),
                  ),
                );
              },
              icon: const Icon(Icons.people),
              label: const Text('ユーザー管理'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.all(16),
                textStyle: const TextStyle(fontSize: 16),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatCard(String title, String value, IconData icon, Color color) {
    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color, size: 28),
            const SizedBox(height: 12),
            Text(
              value,
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              title,
              style: const TextStyle(
                fontSize: 12,
                color: AppTheme.textSecondaryColor,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
