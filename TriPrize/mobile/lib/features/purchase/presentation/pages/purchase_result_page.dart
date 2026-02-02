import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../../core/navigation/navigation_service.dart';
import '../../../campaign/data/models/campaign_model.dart';
import '../../data/models/purchase_model.dart';
import 'purchase_history_page.dart';

/// 購入結果ページ
/// 目的: 購入完了結果とポジション情報を表示
/// I/O: purchaseとcampaign情報を受け取り、ユーザーに表示
/// 注意点: ポジション位置、支払い状態、次の操作を明確に表示
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
            // ユーザーロールに応じたホーム画面に遷移
            NavigationService.navigateToHome(context);
          },
        ),
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // 成功アイコン
            _buildSuccessHeader(),

            // 購入情報カード
            _buildPurchaseInfo(numberFormat),

            // チケット情報
            _buildPositionInfo(),

            // 支払い状態
            _buildPaymentStatus(),

            // 次のステップ
            _buildNextSteps(),

            // アクションボタン
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
            'チケット数',
            '${purchase.quantity}枚',
          ),
          const SizedBox(height: 12),
          _buildInfoRow(
            '支払い金額',
            '¥${numberFormat.format(purchase.totalAmount)}',
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
                Icons.confirmation_number,
                color: AppTheme.primaryColor,
                size: 20,
              ),
              SizedBox(width: 8),
              Text(
                '抽選チケット',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.primaryColor,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Center(
            child: Text(
              '${purchase.quantity}枚購入',
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: AppTheme.primaryColor,
              ),
            ),
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
                    '抽選結果は抽選実施後に確認できます',
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
    // ボタンのラベルはユーザーロールに応じて変更
    final homeLabel = NavigationService.isAdmin ? 'ダッシュボードに戻る' : 'キャンペーン一覧に戻る';

    return Container(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          ElevatedButton(
            onPressed: () {
              // ユーザーロールに応じたホーム画面に遷移
              NavigationService.navigateToHome(context);
            },
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.all(16),
            ),
            child: Text(
              homeLabel,
              style: const TextStyle(fontSize: 16),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (context) => const PurchaseHistoryPage(),
                ),
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
