import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'dart:async';
import '../../../../core/constants/app_theme.dart';
import '../../../campaign/data/models/campaign_model.dart';
import 'payment_processing_page.dart';

/// Purchase confirmation page
/// 目的: 确认购买信息并完成支付
/// I/O: 接收campaign和layer信息，调用PurchaseProvider创建购买
/// 注意点: 清晰展示价格、层信息，处理支付流程
class PurchaseConfirmPage extends StatefulWidget {
  final CampaignDetailModel campaign;
  final LayerModel selectedLayer;

  const PurchaseConfirmPage({
    required this.campaign, required this.selectedLayer, super.key,
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

  Widget _buildLayerInfo(NumberFormat numberFormat) {
    final availablePositions =
        widget.selectedLayer.positionsCount - widget.selectedLayer.positionsSold;

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
          Row(
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: AppTheme.primaryColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Center(
                  child: Text(
                    'L${widget.selectedLayer.layerNumber}',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.primaryColor,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '選択した層',
                      style: TextStyle(
                        fontSize: 14,
                        color: AppTheme.textSecondaryColor,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Layer ${widget.selectedLayer.layerNumber}',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
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
                '価格',
                style: TextStyle(
                  fontSize: 14,
                  color: AppTheme.textSecondaryColor,
                ),
              ),
              Text(
                '¥${numberFormat.format(widget.selectedLayer.price)}',
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.primaryColor,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                '残りポジション',
                style: TextStyle(
                  fontSize: 14,
                  color: AppTheme.textSecondaryColor,
                ),
              ),
              Text(
                '$availablePositions / ${widget.selectedLayer.positionsCount}',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ],
      ),
    );
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
                '商品価格',
                style: TextStyle(fontSize: 16),
              ),
              Text(
                '¥${numberFormat.format(widget.selectedLayer.price)}',
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
                '¥${numberFormat.format(widget.selectedLayer.price)}',
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
            : Text(
                '¥${numberFormat.format(widget.selectedLayer.price)} で購入する',
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
            selectedLayer: widget.selectedLayer,
            paymentMethod: _paymentMethod,
          ),
        ),
      ),
    );
  }
}
