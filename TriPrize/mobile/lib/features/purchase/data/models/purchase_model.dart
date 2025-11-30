import 'package:equatable/equatable.dart';

/// Purchase model
/// 目的: 购买记录的数据模型
/// I/O: 从API获取或发送购买数据
/// 注意点: 包含position、payment、campaign信息
class PurchaseModel extends Equatable {
  final String purchaseId;
  final String userId;
  final String campaignId;
  final String positionId;
  final int layerNumber;
  final int rowNumber;
  final int colNumber;
  final int price;
  final String paymentMethod;
  final String paymentStatus;
  final String? paymentIntentId;
  final String? idempotencyKey;
  final DateTime createdAt;
  final DateTime? paidAt;

  // Campaign info (optional, for list view)
  final String? campaignName;

  const PurchaseModel({
    required this.purchaseId,
    required this.userId,
    required this.campaignId,
    required this.positionId,
    required this.layerNumber,
    required this.rowNumber,
    required this.colNumber,
    required this.price,
    required this.paymentMethod,
    required this.paymentStatus,
    required this.createdAt,
    this.paymentIntentId,
    this.idempotencyKey,
    this.paidAt,
    this.campaignName,
  });

  factory PurchaseModel.fromJson(Map<String, dynamic> json) {
    return PurchaseModel(
      purchaseId: json['purchase_id'] as String,
      userId: json['user_id'] as String,
      campaignId: json['campaign_id'] as String,
      positionId: json['position_id'] as String,
      layerNumber: json['layer_number'] as int,
      rowNumber: json['row_number'] as int,
      colNumber: json['col_number'] as int,
      price: json['price'] as int,
      paymentMethod: json['payment_method'] as String,
      paymentStatus: json['payment_status'] as String,
      paymentIntentId: json['payment_intent_id'] as String?,
      idempotencyKey: json['idempotency_key'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
      paidAt: json['paid_at'] != null
          ? DateTime.parse(json['paid_at'] as String)
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
      'layer_number': layerNumber,
      'row_number': rowNumber,
      'col_number': colNumber,
      'price': price,
      'payment_method': paymentMethod,
      'payment_status': paymentStatus,
      'payment_intent_id': paymentIntentId,
      'idempotency_key': idempotencyKey,
      'created_at': createdAt.toIso8601String(),
      'paid_at': paidAt?.toIso8601String(),
      'campaign_name': campaignName,
    };
  }

  /// Check if payment is completed
  bool get isPaid => paymentStatus == 'succeeded' || paymentStatus == 'paid';

  /// Check if payment is pending
  bool get isPending =>
      paymentStatus == 'pending' || paymentStatus == 'processing';

  /// Check if payment failed
  bool get isFailed =>
      paymentStatus == 'failed' ||
      paymentStatus == 'canceled' ||
      paymentStatus == 'refunded';

  @override
  List<Object?> get props => [
        purchaseId,
        userId,
        campaignId,
        positionId,
        layerNumber,
        rowNumber,
        colNumber,
        price,
        paymentMethod,
        paymentStatus,
        paymentIntentId,
        idempotencyKey,
        createdAt,
        paidAt,
        campaignName,
      ];
}

/// Create purchase request DTO
/// 目的: 购买请求的数据传输对象
class CreatePurchaseRequest extends Equatable {
  final String campaignId;
  final int layerNumber;
  final String paymentMethod;
  final String idempotencyKey;

  const CreatePurchaseRequest({
    required this.campaignId,
    required this.layerNumber,
    required this.paymentMethod,
    required this.idempotencyKey,
  });

  Map<String, dynamic> toJson() {
    return {
      'campaign_id': campaignId,
      'layer_number': layerNumber,
      'payment_method': paymentMethod,
      'idempotency_key': idempotencyKey,
    };
  }

  @override
  List<Object?> get props => [
        campaignId,
        layerNumber,
        paymentMethod,
        idempotencyKey,
      ];
}

/// Payment intent model
/// 目的: Stripe Payment Intent数据
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
