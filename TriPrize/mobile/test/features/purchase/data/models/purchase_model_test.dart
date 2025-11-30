import 'package:flutter_test/flutter_test.dart';
import 'package:triprize_mobile/features/purchase/data/models/purchase_model.dart';

void main() {
  group('PurchaseModel', () {
    final testDateTime = DateTime.parse('2025-01-19T10:00:00Z');

    final testPurchaseJson = {
      'purchase_id': 'purchase-123',
      'user_id': 'user-123',
      'campaign_id': 'campaign-123',
      'position_id': 'position-123',
      'layer_number': 1,
      'row_number': 2,
      'col_number': 3,
      'price': 10000,
      'payment_method': 'card',
      'payment_status': 'succeeded',
      'payment_intent_id': 'pi_123',
      'created_at': '2025-01-19T10:00:00.000Z',
      'paid_at': '2025-01-19T10:00:00.000Z',
      'updated_at': '2025-01-19T10:00:00.000Z',
    };

    final testPurchaseModel = PurchaseModel(
      purchaseId: 'purchase-123',
      userId: 'user-123',
      campaignId: 'campaign-123',
      positionId: 'position-123',
      layerNumber: 1,
      rowNumber: 2,
      colNumber: 3,
      price: 10000,
      paymentMethod: 'card',
      paymentStatus: 'succeeded',
      paymentIntentId: 'pi_123',
      createdAt: testDateTime,
      paidAt: testDateTime,
    );

    test('should create PurchaseModel from JSON', () {
      // Act
      final result = PurchaseModel.fromJson(testPurchaseJson);

      // Assert
      expect(result.purchaseId, equals('purchase-123'));
      expect(result.userId, equals('user-123'));
      expect(result.campaignId, equals('campaign-123'));
      expect(result.positionId, equals('position-123'));
      expect(result.layerNumber, equals(1));
      expect(result.rowNumber, equals(2));
      expect(result.colNumber, equals(3));
      expect(result.price, equals(10000));
      expect(result.paymentMethod, equals('card'));
      expect(result.paymentStatus, equals('succeeded'));
      expect(result.paymentIntentId, equals('pi_123'));
    });

    test('should convert PurchaseModel to JSON', () {
      // Act
      final result = testPurchaseModel.toJson();

      // Assert
      expect(result['purchase_id'], equals('purchase-123'));
      expect(result['user_id'], equals('user-123'));
      expect(result['campaign_id'], equals('campaign-123'));
      expect(result['position_id'], equals('position-123'));
      expect(result['layer_number'], equals(1));
      expect(result['row_number'], equals(2));
      expect(result['col_number'], equals(3));
      expect(result['price'], equals(10000));
      expect(result['payment_method'], equals('card'));
      expect(result['payment_status'], equals('succeeded'));
      expect(result['payment_intent_id'], equals('pi_123'));
    });

    test('isPaid should return true for succeeded status', () {
      final purchase = testPurchaseModel.copyWith(paymentStatus: 'succeeded');
      expect(purchase.isPaid, isTrue);
    });

    test('isPaid should return true for paid status', () {
      final purchase = testPurchaseModel.copyWith(paymentStatus: 'paid');
      expect(purchase.isPaid, isTrue);
    });

    test('isPaid should return false for pending status', () {
      final purchase = testPurchaseModel.copyWith(paymentStatus: 'pending');
      expect(purchase.isPaid, isFalse);
    });

    test('isPending should return true for pending status', () {
      final purchase = testPurchaseModel.copyWith(paymentStatus: 'pending');
      expect(purchase.isPending, isTrue);
    });

    test('isPending should return true for processing status', () {
      final purchase = testPurchaseModel.copyWith(paymentStatus: 'processing');
      expect(purchase.isPending, isTrue);
    });

    test('isFailed should return true for failed status', () {
      final purchase = testPurchaseModel.copyWith(paymentStatus: 'failed');
      expect(purchase.isFailed, isTrue);
    });

    test('isFailed should return true for canceled status', () {
      final purchase = testPurchaseModel.copyWith(paymentStatus: 'canceled');
      expect(purchase.isFailed, isTrue);
    });

    test('isFailed should return true for refunded status', () {
      final purchase = testPurchaseModel.copyWith(paymentStatus: 'refunded');
      expect(purchase.isFailed, isTrue);
    });

    test('should support equality comparison', () {
      final purchase1 = testPurchaseModel;
      final purchase2 = PurchaseModel.fromJson(testPurchaseJson);

      expect(purchase1, equals(purchase2));
    });

    test('should handle optional fields', () {
      final jsonWithoutOptional = {
        'purchase_id': 'purchase-123',
        'user_id': 'user-123',
        'campaign_id': 'campaign-123',
        'position_id': 'position-123',
        'layer_number': 1,
        'row_number': 2,
        'col_number': 3,
        'price': 10000,
        'payment_method': 'card',
        'payment_status': 'succeeded',
        'created_at': '2025-01-19T10:00:00.000Z',
      'paid_at': '2025-01-19T10:00:00.000Z',
        'updated_at': '2025-01-19T10:00:00.000Z',
      };

      final result = PurchaseModel.fromJson(jsonWithoutOptional);
      expect(result.paymentIntentId, isNull);
    });
  });

  group('CreatePurchaseRequest', () {
    test('should create request model', () {
      // Arrange & Act
      const request = CreatePurchaseRequest(
        campaignId: 'campaign-123',
        layerNumber: 1,
        paymentMethod: 'card',
        idempotencyKey: 'idempotency-123',
      );

      // Assert
      expect(request.campaignId, equals('campaign-123'));
      expect(request.layerNumber, equals(1));
      expect(request.paymentMethod, equals('card'));
      expect(request.idempotencyKey, equals('idempotency-123'));
    });

    test('should convert to JSON', () {
      // Arrange
      const request = CreatePurchaseRequest(
        campaignId: 'campaign-123',
        layerNumber: 1,
        paymentMethod: 'card',
        idempotencyKey: 'idempotency-123',
      );

      // Act
      final json = request.toJson();

      // Assert
      expect(json['campaign_id'], equals('campaign-123'));
      expect(json['layer_number'], equals(1));
      expect(json['payment_method'], equals('card'));
      expect(json['idempotency_key'], equals('idempotency-123'));
    });

    test('should support equality comparison', () {
      const request1 = CreatePurchaseRequest(
        campaignId: 'campaign-123',
        layerNumber: 1,
        paymentMethod: 'card',
        idempotencyKey: 'idempotency-123',
      );

      const request2 = CreatePurchaseRequest(
        campaignId: 'campaign-123',
        layerNumber: 1,
        paymentMethod: 'card',
        idempotencyKey: 'idempotency-123',
      );

      expect(request1, equals(request2));
    });
  });

  group('PaymentIntentModel', () {
    final testPaymentIntentJson = {
      'payment_intent_id': 'pi_123',
      'client_secret': 'secret_123',
      'amount': 10000,
      'currency': 'jpy',
      'status': 'succeeded',
      'konbini_reference': '123456789012',
      'konbini_expires_at': '2025-01-23T10:00:00.000Z',
    };

    test('should create PaymentIntentModel from JSON', () {
      // Act
      final result = PaymentIntentModel.fromJson(testPaymentIntentJson);

      // Assert
      expect(result.paymentIntentId, equals('pi_123'));
      expect(result.clientSecret, equals('secret_123'));
      expect(result.amount, equals(10000));
      expect(result.currency, equals('jpy'));
      expect(result.status, equals('succeeded'));
      expect(result.konbiniReference, equals('123456789012'));
      expect(result.konbiniExpiresAt, equals('2025-01-23T10:00:00.000Z'));
    });

    test('should convert PaymentIntentModel to JSON', () {
      // Arrange
      const model = PaymentIntentModel(
        paymentIntentId: 'pi_123',
        clientSecret: 'secret_123',
        amount: 10000,
        currency: 'jpy',
        status: 'succeeded',
        konbiniReference: '123456789012',
        konbiniExpiresAt: '2025-01-23T10:00:00.000Z',
      );

      // Act
      final json = model.toJson();

      // Assert
      expect(json['payment_intent_id'], equals('pi_123'));
      expect(json['client_secret'], equals('secret_123'));
      expect(json['amount'], equals(10000));
      expect(json['currency'], equals('jpy'));
      expect(json['status'], equals('succeeded'));
      expect(json['konbini_reference'], equals('123456789012'));
      expect(json['konbini_expires_at'], equals('2025-01-23T10:00:00.000Z'));
    });

    test('should handle optional konbini fields', () {
      final jsonWithoutKonbini = {
        'payment_intent_id': 'pi_123',
        'client_secret': 'secret_123',
        'amount': 10000,
        'currency': 'jpy',
        'status': 'succeeded',
      };

      final result = PaymentIntentModel.fromJson(jsonWithoutKonbini);
      expect(result.konbiniReference, isNull);
      expect(result.konbiniExpiresAt, isNull);
    });

    test('should support equality comparison', () {
      final intent1 = PaymentIntentModel.fromJson(testPaymentIntentJson);
      final intent2 = PaymentIntentModel.fromJson(testPaymentIntentJson);

      expect(intent1, equals(intent2));
    });
  });
}

extension on PurchaseModel {
  PurchaseModel copyWith({
    String? purchaseId,
    String? userId,
    String? campaignId,
    String? positionId,
    int? layerNumber,
    int? rowNumber,
    int? colNumber,
    int? price,
    String? paymentMethod,
    String? paymentStatus,
    String? paymentIntentId,
    DateTime? createdAt,
    DateTime? paidAt,
  }) {
    return PurchaseModel(
      purchaseId: purchaseId ?? this.purchaseId,
      userId: userId ?? this.userId,
      campaignId: campaignId ?? this.campaignId,
      positionId: positionId ?? this.positionId,
      layerNumber: layerNumber ?? this.layerNumber,
      rowNumber: rowNumber ?? this.rowNumber,
      colNumber: colNumber ?? this.colNumber,
      price: price ?? this.price,
      paymentMethod: paymentMethod ?? this.paymentMethod,
      paymentStatus: paymentStatus ?? this.paymentStatus,
      paymentIntentId: paymentIntentId ?? this.paymentIntentId,
      createdAt: createdAt ?? this.createdAt,
      paidAt: paidAt ?? this.paidAt,
    );
  }
}
