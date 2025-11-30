import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../campaign/data/models/campaign_model.dart';
import '../../../campaign/presentation/providers/campaign_provider.dart';
import '../../../campaign/presentation/pages/campaign_detail_page.dart';

/// Admin campaign list page
/// Shows all campaigns including drafts with management actions
class AdminCampaignListPage extends StatefulWidget {
  const AdminCampaignListPage({super.key});

  @override
  State<AdminCampaignListPage> createState() => _AdminCampaignListPageState();
}

class _AdminCampaignListPageState extends State<AdminCampaignListPage> {
  String? _selectedStatus;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<CampaignProvider>().fetchCampaigns(status: null);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('キャンペーン管理'),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.filter_list),
            onSelected: (status) {
              setState(() {
                _selectedStatus = status == 'all' ? null : status;
              });
              context
                  .read<CampaignProvider>()
                  .fetchCampaigns(status: _selectedStatus);
            },
            itemBuilder: (context) => [
              const PopupMenuItem(value: 'all', child: Text('すべて')),
              const PopupMenuItem(value: 'draft', child: Text('下書き')),
              const PopupMenuItem(value: 'published', child: Text('公開中')),
              const PopupMenuItem(value: 'closed', child: Text('終了')),
              const PopupMenuItem(value: 'drawn', child: Text('抽選済')),
            ],
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              context
                  .read<CampaignProvider>()
                  .fetchCampaigns(status: _selectedStatus);
            },
          ),
        ],
      ),
      body: Consumer<CampaignProvider>(
        builder: (context, provider, child) {
          if (provider.isLoading) {
            return const Center(child: CircularProgressIndicator());
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
                      provider.fetchCampaigns(status: _selectedStatus);
                    },
                    child: const Text('再試行'),
                  ),
                ],
              ),
            );
          }

          if (provider.campaigns.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.campaign,
                      size: 64, color: AppTheme.textSecondaryColor),
                  const SizedBox(height: 16),
                  Text(
                    'キャンペーンがありません',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => provider.fetchCampaigns(status: _selectedStatus),
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: provider.campaigns.length,
              itemBuilder: (context, index) {
                return _buildCampaignCard(context, provider.campaigns[index]);
              },
            ),
          );
        },
      ),
    );
  }

  Widget _buildCampaignCard(BuildContext context, CampaignModel campaign) {
    final numberFormat = NumberFormat('#,###', 'ja_JP');
    final dateFormat = DateFormat('yyyy/MM/dd', 'ja_JP');

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
              // Header with name and status
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      campaign.name,
                      style: AppTheme.heading3,
                    ),
                  ),
                  _buildStatusBadge(campaign.status),
                ],
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

              // Stats
              Row(
                children: [
                  Expanded(
                    child: _buildStatItem(
                      '進捗率',
                      '${campaign.progressPercent.toStringAsFixed(1)}%',
                      Icons.trending_up,
                    ),
                  ),
                  Expanded(
                    child: _buildStatItem(
                      '販売済',
                      '${campaign.positionsSold}/${campaign.positionsTotal}',
                      Icons.shopping_cart,
                    ),
                  ),
                  Expanded(
                    child: _buildStatItem(
                      '価格帯',
                      '¥${numberFormat.format(campaign.minPrice)}〜',
                      Icons.payments,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Dates and actions
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.calendar_today,
                        size: 14,
                        color: AppTheme.textSecondaryColor,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '作成: ${dateFormat.format(campaign.createdAt)}',
                        style: AppTheme.caption,
                      ),
                    ],
                  ),
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert, size: 20),
                    onSelected: (action) =>
                        _handleAction(context, campaign, action),
                    itemBuilder: (context) => [
                      const PopupMenuItem(
                        value: 'view',
                        child: Row(
                          children: [
                            Icon(Icons.visibility, size: 20),
                            SizedBox(width: 8),
                            Text('詳細を見る'),
                          ],
                        ),
                      ),
                      if (campaign.status == 'draft')
                        const PopupMenuItem(
                          value: 'publish',
                          child: Row(
                            children: [
                              Icon(Icons.publish, size: 20),
                              SizedBox(width: 8),
                              Text('公開する'),
                            ],
                          ),
                        ),
                      if (campaign.status == 'published')
                        const PopupMenuItem(
                          value: 'close',
                          child: Row(
                            children: [
                              Icon(Icons.cancel, size: 20),
                              SizedBox(width: 8),
                              Text('終了する'),
                            ],
                          ),
                        ),
                      const PopupMenuItem(
                        value: 'delete',
                        child: Row(
                          children: [
                            Icon(Icons.delete, size: 20, color: AppTheme.errorColor),
                            SizedBox(width: 8),
                            Text('削除', style: TextStyle(color: AppTheme.errorColor)),
                          ],
                        ),
                      ),
                    ],
                  ),
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

  Widget _buildStatItem(String label, String value, IconData icon) {
    return Column(
      children: [
        Icon(icon, color: AppTheme.primaryColor, size: 20),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.bold,
            color: AppTheme.textPrimaryColor,
          ),
          textAlign: TextAlign.center,
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

  void _handleAction(
      BuildContext context, CampaignModel campaign, String action) {
    switch (action) {
      case 'view':
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (context) => CampaignDetailPage(
              campaignId: campaign.campaignId,
            ),
          ),
        );
        break;
      case 'publish':
        _showPublishDialog(context, campaign);
        break;
      case 'close':
        _showCloseDialog(context, campaign);
        break;
      case 'delete':
        _showDeleteDialog(context, campaign);
        break;
    }
  }

  void _showPublishDialog(BuildContext context, CampaignModel campaign) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('キャンペーンを公開'),
        content: Text('「${campaign.name}」を公開してもよろしいですか？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('キャンセル'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.of(context).pop();
              try {
                final repo = context.read<CampaignProvider>().repository;
                await repo.publishCampaign(campaign.campaignId);
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('キャンペーンを公開しました'),
                      backgroundColor: AppTheme.successColor,
                    ),
                  );
                  await context.read<CampaignProvider>().fetchCampaigns(status: _selectedStatus);
                }
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('公開に失敗しました: $e'),
                      backgroundColor: AppTheme.errorColor,
                    ),
                  );
                }
              }
            },
            child: const Text('公開'),
          ),
        ],
      ),
    );
  }

  void _showCloseDialog(BuildContext context, CampaignModel campaign) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('キャンペーンを終了'),
        content: Text('「${campaign.name}」を終了してもよろしいですか？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('キャンセル'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.of(context).pop();
              try {
                final repo = context.read<CampaignProvider>().repository;
                await repo.closeCampaign(campaign.campaignId);
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('キャンペーンを終了しました'),
                      backgroundColor: AppTheme.successColor,
                    ),
                  );
                  await context.read<CampaignProvider>().fetchCampaigns(status: _selectedStatus);
                }
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('終了に失敗しました: $e'),
                      backgroundColor: AppTheme.errorColor,
                    ),
                  );
                }
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.errorColor,
            ),
            child: const Text('終了'),
          ),
        ],
      ),
    );
  }

  void _showDeleteDialog(BuildContext context, CampaignModel campaign) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('キャンペーンを削除'),
        content: Text('「${campaign.name}」を削除してもよろしいですか？この操作は取り消せません。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('キャンセル'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.of(context).pop();
              try {
                final repo = context.read<CampaignProvider>().repository;
                await repo.deleteCampaign(campaign.campaignId);
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('キャンペーンを削除しました'),
                      backgroundColor: AppTheme.successColor,
                    ),
                  );
                  await context.read<CampaignProvider>().fetchCampaigns(status: _selectedStatus);
                }
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('削除に失敗しました: $e'),
                      backgroundColor: AppTheme.errorColor,
                    ),
                  );
                }
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.errorColor,
            ),
            child: const Text('削除'),
          ),
        ],
      ),
    );
  }
}
