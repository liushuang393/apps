import '../../data/models/purchase_model.dart';

/// Purchase repository interface
/// 目的: 定义购买相关操作的接口
/// I/O: 抽象层，由具体实现类实现
/// 注意点: 遵循Clean Architecture的依赖反转原則
abstract class PurchaseRepository {
  /// Create a new purchase
  /// 返回: Purchase model with payment intent information
  Future<PurchaseModel> createPurchase(CreatePurchaseRequest request);

  /// Get user's purchase history
  Future<List<PurchaseModel>> getPurchaseHistory({
    String? campaignId,
    int? limit,
    int? offset,
  });

  /// Get purchase by ID
  Future<PurchaseModel> getPurchaseById(String purchaseId);

  /// Confirm payment (for card payments)
  Future<PurchaseModel> confirmPayment(String purchaseId);

  /// Cancel purchase
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
