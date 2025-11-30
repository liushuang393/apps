import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../campaign/data/models/campaign_model.dart';
import '../../../campaign/presentation/pages/campaign_list_page.dart';
import '../../data/models/purchase_model.dart';
import 'purchase_history_page.dart';

/// Purchase result page
/// 目的: 显示购买完成结果和position信息
/// I/O: 接收purchase和campaign信息，展示给用户
/// 注意点: 清晰显示position位置、支付状态、下一步操作
class PurchaseResultPage extends StatelessWidget {
  final PurchaseModel purchase;
  final CampaignDetailModel campaign;

  const PurchaseResultPage({
    required this.purchase, required this.campaign, super.key,
  });

  @override
  Widget build(BuildContext context) {
    final numberFormat = NumberFormat('#,###', 'ja_JP');

    return Scaffold(
      appBar: AppBar(
        title: const Text('購入完了'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () {
            Navigator.of(context).pushAndRemoveUntil(
              MaterialPageRoute(
                builder: (context) => const CampaignListPage(),
              ),
              (route) => false,
            );
          },
        ),
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Success icon
            _buildSuccessHeader(),

            // Purchase info card
            _buildPurchaseInfo(numberFormat),

            // Position info
            _buildPositionInfo(),

            // Payment status
            _buildPaymentStatus(),

            // Next steps
            _buildNextSteps(),

            // Action buttons
            _buildActionButtons(context),

            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  Widget _buildSuccessHeader() {
    return Container(
      padding: const EdgeInsets.all(48),
      color: AppTheme.successColor.withValues(alpha: 0.1),
      child: const Column(
        children: [
          Icon(
            Icons.check_circle,
            size: 80,
            color: AppTheme.successColor,
          ),
          SizedBox(height: 16),
          Text(
            '購入が完了しました！',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
            textAlign: TextAlign.center,
          ),
          SizedBox(height: 8),
          Text(
            'ポジションが割り当てられました',
            style: TextStyle(
              fontSize: 16,
              color: AppTheme.textSecondaryColor,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildPurchaseInfo(NumberFormat numberFormat) {
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        border: Border.all(color: AppTheme.borderColor),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'キャンペーン情報',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          _buildInfoRow('キャンペーン', campaign.name),
          const SizedBox(height: 12),
          _buildInfoRow(
            '購入層',
            'Layer ${purchase.layerNumber}',
          ),
          const SizedBox(height: 12),
          _buildInfoRow(
            '支払い金額',
            '¥${numberFormat.format(purchase.price)}',
          ),
        ],
      ),
    );
  }

  Widget _buildPositionInfo() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.primaryColor.withValues(alpha: 0.05),
        border: Border.all(
          color: AppTheme.primaryColor.withValues(alpha: 0.3),
        ),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(
                Icons.place,
                color: AppTheme.primaryColor,
                size: 20,
              ),
              SizedBox(width: 8),
              Text(
                'あなたのポジション',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.primaryColor,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildPositionDetail('層', '${purchase.layerNumber}'),
              _buildPositionDetail('行', '${purchase.rowNumber}'),
              _buildPositionDetail('列', '${purchase.colNumber}'),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.info_outline,
                  size: 18,
                  color: AppTheme.textSecondaryColor,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'このポジションで抽選に参加します',
                    style: TextStyle(
                      fontSize: 13,
                      color: Colors.grey[700],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPositionDetail(String label, String value) {
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
            color: Colors.white,
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

  Widget _buildPaymentStatus() {
    final isPaid = purchase.isPaid;
    final isPending = purchase.isPending;

    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: isPaid
            ? AppTheme.successColor.withValues(alpha: 0.1)
            : AppTheme.warningColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(
            isPaid ? Icons.check_circle : Icons.pending,
            color: isPaid ? AppTheme.successColor : AppTheme.warningColor,
            size: 24,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isPaid ? '決済完了' : isPending ? '決済処理中' : '決済待ち',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: isPaid ? AppTheme.successColor : AppTheme.warningColor,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  isPaid
                      ? 'お支払いが完了しました'
                      : isPending
                          ? '決済処理を行っています'
                          : 'コンビニでお支払いください',
                  style: const TextStyle(fontSize: 14),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNextSteps() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '今後の流れ',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          _buildStep(
            1,
            '全ポジションの販売完了を待つ',
            '現在 ${campaign.positionsSold} / ${campaign.positionsTotal} が販売済み',
          ),
          _buildStep(
            2,
            '自動抽選の実施',
            '全ポジション販売完了後、システムが自動的に抽選を行います',
          ),
          _buildStep(
            3,
            '抽選結果の通知',
            'アプリ内通知で結果をお知らせします',
          ),
        ],
      ),
    );
  }

  Widget _buildStep(int step, String title, String description) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: AppTheme.primaryColor,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Center(
              child: Text(
                '$step',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  description,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppTheme.textSecondaryColor,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButtons(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          ElevatedButton(
            onPressed: () {
              Navigator.of(context).pushAndRemoveUntil(
                MaterialPageRoute(
                  builder: (context) => const CampaignListPage(),
                ),
                (route) => false,
              );
            },
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.all(16),
            ),
            child: const Text(
              'キャンペーン一覧に戻る',
              style: TextStyle(fontSize: 16),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () {
              Navigator.of(context).pushAndRemoveUntil(
                MaterialPageRoute(
                  builder: (context) => const PurchaseHistoryPage(),
                ),
                (route) => false,
              );
            },
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.all(16),
            ),
            child: const Text(
              '購入履歴を見る',
              style: TextStyle(fontSize: 16),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 14,
            color: AppTheme.textSecondaryColor,
          ),
        ),
        Text(
          value,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
