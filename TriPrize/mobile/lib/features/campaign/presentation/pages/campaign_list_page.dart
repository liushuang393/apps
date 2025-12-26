import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../../core/utils/logger.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../admin/presentation/pages/settings_page.dart';
import '../../../purchase/presentation/providers/purchase_provider.dart';
import '../../data/models/campaign_model.dart';
import '../providers/campaign_provider.dart';
import 'campaign_detail_page.dart';

/// Campaign list page
/// 目的: 顧客向けキャンペーン一覧を表示
/// I/O: CampaignProviderからデータを取得して表示
/// 注意点: 顧客には draft 状態を非表示、published/closed/drawn のみ表示
class CampaignListPage extends StatefulWidget {
  const CampaignListPage({super.key});

  @override
  State<CampaignListPage> createState() => _CampaignListPageState();
}

class _CampaignListPageState extends State<CampaignListPage> {
  // 顧客用のフィルター: null=すべて(draft除く), published=公開中, closed=終了, drawn=抽選済
  String? _selectedStatus;

  // 顧客向けに表示可能なステータス一覧（draftは除外）
  static const List<String> _customerVisibleStatuses = ['published', 'closed', 'drawn'];

  @override
  void initState() {
    super.initState();
    // ページ読み込み時にキャンペーン一覧を取得
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<CampaignProvider>().fetchCampaigns();
    });
  }

  /// 顧客向けにフィルタリングされたキャンペーン一覧を取得
  /// draft ステータスは常に除外
  List<CampaignModel> _getFilteredCampaigns(List<CampaignModel> campaigns) {
    // まず draft を除外
    final visibleCampaigns = campaigns.where((c) => _customerVisibleStatuses.contains(c.status)).toList();

    // さらに選択されたステータスでフィルタリング
    if (_selectedStatus == null) {
      return visibleCampaigns;
    }
    return visibleCampaigns.where((c) => c.status == _selectedStatus).toList();
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = context.watch<AuthProvider>();
    final user = authProvider.user;
    final userRole = authProvider.userRole ?? 'customer';

    return Scaffold(
      appBar: AppBar(
        title: const Text('キャンペーン一覧'),
        actions: [
          IconButton(
            icon: const Icon(Icons.filter_list),
            onPressed: () {
              _showFilterDialog(context);
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              context.read<CampaignProvider>().fetchCampaigns();
            },
          ),
          // ユーザーアバター（ポップアップメニュー付き）
          _buildUserAvatarMenu(context, user, userRole),
        ],
      ),
      body: Consumer<CampaignProvider>(
        builder: (context, provider, child) {
          if (provider.isLoading) {
            return const Center(
              child: CircularProgressIndicator(),
            );
          }

          if (provider.hasError) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.error_outline, size: 64, color: Colors.red),
                  const SizedBox(height: 16),
                  Text(
                    'キャンペーンの読み込みに失敗しました',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Text(
                      provider.errorMessage ?? '不明なエラー',
                      style: Theme.of(context).textTheme.bodyMedium,
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () {
                      provider.clearError();
                      provider.fetchCampaigns();
                    },
                    child: const Text('再試行'),
                  ),
                ],
              ),
            );
          }

          // 顧客向けにフィルタリング（draft を除外）
          final filteredCampaigns = _getFilteredCampaigns(provider.campaigns);

          if (filteredCampaigns.isEmpty) {
            return const Center(
              child: Text('利用可能なキャンペーンがありません'),
            );
          }

          return RefreshIndicator(
            onRefresh: () => provider.fetchCampaigns(),
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: filteredCampaigns.length,
              itemBuilder: (context, index) {
                return _buildCampaignCard(context, filteredCampaigns[index]);
              },
            ),
          );
        },
      ),
    );
  }

  Widget _buildCampaignCard(BuildContext context, CampaignModel campaign) {
    final numberFormat = NumberFormat('#,###', 'ja_JP');

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      child: InkWell(
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (context) => CampaignDetailPage(
                campaignId: campaign.campaignId,
              ),
            ),
          );
        },
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Campaign name
              Text(
                campaign.name,
                style: AppTheme.heading3,
              ),
              if (campaign.description != null) ...[
                const SizedBox(height: 8),
                Text(
                  campaign.description!,
                  style: AppTheme.body2,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              const SizedBox(height: 16),

              // Progress bar
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '販売済: ${campaign.positionsSold} / ${campaign.positionsTotal}',
                        style: AppTheme.body2,
                      ),
                      Text(
                        '${campaign.progressPercent.toStringAsFixed(1)}%',
                        style: AppTheme.body2.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: campaign.progressPercent / 100,
                      backgroundColor: AppTheme.borderColor,
                      minHeight: 8,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Price range and status
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  // Price range
                  Row(
                    children: [
                      const Icon(
                        Icons.payments_outlined,
                        size: 20,
                        color: AppTheme.textSecondaryColor,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        '¥${numberFormat.format(campaign.minPrice)} - ¥${numberFormat.format(campaign.maxPrice)}',
                        style: AppTheme.body1.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),

                  // Status badge
                  _buildStatusBadge(campaign.status),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusBadge(String status) {
    Color backgroundColor;
    Color textColor;
    String label;

    switch (status) {
      case 'published':
        backgroundColor = AppTheme.successColor.withValues(alpha: 0.1);
        textColor = AppTheme.successColor;
        label = '公開中';
        break;
      case 'closed':
        backgroundColor = AppTheme.errorColor.withValues(alpha: 0.1);
        textColor = AppTheme.errorColor;
        label = '終了';
        break;
      case 'drawn':
        backgroundColor = AppTheme.primaryColor.withValues(alpha: 0.1);
        textColor = AppTheme.primaryColor;
        label = '抽選済';
        break;
      default:
        backgroundColor = AppTheme.borderColor;
        textColor = AppTheme.textSecondaryColor;
        label = '下書き';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: textColor,
        ),
      ),
    );
  }

  /// ユーザーアバターメニューを構築
  /// 目的: 設定とログアウト機能を含むポップアップメニューを表示
  /// I/O: ユーザー情報とロールに基づいてメニュー項目を構築
  /// 注意点: 管理者はログアウト不可、顧客は抽選中ログアウト不可
  Widget _buildUserAvatarMenu(BuildContext context, dynamic user, String userRole) {
    return PopupMenuButton<String>(
      offset: const Offset(0, 48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(8.0),
        child: CircleAvatar(
          radius: 16,
          backgroundColor: AppTheme.primaryColor,
          child: Text(
            (user?.displayName ?? user?.email ?? '?').toString().substring(0, 1).toUpperCase(),
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontSize: 14,
            ),
          ),
        ),
      ),
      onSelected: (value) {
        switch (value) {
          case 'settings':
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (context) => const SettingsPage(),
              ),
            );
            break;
          case 'logout':
            _handleLogout(context, userRole);
            break;
        }
      },
      itemBuilder: (context) {
        final items = <PopupMenuEntry<String>>[
          // 設定メニュー項目
          const PopupMenuItem<String>(
            value: 'settings',
            child: ListTile(
              leading: Icon(Icons.settings),
              title: Text('設定'),
              contentPadding: EdgeInsets.zero,
              dense: true,
            ),
          ),
        ];

        // 管理者以外はログアウトメニューを追加
        if (userRole != 'admin') {
          items.add(const PopupMenuDivider());
          items.add(
            const PopupMenuItem<String>(
              value: 'logout',
              child: ListTile(
                leading: Icon(Icons.logout, color: AppTheme.errorColor),
                title: Text('ログアウト', style: TextStyle(color: AppTheme.errorColor)),
                contentPadding: EdgeInsets.zero,
                dense: true,
              ),
            ),
          );
        }

        return items;
      },
    );
  }

  /// ログアウト処理
  /// 目的: ログアウト前に抽選状態をチェックし、問題なければログアウト
  /// I/O: userRoleに基づいて抽選状態を確認
  /// 注意点: 
  ///   - 管理者はログアウト不可
  ///   - 顧客は抽選中（未抽選の購入がある場合）ログアウト不可
  Future<void> _handleLogout(BuildContext context, String userRole) async {
    // 管理者はログアウト不可（UIレベルで既にフィルタされているが、念のため）
    if (userRole == 'admin') {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('管理者アカウントはログアウトできません'),
          backgroundColor: AppTheme.errorColor,
        ),
      );
      return;
    }

    // 抽選状態チェック
    final canLogout = await _checkCanLogout(context);
    if (!canLogout) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('抽選が完了していない購入があるため、ログアウトできません'),
          backgroundColor: AppTheme.errorColor,
        ),
      );
      return;
    }

    // ログアウト確認ダイアログを表示
    if (!context.mounted) return;
    _showLogoutDialog(context);
  }

  /// ログアウト可能かどうかをチェック
  /// 目的: ユーザーの購入履歴を確認し、未抽選のキャンペーンがあるかチェック
  /// I/O: true = ログアウト可能, false = 抽選中のためログアウト不可
  /// 注意点: 
  ///   - 購入がない場合はログアウト可能
  ///   - 購入があっても、全てのキャンペーンが 'drawn' 状態ならログアウト可能
  Future<bool> _checkCanLogout(BuildContext context) async {
    try {
      final purchaseProvider = context.read<PurchaseProvider>();
      final campaignProvider = context.read<CampaignProvider>();

      // 購入履歴を取得
      await purchaseProvider.fetchPurchaseHistory();
      final purchases = purchaseProvider.purchases;

      // 購入がない場合はログアウト可能
      if (purchases.isEmpty) {
        AppLogger.info('No purchases found, logout allowed');
        return true;
      }

      // 完了した購入（支払い完了）のみをチェック
      final completedPurchases = purchases.where((p) => p.isPaid).toList();
      if (completedPurchases.isEmpty) {
        AppLogger.info('No completed purchases found, logout allowed');
        return true;
      }

      // キャンペーン一覧を取得（既にロード済みの場合はそのまま使用）
      if (campaignProvider.campaigns.isEmpty) {
        await campaignProvider.fetchCampaigns();
      }
      final campaigns = campaignProvider.campaigns;

      // 購入したキャンペーンIDのリスト
      final purchasedCampaignIds = completedPurchases.map((p) => p.campaignId).toSet();

      // 購入したキャンペーンのうち、抽選が完了していないものがあるかチェック
      for (final campaignId in purchasedCampaignIds) {
        final campaign = campaigns.where((c) => c.campaignId == campaignId).firstOrNull;
        if (campaign != null && campaign.status != 'drawn') {
          // 抽選が完了していないキャンペーンがある
          AppLogger.info('Campaign $campaignId is not drawn (status: ${campaign.status}), logout blocked');
          return false;
        }
      }

      AppLogger.info('All purchased campaigns are drawn, logout allowed');
      return true;
    } catch (e) {
      AppLogger.error('Error checking logout eligibility', e);
      // エラー時は安全のためログアウトを許可しない
      return false;
    }
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

  /// Show filter dialog
  /// 目的: キャンペーンのフィルターダイアログを表示
  /// I/O: ステータスでフィルターを選択
  void _showFilterDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('フィルター'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            RadioListTile<String?>(
              title: const Text('すべて'),
              value: null,
              groupValue: _selectedStatus,
              onChanged: (value) {
                setState(() {
                  _selectedStatus = value;
                });
                Navigator.of(context).pop();
              },
            ),
            RadioListTile<String?>(
              title: const Text('公開中'),
              value: 'published',
              groupValue: _selectedStatus,
              onChanged: (value) {
                setState(() {
                  _selectedStatus = value;
                });
                Navigator.of(context).pop();
              },
            ),
            RadioListTile<String?>(
              title: const Text('終了'),
              value: 'closed',
              groupValue: _selectedStatus,
              onChanged: (value) {
                setState(() {
                  _selectedStatus = value;
                });
                Navigator.of(context).pop();
              },
            ),
            RadioListTile<String?>(
              title: const Text('抽選済'),
              value: 'drawn',
              groupValue: _selectedStatus,
              onChanged: (value) {
                setState(() {
                  _selectedStatus = value;
                });
                Navigator.of(context).pop();
              },
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              setState(() {
                _selectedStatus = null;
              });
              Navigator.of(context).pop();
            },
            child: const Text('リセット'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('閉じる'),
          ),
        ],
      ),
    );
  }
}
