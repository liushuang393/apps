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
class AdminDashboardPage extends StatefulWidget {
  const AdminDashboardPage({super.key});

  @override
  State<AdminDashboardPage> createState() => _AdminDashboardPageState();
}

class _AdminDashboardPageState extends State<AdminDashboardPage> {
  late CampaignProvider _campaignProvider;

  @override
  void initState() {
    super.initState();
    _campaignProvider = inject<CampaignProvider>();
    // 統計データ用にキャンペーン一覧を取得
    _refreshCampaigns();
    // Providerの変更を監視してUIを更新
    _campaignProvider.addListener(_onCampaignDataChanged);
  }

  @override
  void dispose() {
    _campaignProvider.removeListener(_onCampaignDataChanged);
    super.dispose();
  }

  /// Provider のデータが変更されたときに UI を更新
  void _onCampaignDataChanged() {
    if (mounted) setState(() {});
  }

  /// キャンペーンデータを再取得
  /// 目的: 統計情報を最新に更新
  Future<void> _refreshCampaigns() async {
    await _campaignProvider.fetchCampaigns();
  }

  /// 画面遷移後に統計を更新
  /// 目的: 作成・編集・削除後にダッシュボードの統計を最新化
  Future<void> _navigateAndRefresh(Widget page) async {
    final result = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (context) => ChangeNotifierProvider(
          create: (_) => inject<CampaignProvider>(),
          child: page,
        ),
      ),
    );
    // 作成・更新・削除などが成功した場合（true が返される）は統計を更新
    if (result == true) {
      await _refreshCampaigns();
    }
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = context.watch<AuthProvider>();
    final user = authProvider.user;
    final userRole = authProvider.userRole ?? 'customer';

    // キャンペーン統計を計算
    final campaigns = _campaignProvider.campaigns;
    final totalCount = campaigns.length;
    final draftCount = campaigns.where((c) => c.status == 'draft').length;
    final publishedCount = campaigns.where((c) => c.status == 'published').length;
    final closedCount = campaigns.where((c) => c.status == 'closed').length;
    final drawnCount = campaigns.where((c) => c.status == 'drawn').length;
    
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
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Welcome message（コンパクト化）
            Card(
              color: AppTheme.primaryColor,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Row(
                  children: [
                    UserAvatar(
                      displayName: user?.displayName,
                      email: user?.email ?? '',
                      avatarUrl: user?.photoURL,
                      role: userRole,
                      radius: 24,
                      showRoleBadge: true,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'ようこそ、${user?.displayName ?? "管理者"}さん',
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                            ),
                          ),
                          Text(
                            userRole == 'admin'
                                ? 'キャンペーンを管理しましょう'
                                : 'キャンペーンを閲覧しましょう',
                            style: const TextStyle(
                              fontSize: 12,
                              color: Colors.white70,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Statistics Cards（コンパクト化・横5列）
            Row(
              children: [
                _buildCompactStatCard('$totalCount', '総数', Icons.campaign, AppTheme.primaryColor),
                _buildCompactStatCard('$draftCount', '下書', Icons.edit_note, Colors.grey),
                _buildCompactStatCard('$publishedCount', '公開', Icons.play_circle, AppTheme.successColor),
                _buildCompactStatCard('$closedCount', '終了', Icons.stop_circle, AppTheme.warningColor),
                _buildCompactStatCard('$drawnCount', '抽選', Icons.emoji_events, Colors.amber),
              ],
            ),
            const SizedBox(height: 20),

            // Action Buttons
            ElevatedButton.icon(
              onPressed: () => _navigateAndRefresh(const CreateCampaignPage()),
              icon: const Icon(Icons.add, size: 20),
              label: const Text('新規キャンペーン作成'),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12),
                textStyle: const TextStyle(fontSize: 14),
              ),
            ),
            const SizedBox(height: 8),
            // 編集中（下書き）一覧へのショートカット
            OutlinedButton.icon(
              onPressed: () => _navigateAndRefresh(
                const AdminCampaignListPage(initialStatus: 'draft'),
              ),
              icon: const Icon(Icons.edit_note, size: 20),
              label: const Text('編集中（下書き）'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12),
                textStyle: const TextStyle(fontSize: 14),
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => _navigateAndRefresh(const AdminCampaignListPage()),
              icon: const Icon(Icons.list, size: 20),
              label: const Text('キャンペーン一覧'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12),
                textStyle: const TextStyle(fontSize: 14),
              ),
            ),
            const SizedBox(height: 8),
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
              icon: const Icon(Icons.people, size: 20),
              label: const Text('ユーザー管理'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12),
                textStyle: const TextStyle(fontSize: 14),
              ),
            ),
            const SizedBox(height: 32), // 增加底部边距确保可滚动
          ],
        ),
      ),
    );
  }

  /// コンパクト統計カード（横5列表示用）
  Widget _buildCompactStatCard(String value, String label, IconData icon, Color color) {
    return Expanded(
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 2),
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.grey.shade200),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 18),
            const SizedBox(height: 4),
            Text(
              value,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
            Text(
              label,
              style: const TextStyle(
                fontSize: 10,
                color: AppTheme.textSecondaryColor,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
