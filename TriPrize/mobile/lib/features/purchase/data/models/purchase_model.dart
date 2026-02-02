import 'package:equatable/equatable.dart';

/// 購入モデル
/// 目的: 購入記録のデータモデル
/// I/O: APIから購入データを取得または送信
/// 注意点: APIが返すフィールドとFlutterモデルの対応
class PurchaseModel extends Equatable {
  final String purchaseId;
  final String userId;
  final String campaignId;
  final String positionId;
  final int quantity;
  final int pricePerPosition;
  final int totalAmount;
  final String status; // pending, processing, completed, failed, cancelled, refunded
  final String? paymentIntentId;
  final String? idempotencyKey;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? completedAt;

  /// キャンペーン情報（オプション、一覧表示用）
  final String? campaignName;

  const PurchaseModel({
    required this.purchaseId,
    required this.userId,
    required this.campaignId,
    required this.positionId,
    required this.quantity,
    required this.pricePerPosition,
    required this.totalAmount,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.paymentIntentId,
    this.idempotencyKey,
    this.completedAt,
    this.campaignName,
  });

  factory PurchaseModel.fromJson(Map<String, dynamic> json) {
    return PurchaseModel(
      purchaseId: json['purchase_id'] as String,
      userId: json['user_id'] as String,
      campaignId: json['campaign_id'] as String,
      positionId: json['position_id'] as String,
      quantity: json['quantity'] as int? ?? 1,
      pricePerPosition: json['price_per_position'] as int? ?? 0,
      totalAmount: json['total_amount'] as int? ?? 0,
      status: json['status'] as String? ?? 'pending',
      paymentIntentId: json['payment_intent_id'] as String?,
      idempotencyKey: json['idempotency_key'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
      updatedAt: json['updated_at'] != null
          ? DateTime.parse(json['updated_at'] as String)
          : DateTime.now(),
      completedAt: json['completed_at'] != null
          ? DateTime.parse(json['completed_at'] as String)
          : null,
      campaignName: json['campaign_name'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'purchase_id': purchaseId,
      'user_id': userId,
      'campaign_id': campaignId,
      'position_id': positionId,
      'quantity': quantity,
      'price_per_position': pricePerPosition,
      'total_amount': totalAmount,
      'status': status,
      'payment_intent_id': paymentIntentId,
      'idempotency_key': idempotencyKey,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
      'completed_at': completedAt?.toIso8601String(),
      'campaign_name': campaignName,
    };
  }

  /// 支払い完了かどうかを確認
  bool get isPaid => status == 'completed';

  /// 支払い保留中かどうかを確認
  bool get isPending => status == 'pending' || status == 'processing';

  /// 支払い失敗かどうかを確認
  bool get isFailed =>
      status == 'failed' || status == 'cancelled' || status == 'refunded';

  @override
  List<Object?> get props => [
        purchaseId,
        userId,
        campaignId,
        positionId,
        quantity,
        pricePerPosition,
        totalAmount,
        status,
        paymentIntentId,
        idempotencyKey,
        createdAt,
        updatedAt,
        completedAt,
        campaignName,
      ];
}

/// 購入リクエストDTO
/// 目的: 抽選チケット購入リクエストのデータ転送オブジェクト
/// 注意点: layerNumberはnull可（抽選システムではサーバー側で自動割り当て）
class CreatePurchaseRequest extends Equatable {
  final String campaignId;
  final int? layerNumber; // 抽選システムでは不要
  final String paymentMethod;
  final String idempotencyKey;

  const CreatePurchaseRequest({
    required this.campaignId,
    required this.paymentMethod,
    required this.idempotencyKey,
    this.layerNumber,
  });

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{
      'campaign_id': campaignId,
      'payment_method': paymentMethod,
      'idempotency_key': idempotencyKey,
    };
    if (layerNumber != null) {
      json['layer_number'] = layerNumber;
    }
    return json;
  }

  @override
  List<Object?> get props => [
        campaignId,
        layerNumber,
        paymentMethod,
        idempotencyKey,
      ];
}

/// 支払いインテントモデル
/// 目的: Stripe Payment Intentデータ
class PaymentIntentModel extends Equatable {
  final String paymentIntentId;
  final String clientSecret;
  final int amount;
  final String currency;
  final String status;
  final String? konbiniReference;
  final String? konbiniExpiresAt;

  const PaymentIntentModel({
    required this.paymentIntentId,
    required this.clientSecret,
    required this.amount,
    required this.currency,
    required this.status,
    this.konbiniReference,
    this.konbiniExpiresAt,
  });

  factory PaymentIntentModel.fromJson(Map<String, dynamic> json) {
    return PaymentIntentModel(
      paymentIntentId: json['payment_intent_id'] as String,
      clientSecret: json['client_secret'] as String,
      amount: json['amount'] as int,
      currency: json['currency'] as String,
      status: json['status'] as String,
      konbiniReference: json['konbini_reference'] as String?,
      konbiniExpiresAt: json['konbini_expires_at'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'payment_intent_id': paymentIntentId,
      'client_secret': clientSecret,
      'amount': amount,
      'currency': currency,
      'status': status,
      'konbini_reference': konbiniReference,
      'konbini_expires_at': konbiniExpiresAt,
    };
  }

  @override
  List<Object?> get props => [
        paymentIntentId,
        clientSecret,
        amount,
        currency,
        status,
        konbiniReference,
        konbiniExpiresAt,
      ];
}
