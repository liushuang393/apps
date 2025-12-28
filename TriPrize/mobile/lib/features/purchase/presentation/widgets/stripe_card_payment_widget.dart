import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import '../../../../core/constants/app_config.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/utils/logger.dart';

/// Stripe card payment widget
/// 目的: Stripeカード決済フォームを表示
/// I/O: clientSecretを受け取り、カード情報を入力させて決済を実行
/// 注意点:
///   - flutter_stripeを使用（本番環境）
///   - Mockモードでは後端APIを直接呼び出し（Stripe SDKは使用しない）
class StripeCardPaymentWidget extends StatefulWidget {
  final String clientSecret;
  final String paymentIntentId;
  final VoidCallback onPaymentSuccess;
  final void Function(String error) onPaymentError;

  const StripeCardPaymentWidget({
    required this.clientSecret,
    required this.paymentIntentId,
    required this.onPaymentSuccess,
    required this.onPaymentError,
    super.key,
  });

  @override
  State<StripeCardPaymentWidget> createState() =>
      _StripeCardPaymentWidgetState();
}

class _StripeCardPaymentWidgetState extends State<StripeCardPaymentWidget> {
  final _formKey = GlobalKey<FormState>();
  bool _isProcessing = false;
  CardFieldInputDetails? _cardDetails;

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Info text
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppTheme.primaryColor.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Row(
              children: [
                Icon(
                  Icons.info_outline,
                  size: 18,
                  color: AppTheme.primaryColor,
                ),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'カード情報を入力してください。決済は安全に処理されます。',
                    style: TextStyle(
                      fontSize: 13,
                      color: AppTheme.textPrimaryColor,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Card field
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: AppTheme.borderColor),
              borderRadius: BorderRadius.circular(8),
            ),
            padding: const EdgeInsets.all(12),
            child: CardField(
              onCardChanged: (card) {
                setState(() {
                  _cardDetails = card;
                });
              },
              enablePostalCode: true,
              countryCode: 'JP',
              style: const TextStyle(
                fontSize: 16,
                color: AppTheme.textPrimaryColor,
              ),
              decoration: const InputDecoration(
                border: InputBorder.none,
                hintText: 'カード番号',
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Security note
          Row(
            children: [
              const Icon(
                Icons.lock_outline,
                size: 16,
                color: AppTheme.textSecondaryColor,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'カード情報は暗号化されて安全に送信されます',
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.grey[600],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Pay button
          ElevatedButton(
            onPressed: _isProcessing || !_isCardComplete()
                ? null
                : _handlePayment,
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.all(16),
              textStyle: const TextStyle(fontSize: 16),
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
                : const Text('支払う'),
          ),
        ],
      ),
    );
  }

  bool _isCardComplete() {
    return _cardDetails?.complete ?? false;
  }

  Future<void> _handlePayment() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _isProcessing = true;
    });

    try {
      // Mock モードでは後端 API を直接呼び出し（Stripe SDK は使用しない）
      // 目的: Mock の clientSecret は Stripe SDK で認識されないため
      // 注意点: 本番環境では必ず Stripe SDK を使用する
      if (AppConfig.useMockPayment) {
        await _handleMockPayment();
      } else {
        await _handleRealStripePayment();
      }
    } catch (e) {
      AppLogger.error('Unexpected payment error', e);

      if (!mounted) return;

      setState(() {
        _isProcessing = false;
      });

      widget.onPaymentError('決済処理中にエラーが発生しました: $e');
    }
  }

  /// 本番用: 真実の Stripe SDK を使用して支払いを確認
  Future<void> _handleRealStripePayment() async {
    try {
      AppLogger.info('Starting Stripe payment confirmation (REAL MODE)');

      // Confirm payment with Stripe SDK
      await Stripe.instance.confirmPayment(
        paymentIntentClientSecret: widget.clientSecret,
        data: const PaymentMethodParams.card(
          paymentMethodData: PaymentMethodData(),
        ),
      );

      AppLogger.info('Stripe payment confirmed successfully');

      if (!mounted) return;

      setState(() {
        _isProcessing = false;
      });

      widget.onPaymentSuccess();
    } on StripeException catch (e) {
      AppLogger.error('Stripe payment failed', e);

      if (!mounted) return;

      setState(() {
        _isProcessing = false;
      });

      // Handle specific error cases
      String errorMessage;
      switch (e.error.code) {
        case FailureCode.Canceled:
          errorMessage = '決済がキャンセルされました';
          break;
        case FailureCode.Failed:
          errorMessage = '決済に失敗しました。カード情報をご確認ください';
          break;
        case FailureCode.Timeout:
          errorMessage = '決済がタイムアウトしました。もう一度お試しください';
          break;
        default:
          errorMessage = e.error.localizedMessage ?? '決済処理中にエラーが発生しました';
      }

      widget.onPaymentError(errorMessage);
    }
  }

  /// Mock用: 後端 API を直接呼び出して支払いを確認
  /// 目的: 開発環境でテスト可能にする（Stripe SDK は Mock clientSecret を認識しない）
  /// 注意点: 本番環境では使用禁止
  Future<void> _handleMockPayment() async {
    try {
      AppLogger.info('Starting mock payment confirmation');

      // Mock モードでは後端 API を直接呼び出し
      final apiClient = getIt<ApiClient>();
      final response = await apiClient.post(
        '/api/payments/confirm',
        data: {
          'payment_intent_id': widget.paymentIntentId,
          'payment_method_id': 'pm_mock_card',
        },
      );

      final data = response.data as Map<String, dynamic>;
      final success = data['success'] == true;
      final status = (data['data'] as Map<String, dynamic>?)?['status'];

      if (success && status == 'succeeded') {
        AppLogger.info('Mock payment confirmed successfully');

        if (!mounted) return;

        setState(() {
          _isProcessing = false;
        });

        widget.onPaymentSuccess();
      } else {
        throw Exception('Mock payment failed: status=$status');
      }
    } catch (e) {
      AppLogger.error('Mock payment failed', e);

      if (!mounted) return;

      setState(() {
        _isProcessing = false;
      });

      widget.onPaymentError('決済に失敗しました: $e');
    }
  }
}
