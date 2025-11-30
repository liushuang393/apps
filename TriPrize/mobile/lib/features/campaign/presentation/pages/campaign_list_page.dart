import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../data/models/campaign_model.dart';
import '../providers/campaign_provider.dart';
import 'campaign_detail_page.dart';

/// Campaign list page
/// 目的: 显示所有可用的campaign列表
/// I/O: 从CampaignProvider获取数据并显示
/// 注意点: 使用Provider进行状态管理,支持下拉刷新
class CampaignListPage extends StatefulWidget {
  const CampaignListPage({super.key});

  @override
  State<CampaignListPage> createState() => _CampaignListPageState();
}

class _CampaignListPageState extends State<CampaignListPage> {
  String? _selectedStatus;

  @override
  void initState() {
    super.initState();
    // Fetch campaigns when page loads
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<CampaignProvider>().fetchCampaigns();
    });
  }

  @override
  Widget build(BuildContext context) {
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

          if (provider.campaigns.isEmpty) {
            return const Center(
              child: Text('利用可能なキャンペーンがありません'),
            );
          }

          // Filter campaigns by status if selected
          final filteredCampaigns = _selectedStatus == null
              ? provider.campaigns
              : provider.campaigns
                  .where((c) => c.status == _selectedStatus)
                  .toList();

          return RefreshIndicator(
            onRefresh: () => provider.fetchCampaigns(),
            child: filteredCampaigns.isEmpty
                ? const Center(
                    child: Text('該当するキャンペーンがありません'),
                  )
                : ListView.builder(
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
