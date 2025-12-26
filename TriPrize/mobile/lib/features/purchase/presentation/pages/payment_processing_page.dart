import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../campaign/data/models/campaign_model.dart';
import '../../data/models/purchase_model.dart';
import '../providers/purchase_provider.dart';
import '../widgets/stripe_card_payment_widget.dart';
import 'purchase_result_page.dart';

/// Payment processing page
/// 目的: 抽選チケット購入処理と決済を実行する
/// I/O: campaign, paymentMethodを受け取り、決済完了後に結果画面へ
/// 注意点: カード決済とコンビニ決済で処理を分岐、層は抽選で自動割り当て
class PaymentProcessingPage extends StatefulWidget {
  final CampaignDetailModel campaign;
  final String paymentMethod;

  const PaymentProcessingPage({
    required this.campaign,
    required this.paymentMethod,
    super.key,
  });

  @override
  State<PaymentProcessingPage> createState() => _PaymentProcessingPageState();
}

class _PaymentProcessingPageState extends State<PaymentProcessingPage> {
  bool _isPurchaseCreated = false;
  PaymentIntentModel? _paymentIntent;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _createPurchase();
  }

  @override
  Widget build(BuildContext context) {
    final numberFormat = NumberFormat('#,###', 'ja_JP');

    return Scaffold(
      appBar: AppBar(
        title: const Text('決済処理'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Campaign summary
            _buildCampaignSummary(numberFormat),
            const SizedBox(height: 24),

            // Payment section
            if (_errorMessage != null)
              _buildErrorSection()
            else if (!_isPurchaseCreated)
              _buildLoadingSection()
            else if (widget.paymentMethod == 'card' && _paymentIntent != null)
              _buildCardPaymentSection()
            else if (widget.paymentMethod == 'konbini' &&
                _paymentIntent != null)
              _buildKonbiniInstructionsSection()
            else
              _buildLoadingSection(),
          ],
        ),
      ),
    );
  }

  Widget _buildCampaignSummary(NumberFormat numberFormat) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.primaryColor.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '購入内容',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          _buildInfoRow('キャンペーン', widget.campaign.name),
          const SizedBox(height: 12),
          _buildInfoRow('商品', '抽選チケット 1枚'),
          const SizedBox(height: 12),
          _buildInfoRow(
            '金額',
            '¥${numberFormat.format(widget.campaign.effectiveTicketPrice)}',
          ),
          const SizedBox(height: 12),
          _buildInfoRow(
            '支払い方法',
            widget.paymentMethod == 'card' ? 'クレジットカード' : 'コンビニ決済',
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
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  Widget _buildLoadingSection() {
    return Container(
      padding: const EdgeInsets.all(32),
      child: const Column(
        children: [
          CircularProgressIndicator(),
          SizedBox(height: 16),
          Text(
            '処理中...',
            style: TextStyle(
              fontSize: 16,
              color: AppTheme.textSecondaryColor,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorSection() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.errorColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: AppTheme.errorColor.withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        children: [
          const Icon(
            Icons.error_outline,
            color: AppTheme.errorColor,
            size: 48,
          ),
          const SizedBox(height: 16),
          const Text(
            'エラーが発生しました',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: AppTheme.errorColor,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            _errorMessage ?? '不明なエラー',
            style: const TextStyle(fontSize: 14),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: () {
              setState(() {
                _errorMessage = null;
                _isPurchaseCreated = false;
              });
              _createPurchase();
            },
            child: const Text('再試行'),
          ),
        ],
      ),
    );
  }

  Widget _buildCardPaymentSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'カード情報入力',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 16),
        StripeCardPaymentWidget(
          clientSecret: _paymentIntent!.clientSecret,
          onPaymentSuccess: _handlePaymentSuccess,
          onPaymentError: _handlePaymentError,
        ),
      ],
    );
  }

  Widget _buildKonbiniInstructionsSection() {
    final numberFormat = NumberFormat('#,###', 'ja_JP');
    final dateFormat = DateFormat('yyyy年MM月dd日 HH:mm', 'ja_JP');

    DateTime? expiresAt;
    if (_paymentIntent!.konbiniExpiresAt != null) {
      try {
        expiresAt = DateTime.parse(_paymentIntent!.konbiniExpiresAt!);
      } catch (e) {
        // Ignore parsing error
      }
    }

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.warningColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: AppTheme.warningColor.withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(
                Icons.store,
                color: AppTheme.warningColor,
                size: 24,
              ),
              SizedBox(width: 12),
              Text(
                'コンビニでお支払いください',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          const Text(
            '支払い番号',
            style: TextStyle(
              fontSize: 14,
              color: AppTheme.textSecondaryColor,
            ),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  _paymentIntent!.konbiniReference ?? '取得中...',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    fontFamily: 'monospace',
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.copy),
                  onPressed: () async {
                    if (_paymentIntent!.konbiniReference != null) {
                      await Clipboard.setData(
                        ClipboardData(text: _paymentIntent!.konbiniReference!),
                      );
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('支払い番号をクリップボードにコピーしました'),
                            duration: Duration(seconds: 2),
                          ),
                        );
                      }
                    }
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text(
            '支払い金額: ¥${numberFormat.format(_paymentIntent!.amount)}',
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          if (expiresAt != null) ...[
            const SizedBox(height: 8),
            Text(
              '支払い期限: ${dateFormat.format(expiresAt)}',
              style: const TextStyle(
                fontSize: 14,
                color: AppTheme.warningColor,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
          const SizedBox(height: 24),
          const Text(
            '注意事項:',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            '• コンビニで上記の支払い番号をお伝えください\n'
            '• 期限内にお支払いがない場合、自動的にキャンセルされます\n'
            '• お支払い完了後、ポジションが確定します',
            style: TextStyle(
              fontSize: 13,
              height: 1.6,
            ),
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _navigateToResult,
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.all(16),
              minimumSize: const Size(double.infinity, 0),
            ),
            child: const Text('完了'),
          ),
        ],
      ),
    );
  }

  Future<void> _createPurchase() async {
    final purchaseProvider = context.read<PurchaseProvider>();

    // 抽選システム: layerNumberは不要（サーバー側でランダム割り当て）
    final success = await purchaseProvider.createPurchase(
      campaignId: widget.campaign.campaignId,
      layerNumber: null, // 抽選で自動割り当て
      paymentMethod: widget.paymentMethod,
    );

    if (!mounted) return;

    if (success) {
      final purchase = purchaseProvider.currentPurchase;
      if (purchase == null) {
        setState(() {
          _errorMessage = '購入情報の取得に失敗しました';
        });
        return;
      }

      // カード決済の場合、PaymentIntentを作成してclientSecretを取得
      if (widget.paymentMethod == 'card') {
        final paymentIntent = await purchaseProvider.createPaymentIntent(
          purchaseId: purchase.purchaseId,
          paymentMethod: 'card',
        );

        if (!mounted) return;

        if (paymentIntent != null) {
          setState(() {
            _isPurchaseCreated = true;
            _paymentIntent = paymentIntent;
          });
        } else {
          setState(() {
            _errorMessage =
                purchaseProvider.errorMessage ?? '決済インテントの作成に失敗しました';
          });
        }
      } else if (widget.paymentMethod == 'konbini') {
        // コンビニ決済の場合、PaymentIntentを作成
        final paymentIntent = await purchaseProvider.createPaymentIntent(
          purchaseId: purchase.purchaseId,
          paymentMethod: 'konbini',
        );

        if (!mounted) return;

        if (paymentIntent != null) {
          setState(() {
            _isPurchaseCreated = true;
            _paymentIntent = paymentIntent;
          });
          // コンビニ決済は支払い番号を表示（_buildKonbiniInstructionsSection）
          // 結果画面への遷移は行わない - ユーザーが便利店で支払い後、Webhookで更新
        } else {
          setState(() {
            _errorMessage =
                purchaseProvider.errorMessage ?? '決済インテントの作成に失敗しました';
          });
        }
      }
    } else {
      setState(() {
        _errorMessage =
            purchaseProvider.errorMessage ?? '購入の作成に失敗しました';
      });
    }
  }

  void _handlePaymentSuccess() {
    _navigateToResult();
  }

  void _handlePaymentError(String error) {
    setState(() {
      _errorMessage = error;
    });
  }

  void _navigateToResult() {
    final purchaseProvider = context.read<PurchaseProvider>();
    if (purchaseProvider.currentPurchase != null) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (context) => PurchaseResultPage(
            purchase: purchaseProvider.currentPurchase!,
            campaign: widget.campaign,
          ),
        ),
      );
    }
  }
}
