import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../providers/purchase_provider.dart';
import '../../data/models/purchase_model.dart';

/// Purchase history page
/// 目的: 購入履歴を表示する
/// I/O: PurchaseProviderから履歴データを取得
/// 注意点: 支払いステータス、ポジション情報を見やすく表示
class PurchaseHistoryPage extends StatefulWidget {
  const PurchaseHistoryPage({super.key});

  @override
  State<PurchaseHistoryPage> createState() => _PurchaseHistoryPageState();
}

class _PurchaseHistoryPageState extends State<PurchaseHistoryPage> {
  @override
  void initState() {
    super.initState();
    // Fetch purchase history when page loads
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<PurchaseProvider>().fetchPurchaseHistory();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('購入履歴'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              context.read<PurchaseProvider>().fetchPurchaseHistory();
            },
          ),
        ],
      ),
      body: Consumer<PurchaseProvider>(
        builder: (context, provider, child) {
          if (provider.isLoading && provider.purchases.isEmpty) {
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
                    '購入履歴の読み込みに失敗しました',
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
                      provider.fetchPurchaseHistory();
                    },
                    child: const Text('再試行'),
                  ),
                ],
              ),
            );
          }

          if (provider.purchases.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.shopping_bag_outlined,
                    size: 80,
                    color: Colors.grey[400],
                  ),
                  const SizedBox(height: 16),
                  Text(
                    '購入履歴がありません',
                    style: TextStyle(
                      fontSize: 18,
                      color: Colors.grey[600],
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'キャンペーンを購入すると、ここに表示されます',
                    style: TextStyle(
                      fontSize: 14,
                      color: Colors.grey[500],
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => provider.fetchPurchaseHistory(),
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: provider.purchases.length,
              itemBuilder: (context, index) {
                final purchase = provider.purchases[index];
                return _buildPurchaseCard(purchase);
              },
            ),
          );
        },
      ),
    );
  }

  Widget _buildPurchaseCard(PurchaseModel purchase) {
    final numberFormat = NumberFormat('#,###', 'ja_JP');
    final dateFormat = DateFormat('yyyy年MM月dd日 HH:mm', 'ja_JP');

    // Payment status color and text
    Color statusColor;
    String statusText;
    IconData statusIcon;

    if (purchase.isPaid) {
      statusColor = AppTheme.successColor;
      statusText = '決済完了';
      statusIcon = Icons.check_circle;
    } else if (purchase.isPending) {
      statusColor = AppTheme.warningColor;
      statusText = '決済処理中';
      statusIcon = Icons.pending;
    } else if (purchase.isFailed) {
      statusColor = AppTheme.errorColor;
      statusText = '決済失敗';
      statusIcon = Icons.error;
    } else {
      statusColor = Colors.grey;
      statusText = '決済待ち';
      statusIcon = Icons.schedule;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      child: InkWell(
        onTap: () => _showPurchaseDetail(purchase),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header: Campaign name and status
              Row(
                children: [
                  Expanded(
                    child: Text(
                      purchase.campaignName ?? purchase.campaignId,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          statusIcon,
                          size: 14,
                          color: statusColor,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          statusText,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: statusColor,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Position info
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.primaryColor.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.place,
                      color: AppTheme.primaryColor,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Layer ${purchase.layerNumber}',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.primaryColor,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Text(
                      '行 ${purchase.rowNumber}',
                      style: const TextStyle(fontSize: 13),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      '列 ${purchase.colNumber}',
                      style: const TextStyle(fontSize: 13),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),

              // Price and date
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '¥${numberFormat.format(purchase.price)}',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.primaryColor,
                    ),
                  ),
                  Text(
                    dateFormat.format(purchase.createdAt),
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppTheme.textSecondaryColor,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showPurchaseDetail(PurchaseModel purchase) {
    final numberFormat = NumberFormat('#,###', 'ja_JP');
    final dateFormat = DateFormat('yyyy年MM月dd日 HH:mm:ss', 'ja_JP');

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.7,
        minChildSize: 0.5,
        maxChildSize: 0.9,
        expand: false,
        builder: (context, scrollController) => SingleChildScrollView(
          controller: scrollController,
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Handle bar
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 24),

              // Title
              const Text(
                '購入詳細',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 24),

              // Purchase info
              _buildDetailRow('購入ID', purchase.purchaseId),
              const SizedBox(height: 16),
              _buildDetailRow('キャンペーンID', purchase.campaignId),
              const SizedBox(height: 16),
              _buildDetailRow('ポジションID', purchase.positionId),
              const SizedBox(height: 16),

              const Divider(height: 32),

              // Position details
              const Text(
                'ポジション情報',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _buildPositionBox('層', '${purchase.layerNumber}'),
                  _buildPositionBox('行', '${purchase.rowNumber}'),
                  _buildPositionBox('列', '${purchase.colNumber}'),
                ],
              ),
              const SizedBox(height: 24),

              const Divider(height: 32),

              // Payment info
              const Text(
                '決済情報',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 16),
              _buildDetailRow('金額', '¥${numberFormat.format(purchase.price)}'),
              const SizedBox(height: 16),
              _buildDetailRow('決済方法', _getPaymentMethodText(purchase.paymentMethod)),
              const SizedBox(height: 16),
              _buildDetailRow('決済ステータス', _getPaymentStatusText(purchase.paymentStatus)),
              const SizedBox(height: 24),

              const Divider(height: 32),

              // Timestamps
              const Text(
                '日時情報',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 16),
              _buildDetailRow('購入日時', dateFormat.format(purchase.createdAt)),
              const SizedBox(height: 16),
              _buildDetailRow('支払日時', purchase.paidAt != null ? dateFormat.format(purchase.paidAt!) : '未払い'),
              const SizedBox(height: 32),

              // Close button
              ElevatedButton(
                onPressed: () => Navigator.of(context).pop(),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.all(16),
                  minimumSize: const Size(double.infinity, 0),
                ),
                child: const Text('閉じる'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 120,
          child: Text(
            label,
            style: const TextStyle(
              fontSize: 14,
              color: AppTheme.textSecondaryColor,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPositionBox(String label, String value) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 14,
            color: AppTheme.textSecondaryColor,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            color: AppTheme.primaryColor.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppTheme.primaryColor, width: 2),
          ),
          child: Center(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: AppTheme.primaryColor,
              ),
            ),
          ),
        ),
      ],
    );
  }

  String _getPaymentMethodText(String method) {
    switch (method) {
      case 'card':
        return 'クレジットカード';
      case 'konbini':
        return 'コンビニ決済';
      default:
        return method;
    }
  }

  String _getPaymentStatusText(String status) {
    switch (status) {
      case 'succeeded':
      case 'paid':
        return '決済完了';
      case 'pending':
        return '決済待ち';
      case 'processing':
        return '決済処理中';
      case 'failed':
        return '決済失敗';
      case 'canceled':
        return 'キャンセル';
      case 'refunded':
        return '返金済み';
      default:
        return status;
    }
  }
}
