import '../../../../core/network/api_client.dart';
import '../../../../core/utils/logger.dart';
import '../models/purchase_model.dart';

/// Purchase remote data source interface
/// 目的: 定义购买相关的API调用接口
abstract class PurchaseRemoteDataSource {
  Future<PurchaseModel> createPurchase(CreatePurchaseRequest request);
  Future<List<PurchaseModel>> getPurchaseHistory({
    String? campaignId,
    int? limit,
    int? offset,
  });
  Future<PurchaseModel> getPurchaseById(String purchaseId);
  Future<PurchaseModel> confirmPayment(String purchaseId);
  Future<void> cancelPurchase(String purchaseId);

  /// Create payment intent for Stripe card payment
  /// 目的: Stripe決済用のPaymentIntentを作成
  /// I/O: purchaseId, paymentMethodを受け取り、clientSecretを含むPaymentIntentを返す
  Future<PaymentIntentModel> createPaymentIntent({
    required String purchaseId,
    required String paymentMethod,
    String? returnUrl,
  });
}

/// Purchase remote data source implementation
/// 目的: 实现购买相关的API调用
/// I/O: 通过ApiClient与后端API通信
/// 注意点: 处理错误、日志记录、数据转换
class PurchaseRemoteDataSourceImpl implements PurchaseRemoteDataSource {
  final ApiClient apiClient;

  PurchaseRemoteDataSourceImpl({required this.apiClient});

  @override
  Future<PurchaseModel> createPurchase(CreatePurchaseRequest request) async {
    try {
      AppLogger.info('Creating purchase for campaign: ${request.campaignId}');

      final response = await apiClient.post(
        '/api/purchases',
        data: request.toJson(),
      );

      final data = response.data as Map<String, dynamic>;
      final purchase = PurchaseModel.fromJson(data['data'] as Map<String, dynamic>);

      AppLogger.info('Purchase created successfully: ${purchase.purchaseId}');
      return purchase;
    } catch (e) {
      AppLogger.error('Failed to create purchase', e);
      throw Exception('購入の作成に失敗しました: $e');
    }
  }

  @override
  Future<List<PurchaseModel>> getPurchaseHistory({
    String? campaignId,
    int? limit,
    int? offset,
  }) async {
    try {
      final queryParams = <String, dynamic>{};
      if (campaignId != null) queryParams['campaign_id'] = campaignId;
      if (limit != null) queryParams['limit'] = limit;
      if (offset != null) queryParams['offset'] = offset;

      AppLogger.info('Fetching purchase history');

      final response = await apiClient.get(
        '/api/purchases/me',
        queryParameters: queryParams,
      );

      final data = response.data as Map<String, dynamic>;
      final purchases = (data['data'] as List<dynamic>)
          .map((e) => PurchaseModel.fromJson(e as Map<String, dynamic>))
          .toList();

      AppLogger.info('Fetched ${purchases.length} purchases');
      return purchases;
    } catch (e) {
      AppLogger.error('Failed to fetch purchase history', e);
      throw Exception('購入履歴の取得に失敗しました: $e');
    }
  }

  @override
  Future<PurchaseModel> getPurchaseById(String purchaseId) async {
    try {
      AppLogger.info('Fetching purchase: $purchaseId');

      final response = await apiClient.get('/api/purchases/$purchaseId');

      final data = response.data as Map<String, dynamic>;
      final purchase = PurchaseModel.fromJson(data['data'] as Map<String, dynamic>);

      AppLogger.info('Purchase fetched successfully');
      return purchase;
    } catch (e) {
      AppLogger.error('Failed to fetch purchase', e);
      throw Exception('購入情報の取得に失敗しました: $e');
    }
  }

  @override
  Future<PurchaseModel> confirmPayment(String purchaseId) async {
    try {
      AppLogger.info('Confirming payment for purchase: $purchaseId');

      final response = await apiClient.post(
        '/api/payment/confirm',
        data: {'purchase_id': purchaseId},
      );

      final data = response.data as Map<String, dynamic>;
      final purchase = PurchaseModel.fromJson(data['data'] as Map<String, dynamic>);

      AppLogger.info('Payment confirmed successfully');
      return purchase;
    } catch (e) {
      AppLogger.error('Failed to confirm payment', e);
      throw Exception('決済の確認に失敗しました: $e');
    }
  }

  @override
  Future<void> cancelPurchase(String purchaseId) async {
    try {
      AppLogger.info('Canceling purchase: $purchaseId');

      await apiClient.post('/api/purchases/$purchaseId/cancel');

      AppLogger.info('Purchase canceled successfully');
    } catch (e) {
      AppLogger.error('Failed to cancel purchase', e);
      throw Exception('購入のキャンセルに失敗しました: $e');
    }
  }

  @override
  Future<PaymentIntentModel> createPaymentIntent({
    required String purchaseId,
    required String paymentMethod,
    String? returnUrl,
  }) async {
    try {
      AppLogger.info('Creating payment intent for purchase: $purchaseId');

      final requestData = <String, dynamic>{
        'purchase_id': purchaseId,
        'payment_method': paymentMethod,
      };
      if (returnUrl != null) {
        requestData['return_url'] = returnUrl;
      }

      final response = await apiClient.post(
        '/api/payments/create-intent',
        data: requestData,
      );

      final data = response.data as Map<String, dynamic>;
      final intentData = data['data'] as Map<String, dynamic>;

      // コンビニ決済の場合、支払い番号と期限を取得
      // 目的: バックエンドから返された konbini_reference と konbini_expires_at を読み取る
      // 注意点: これらのフィールドがないと「取得中...」と表示され続ける
      final konbiniReference = intentData['konbini_reference'] as String?;
      final konbiniExpiresAt = intentData['konbini_expires_at'] as String?;

      AppLogger.debug('Payment intent response', {
        'payment_intent_id': intentData['payment_intent_id'],
        'status': intentData['status'],
        'konbini_reference': konbiniReference,
        'konbini_expires_at': konbiniExpiresAt,
      });

      final paymentIntent = PaymentIntentModel(
        paymentIntentId: intentData['payment_intent_id'] as String,
        clientSecret: intentData['client_secret'] as String,
        amount: intentData['amount'] as int,
        currency: intentData['currency'] as String? ?? 'jpy',
        status: intentData['status'] as String,
        konbiniReference: konbiniReference,
        konbiniExpiresAt: konbiniExpiresAt,
      );

      AppLogger.info('Payment intent created: ${paymentIntent.paymentIntentId}');
      return paymentIntent;
    } catch (e) {
      AppLogger.error('Failed to create payment intent', e);
      throw Exception('決済インテントの作成に失敗しました: $e');
    }
  }
}
