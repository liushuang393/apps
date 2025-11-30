import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../../core/utils/logger.dart';

/// Stripe card payment widget
/// 目的: Stripeカード決済フォームを表示
/// I/O: clientSecretを受け取り、カード情報を入力させて決済を実行
/// 注意点: flutter_stripeを使用、エラーハンドリング必須
class StripeCardPaymentWidget extends StatefulWidget {
  final String clientSecret;
  final VoidCallback onPaymentSuccess;
  final void Function(String error) onPaymentError;

  const StripeCardPaymentWidget({
    required this.clientSecret, required this.onPaymentSuccess, required this.onPaymentError, super.key,
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
      AppLogger.info('Starting Stripe payment confirmation');

      // Confirm payment with Stripe
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
    } catch (e) {
      AppLogger.error('Unexpected payment error', e);

      if (!mounted) return;

      setState(() {
        _isProcessing = false;
      });

      widget.onPaymentError('決済処理中にエラーが発生しました: $e');
    }
  }
}
