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
      'quantity': 1,
      'price_per_position': 10000,
      'total_amount': 10000,
      'status': 'completed',
      'payment_intent_id': 'pi_123',
      'created_at': '2025-01-19T10:00:00.000Z',
      'updated_at': '2025-01-19T10:00:00.000Z',
      'completed_at': '2025-01-19T10:00:00.000Z',
    };

    final testPurchaseModel = PurchaseModel(
      purchaseId: 'purchase-123',
      userId: 'user-123',
      campaignId: 'campaign-123',
      positionId: 'position-123',
      quantity: 1,
      pricePerPosition: 10000,
      totalAmount: 10000,
      status: 'completed',
      paymentIntentId: 'pi_123',
      createdAt: testDateTime,
      updatedAt: testDateTime,
      completedAt: testDateTime,
    );

    test('should create PurchaseModel from JSON', () {
      // Act
      final result = PurchaseModel.fromJson(testPurchaseJson);

      // Assert
      expect(result.purchaseId, equals('purchase-123'));
      expect(result.userId, equals('user-123'));
      expect(result.campaignId, equals('campaign-123'));
      expect(result.positionId, equals('position-123'));
      expect(result.quantity, equals(1));
      expect(result.pricePerPosition, equals(10000));
      expect(result.totalAmount, equals(10000));
      expect(result.status, equals('completed'));
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
      expect(result['quantity'], equals(1));
      expect(result['price_per_position'], equals(10000));
      expect(result['total_amount'], equals(10000));
      expect(result['status'], equals('completed'));
      expect(result['payment_intent_id'], equals('pi_123'));
    });

    test('isPaid should return true for completed status', () {
      final purchase = testPurchaseModel.copyWith(status: 'completed');
      expect(purchase.isPaid, isTrue);
    });

    test('isPaid should return false for pending status', () {
      final purchase = testPurchaseModel.copyWith(status: 'pending');
      expect(purchase.isPaid, isFalse);
    });

    test('isPending should return true for pending status', () {
      final purchase = testPurchaseModel.copyWith(status: 'pending');
      expect(purchase.isPending, isTrue);
    });

    test('isPending should return true for processing status', () {
      final purchase = testPurchaseModel.copyWith(status: 'processing');
      expect(purchase.isPending, isTrue);
    });

    test('isFailed should return true for failed status', () {
      final purchase = testPurchaseModel.copyWith(status: 'failed');
      expect(purchase.isFailed, isTrue);
    });

    test('isFailed should return true for cancelled status', () {
      final purchase = testPurchaseModel.copyWith(status: 'cancelled');
      expect(purchase.isFailed, isTrue);
    });

    test('isFailed should return true for refunded status', () {
      final purchase = testPurchaseModel.copyWith(status: 'refunded');
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
        'quantity': 1,
        'price_per_position': 10000,
        'total_amount': 10000,
        'status': 'completed',
        'created_at': '2025-01-19T10:00:00.000Z',
        'updated_at': '2025-01-19T10:00:00.000Z',
      };

      final result = PurchaseModel.fromJson(jsonWithoutOptional);
      expect(result.paymentIntentId, isNull);
      expect(result.completedAt, isNull);
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
    int? quantity,
    int? pricePerPosition,
    int? totalAmount,
    String? status,
    String? paymentIntentId,
    String? idempotencyKey,
    DateTime? createdAt,
    DateTime? updatedAt,
    DateTime? completedAt,
    String? campaignName,
  }) {
    return PurchaseModel(
      purchaseId: purchaseId ?? this.purchaseId,
      userId: userId ?? this.userId,
      campaignId: campaignId ?? this.campaignId,
      positionId: positionId ?? this.positionId,
      quantity: quantity ?? this.quantity,
      pricePerPosition: pricePerPosition ?? this.pricePerPosition,
      totalAmount: totalAmount ?? this.totalAmount,
      status: status ?? this.status,
      paymentIntentId: paymentIntentId ?? this.paymentIntentId,
      idempotencyKey: idempotencyKey ?? this.idempotencyKey,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      completedAt: completedAt ?? this.completedAt,
      campaignName: campaignName ?? this.campaignName,
    );
  }
}
