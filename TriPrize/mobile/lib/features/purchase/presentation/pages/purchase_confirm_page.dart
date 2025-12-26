import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'dart:async';
import '../../../../core/constants/app_theme.dart';
import '../../../campaign/data/models/campaign_model.dart';
import 'payment_processing_page.dart';

/// Purchase confirmation page
/// 目的: 抽選チケット購入確認
/// I/O: キャンペーン情報を受け取り、統一価格で購入処理
/// 注意点: 層選択は不要（抽選で自動割り当て）
class PurchaseConfirmPage extends StatefulWidget {
  final CampaignDetailModel campaign;
  final LayerModel? selectedLayer; // 抽選システムでは不要（後方互換性のため残す）

  const PurchaseConfirmPage({
    required this.campaign,
    this.selectedLayer,
    super.key,
  });

  @override
  State<PurchaseConfirmPage> createState() => _PurchaseConfirmPageState();
}

class _PurchaseConfirmPageState extends State<PurchaseConfirmPage> {
  String _paymentMethod = 'card'; // card or konbini
  final bool _isProcessing = false;

  @override
  Widget build(BuildContext context) {
    final numberFormat = NumberFormat('#,###', 'ja_JP');

    return Scaffold(
      appBar: AppBar(
        title: const Text('購入確認'),
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Campaign info card
            _buildCampaignInfo(),

            // Selected layer info
            _buildLayerInfo(numberFormat),

            // Payment method selection
            _buildPaymentMethodSelection(),

            // Price summary
            _buildPriceSummary(numberFormat),

            // Important notes
            _buildImportantNotes(),

            // Confirm button
            _buildConfirmButton(numberFormat),

            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  Widget _buildCampaignInfo() {
    return Container(
      padding: const EdgeInsets.all(24),
      color: AppTheme.primaryColor.withValues(alpha: 0.05),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'キャンペーン',
            style: TextStyle(
              fontSize: 14,
              color: AppTheme.textSecondaryColor,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            widget.campaign.name,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  /// 抽選情報表示
  /// 目的: 抽選チケット購入の詳細を表示
  Widget _buildLayerInfo(NumberFormat numberFormat) {
    final availablePositions =
        widget.campaign.positionsTotal - widget.campaign.positionsSold;

    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primaryColor.withValues(alpha: 0.1),
            AppTheme.secondaryColor.withValues(alpha: 0.05),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.primaryColor.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 抽選チケット情報
          Row(
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.primaryColor.withValues(alpha: 0.2),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: const Center(
                  child: Icon(
                    Icons.confirmation_number,
                    size: 28,
                    color: AppTheme.primaryColor,
                  ),
                ),
              ),
              const SizedBox(width: 16),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '抽選チケット',
                      style: TextStyle(
                        fontSize: 14,
                        color: AppTheme.textSecondaryColor,
                      ),
                    ),
                    SizedBox(height: 4),
                    Text(
                      '1枚購入',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          const Divider(),
          const SizedBox(height: 16),
          // 価格表示
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'チケット価格',
                style: TextStyle(
                  fontSize: 14,
                  color: AppTheme.textSecondaryColor,
                ),
              ),
              Text(
                '¥${numberFormat.format(widget.campaign.effectiveTicketPrice)}',
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.primaryColor,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          // 残り枠数
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                '残り枠数',
                style: TextStyle(
                  fontSize: 14,
                  color: AppTheme.textSecondaryColor,
                ),
              ),
              Text(
                '$availablePositions / ${widget.campaign.positionsTotal}',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          // 賞品一覧プレビュー
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.7),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.emoji_events, color: Colors.amber, size: 18),
                    SizedBox(width: 8),
                    Text(
                      '当選賞品',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                ...widget.campaign.layers.take(3).map((layer) {
                  final prizeName = layer.prizeName ?? '${layer.layerNumber}等賞';
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Row(
                      children: [
                        Icon(
                          _getPrizeIcon(layer.layerNumber),
                          size: 16,
                          color: _getPrizeColor(layer.layerNumber),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          '$prizeName (${layer.positionsCount}枠)',
                          style: const TextStyle(fontSize: 13),
                        ),
                      ],
                    ),
                  );
                }),
                if (widget.campaign.layers.length > 3)
                  Text(
                    '...他${widget.campaign.layers.length - 3}種類',
                    style: const TextStyle(
                      fontSize: 12,
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

  /// 賞品アイコン取得
  IconData _getPrizeIcon(int layerNumber) {
    switch (layerNumber) {
      case 1:
        return Icons.emoji_events;
      case 2:
        return Icons.military_tech;
      case 3:
        return Icons.workspace_premium;
      default:
        return Icons.card_giftcard;
    }
  }

  /// 賞品カラー取得
  Color _getPrizeColor(int layerNumber) {
    switch (layerNumber) {
      case 1:
        return const Color(0xFFFFD700);
      case 2:
        return const Color(0xFFC0C0C0);
      case 3:
        return const Color(0xFFCD7F32);
      default:
        return AppTheme.primaryColor;
    }
  }

  Widget _buildPaymentMethodSelection() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '支払い方法',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 12),
          // ignore: deprecated_member_use
          RadioListTile<String>(
            title: const Row(
              children: [
                Icon(Icons.credit_card, size: 20),
                SizedBox(width: 12),
                Text('クレジットカード / デビットカード'),
              ],
            ),
            subtitle: const Text('即時決済'),
            value: 'card',
            // ignore: deprecated_member_use
            groupValue: _paymentMethod,
            // ignore: deprecated_member_use
            onChanged: _isProcessing
                ? null
                : (value) {
                    setState(() {
                      _paymentMethod = value!;
                    });
                  },
          ),
          // ignore: deprecated_member_use
          RadioListTile<String>(
            title: const Row(
              children: [
                Icon(Icons.store, size: 20),
                SizedBox(width: 12),
                Text('コンビニ決済'),
              ],
            ),
            subtitle: const Text('4日以内にお支払いください'),
            value: 'konbini',
            // ignore: deprecated_member_use
            groupValue: _paymentMethod,
            // ignore: deprecated_member_use
            onChanged: _isProcessing
                ? null
                : (value) {
                    setState(() {
                      _paymentMethod = value!;
                    });
                  },
          ),
        ],
      ),
    );
  }

  Widget _buildPriceSummary(NumberFormat numberFormat) {
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.backgroundColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                '抽選チケット',
                style: TextStyle(fontSize: 16),
              ),
              Text(
                '¥${numberFormat.format(widget.campaign.effectiveTicketPrice)}',
                style: const TextStyle(fontSize: 16),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '手数料',
                style: TextStyle(fontSize: 16),
              ),
              Text(
                '¥0',
                style: TextStyle(fontSize: 16),
              ),
            ],
          ),
          const SizedBox(height: 16),
          const Divider(),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                '合計金額',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              Text(
                '¥${numberFormat.format(widget.campaign.effectiveTicketPrice)}',
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.primaryColor,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildImportantNotes() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.warningColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: AppTheme.warningColor.withValues(alpha: 0.3),
        ),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.info_outline, color: AppTheme.warningColor, size: 20),
              SizedBox(width: 8),
              Text(
                '購入前の注意事項',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.warningColor,
                ),
              ),
            ],
          ),
          SizedBox(height: 12),
          Text(
            '• 購入完了後、ポジションはランダムに割り当てられます\n'
            '• 決済完了後のキャンセルはできません\n'
            '• 全ポジションが販売完了後、自動的に抽選が行われます\n'
            '• 当選結果はアプリ内通知でお知らせします',
            style: TextStyle(
              fontSize: 13,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildConfirmButton(NumberFormat numberFormat) {
    return Container(
      padding: const EdgeInsets.all(16),
      child: ElevatedButton(
        onPressed: _isProcessing ? null : _handlePurchase,
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.all(16),
          textStyle: const TextStyle(fontSize: 18),
          backgroundColor: AppTheme.primaryColor,
        ),
        child: _isProcessing
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                ),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.shopping_cart, color: Colors.white),
                  const SizedBox(width: 8),
                  Text(
                    '¥${numberFormat.format(widget.campaign.effectiveTicketPrice)} で抽選に参加',
                    style: const TextStyle(color: Colors.white),
                  ),
                ],
              ),
      ),
    );
  }

  Future<void> _handlePurchase() async {
    // Navigate to payment processing page
    // ignore: unawaited_futures
    unawaited(
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (context) => PaymentProcessingPage(
            campaign: widget.campaign,
            paymentMethod: _paymentMethod,
          ),
        ),
      ),
    );
  }
}
