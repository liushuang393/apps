import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
///   - モバイル: flutter_stripeを使用（本番環境）
///   - Web: カスタムフォーム + 後端APIを使用（flutter_stripeはWebで未対応）
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
  
  // モバイル用: flutter_stripe の CardFieldInputDetails
  CardFieldInputDetails? _cardDetails;
  
  // Web用: 手動入力フォーム
  final _cardNumberController = TextEditingController();
  final _expiryController = TextEditingController();
  final _cvcController = TextEditingController();
  final _postalCodeController = TextEditingController();
  
  @override
  void dispose() {
    _cardNumberController.dispose();
    _expiryController.dispose();
    _cvcController.dispose();
    _postalCodeController.dispose();
    super.dispose();
  }

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

          // Card field (Platform-specific)
          // 注意点: kIsWeb で分岐、flutter_stripe はWebで未対応のため
          if (kIsWeb) _buildWebCardForm() else _buildMobileCardField(),
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
  
  /// Web用カード入力フォーム
  /// 目的: flutter_stripe が Web で動作しないため、手動入力フォームを提供
  /// 注意点: カード番号は Stripe API 経由で後端で処理
  Widget _buildWebCardForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Card number
        TextFormField(
          controller: _cardNumberController,
          decoration: InputDecoration(
            labelText: 'カード番号',
            hintText: '4242 4242 4242 4242',
            prefixIcon: const Icon(Icons.credit_card),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
            ),
          ),
          keyboardType: TextInputType.number,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(16),
            _CardNumberInputFormatter(),
          ],
          validator: (value) {
            if (value == null || value.replaceAll(' ', '').length < 13) {
              return 'カード番号を入力してください';
            }
            return null;
          },
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 16),
        
        // Expiry and CVC row
        Row(
          children: [
            Expanded(
              child: TextFormField(
                controller: _expiryController,
                decoration: InputDecoration(
                  labelText: '有効期限',
                  hintText: 'MM/YY',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                keyboardType: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(4),
                  _ExpiryDateInputFormatter(),
                ],
                validator: (value) {
                  if (value == null || value.length < 5) {
                    return '有効期限を入力';
                  }
                  return null;
                },
                onChanged: (_) => setState(() {}),
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: TextFormField(
                controller: _cvcController,
                decoration: InputDecoration(
                  labelText: 'CVC',
                  hintText: '123',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                keyboardType: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(4),
                ],
                obscureText: true,
                validator: (value) {
                  if (value == null || value.length < 3) {
                    return 'CVC必須';
                  }
                  return null;
                },
                onChanged: (_) => setState(() {}),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        
        // Postal code
        TextFormField(
          controller: _postalCodeController,
          decoration: InputDecoration(
            labelText: '郵便番号',
            hintText: '123-4567',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
            ),
          ),
          keyboardType: TextInputType.number,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(7),
          ],
          onChanged: (_) => setState(() {}),
        ),
      ],
    );
  }
  
  /// モバイル用: flutter_stripe の CardField
  Widget _buildMobileCardField() {
    return Container(
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
    );
  }

  bool _isCardComplete() {
    if (kIsWeb) {
      // Web: 手動入力フォームのバリデーション
      final cardNumber = _cardNumberController.text.replaceAll(' ', '');
      final expiry = _expiryController.text;
      final cvc = _cvcController.text;
      return cardNumber.length >= 13 && expiry.length >= 5 && cvc.length >= 3;
    } else {
      // モバイル: flutter_stripe の CardFieldInputDetails
      return _cardDetails?.complete ?? false;
    }
  }

  Future<void> _handlePayment() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _isProcessing = true;
    });

    try {
      // プラットフォームとMockモードによる分岐
      // 目的: Web、Mock、モバイル本番で異なる決済フローを実行
      // 注意点:
      //   - Web: flutter_stripe未対応のため後端APIで処理
      //   - Mock: テスト用の偽決済
      //   - モバイル本番: flutter_stripe SDKを使用
      if (AppConfig.useMockPayment) {
        await _handleMockPayment();
      } else if (kIsWeb) {
        await _handleWebPayment();
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

  /// Web用: 後端 API を通じて Stripe で支払いを確認
  /// 目的: flutter_stripe が Web で動作しないため、後端経由で決済
  /// 注意点: カード情報は後端で Stripe に送信される（PCI DSS 準拠）
  Future<void> _handleWebPayment() async {
    try {
      AppLogger.info('Starting Web payment confirmation via API');

      // カード情報を解析
      final cardNumber = _cardNumberController.text.replaceAll(' ', '');
      final expiryParts = _expiryController.text.split('/');
      final expMonth = int.tryParse(expiryParts[0]) ?? 0;
      final expYear = int.tryParse(expiryParts.length > 1 ? expiryParts[1] : '0') ?? 0;
      final cvc = _cvcController.text;

      // 後端 API を呼び出して支払いを確認
      // 注意: 後端で payment_method を作成し、PaymentIntent を確認
      final apiClient = getIt<ApiClient>();
      final response = await apiClient.post(
        '/api/payments/confirm-with-card',
        data: {
          'payment_intent_id': widget.paymentIntentId,
          'card': {
            'number': cardNumber,
            'exp_month': expMonth,
            'exp_year': expYear < 100 ? 2000 + expYear : expYear,
            'cvc': cvc,
          },
        },
      );

      final data = response.data as Map<String, dynamic>;
      final success = data['success'] == true;
      final paymentData = data['data'] as Map<String, dynamic>?;
      final status = paymentData?['status'];

      if (success && (status == 'succeeded' || status == 'processing')) {
        AppLogger.info('Web payment confirmed successfully: status=$status');

        if (!mounted) return;

        setState(() {
          _isProcessing = false;
        });

        widget.onPaymentSuccess();
      } else {
        final errorMessage = paymentData?['error'] ?? 'Unknown error';
        throw Exception('Web payment failed: status=$status, error=$errorMessage');
      }
    } catch (e) {
      AppLogger.error('Web payment failed', e);

      if (!mounted) return;

      setState(() {
        _isProcessing = false;
      });

      widget.onPaymentError('決済に失敗しました。カード情報をご確認ください。');
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

/// カード番号のフォーマッター（4桁ごとにスペース挿入）
/// 目的: UX向上のためカード番号を読みやすくフォーマット
class _CardNumberInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final text = newValue.text.replaceAll(' ', '');
    final buffer = StringBuffer();
    
    for (int i = 0; i < text.length; i++) {
      if (i > 0 && i % 4 == 0) {
        buffer.write(' ');
      }
      buffer.write(text[i]);
    }
    
    final formatted = buffer.toString();
    return TextEditingValue(
      text: formatted,
      selection: TextSelection.collapsed(offset: formatted.length),
    );
  }
}

/// 有効期限のフォーマッター（MM/YY形式）
/// 目的: UX向上のため有効期限を標準形式でフォーマット
class _ExpiryDateInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final text = newValue.text.replaceAll('/', '');
    final buffer = StringBuffer();
    
    for (int i = 0; i < text.length && i < 4; i++) {
      if (i == 2) {
        buffer.write('/');
      }
      buffer.write(text[i]);
    }
    
    final formatted = buffer.toString();
    return TextEditingValue(
      text: formatted,
      selection: TextSelection.collapsed(offset: formatted.length),
    );
  }
}
