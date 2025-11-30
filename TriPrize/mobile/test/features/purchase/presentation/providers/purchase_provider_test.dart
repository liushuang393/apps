import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/mockito.dart';
import 'package:mockito/annotations.dart';
import 'package:triprize_mobile/features/purchase/presentation/providers/purchase_provider.dart';
import 'package:triprize_mobile/features/purchase/domain/repositories/purchase_repository.dart';
import 'package:triprize_mobile/features/purchase/data/models/purchase_model.dart';

@GenerateMocks([PurchaseRepository])
import 'purchase_provider_test.mocks.dart';

void main() {
  late PurchaseProvider purchaseProvider;
  late MockPurchaseRepository mockRepository;

  setUp(() {
    mockRepository = MockPurchaseRepository();
    purchaseProvider = PurchaseProvider(repository: mockRepository);
  });

  group('PurchaseProvider - Initial State', () {
    test('should have correct initial values', () {
      expect(purchaseProvider.purchases, isEmpty);
      expect(purchaseProvider.currentPurchase, isNull);
      expect(purchaseProvider.isLoading, isFalse);
      expect(purchaseProvider.isProcessing, isFalse);
      expect(purchaseProvider.errorMessage, isNull);
      expect(purchaseProvider.hasError, isFalse);
    });
  });

  group('PurchaseProvider - Create Purchase', () {
    test('should create purchase successfully', () async {
      // Arrange
      const campaignId = 'campaign-123';
      const layerNumber = 1;
      const paymentMethod = 'card';

      final mockPurchase = PurchaseModel(
        purchaseId: 'purchase-123',
        userId: 'user-123',
        campaignId: campaignId,
        positionId: 'position-123',
        layerNumber: layerNumber,
        rowNumber: 1,
        colNumber: 1,
        price: 10000,
        paymentMethod: paymentMethod,
        paymentStatus: 'pending',
        createdAt: DateTime.now(),
        paidAt: DateTime.now(),
      );

      when(mockRepository.createPurchase(any))
          .thenAnswer((_) async => mockPurchase);

      // Act
      final result = await purchaseProvider.createPurchase(
        campaignId: campaignId,
        layerNumber: layerNumber,
        paymentMethod: paymentMethod,
      );

      // Assert
      expect(result, isTrue);
      expect(purchaseProvider.currentPurchase, equals(mockPurchase));
      expect(purchaseProvider.hasError, isFalse);
      expect(purchaseProvider.isProcessing, isFalse);
      verify(mockRepository.createPurchase(any)).called(1);
    });

    test('should handle create purchase failure', () async {
      // Arrange
      when(mockRepository.createPurchase(any))
          .thenThrow(Exception('購入の作成に失敗しました'));

      // Act
      final result = await purchaseProvider.createPurchase(
        campaignId: 'campaign-123',
        layerNumber: 1,
        paymentMethod: 'card',
      );

      // Assert
      expect(result, isFalse);
      expect(purchaseProvider.currentPurchase, isNull);
      expect(purchaseProvider.hasError, isTrue);
      expect(purchaseProvider.errorMessage, contains('購入の作成に失敗しました'));
      expect(purchaseProvider.isProcessing, isFalse);
    });

    test('should set processing state during creation', () async {
      // Arrange
      final mockPurchase = PurchaseModel(
        purchaseId: 'purchase-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        positionId: 'position-123',
        layerNumber: 1,
        rowNumber: 1,
        colNumber: 1,
        price: 10000,
        paymentMethod: 'card',
        paymentStatus: 'pending',
        createdAt: DateTime.now(),
        paidAt: DateTime.now(),
      );

      when(mockRepository.createPurchase(any))
          .thenAnswer((_) async {
        await Future.delayed(const Duration(milliseconds: 100));
        return mockPurchase;
      });

      // Act
      final future = purchaseProvider.createPurchase(
        campaignId: 'campaign-123',
        layerNumber: 1,
        paymentMethod: 'card',
      );

      // Give a moment for the state to update
      await Future.delayed(const Duration(milliseconds: 10));

      // Assert during processing
      expect(purchaseProvider.isProcessing, isTrue);

      // Wait for completion
      await future;
      expect(purchaseProvider.isProcessing, isFalse);
    });

    test('should generate unique idempotency key for each purchase', () async {
      // Arrange
      final mockPurchase = PurchaseModel(
        purchaseId: 'purchase-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        positionId: 'position-123',
        layerNumber: 1,
        rowNumber: 1,
        colNumber: 1,
        price: 10000,
        paymentMethod: 'card',
        paymentStatus: 'pending',
        createdAt: DateTime.now(),
        paidAt: DateTime.now(),
      );

      when(mockRepository.createPurchase(any))
          .thenAnswer((_) async => mockPurchase);

      // Act
      await purchaseProvider.createPurchase(
        campaignId: 'campaign-123',
        layerNumber: 1,
        paymentMethod: 'card',
      );

      // Assert - verify that CreatePurchaseRequest was called with an idempotency key
      verify(mockRepository.createPurchase(
        argThat(predicate((request) =>
          (request as CreatePurchaseRequest).idempotencyKey.isNotEmpty
        ))
      )).called(1);
    });
  });

  group('PurchaseProvider - Fetch Purchase History', () {
    test('should fetch purchase history successfully', () async {
      // Arrange
      final mockPurchases = [
        PurchaseModel(
          purchaseId: 'purchase-1',
          userId: 'user-123',
          campaignId: 'campaign-1',
          positionId: 'position-1',
          layerNumber: 1,
          rowNumber: 1,
          colNumber: 1,
          price: 10000,
          paymentMethod: 'card',
          paymentStatus: 'succeeded',
          createdAt: DateTime.now(),
          paidAt: DateTime.now(),
        ),
        PurchaseModel(
          purchaseId: 'purchase-2',
          userId: 'user-123',
          campaignId: 'campaign-2',
          positionId: 'position-2',
          layerNumber: 2,
          rowNumber: 1,
          colNumber: 2,
          price: 8000,
          paymentMethod: 'konbini',
          paymentStatus: 'pending',
          createdAt: DateTime.now(),
          paidAt: DateTime.now(),
        ),
      ];

      when(mockRepository.getPurchaseHistory(
        campaignId: anyNamed('campaignId'),
        limit: anyNamed('limit'),
        offset: anyNamed('offset'),
      )).thenAnswer((_) async => mockPurchases);

      // Act
      await purchaseProvider.fetchPurchaseHistory();

      // Assert
      expect(purchaseProvider.purchases, equals(mockPurchases));
      expect(purchaseProvider.purchases.length, equals(2));
      expect(purchaseProvider.hasError, isFalse);
      expect(purchaseProvider.isLoading, isFalse);
      verify(mockRepository.getPurchaseHistory(
        campaignId: anyNamed('campaignId'),
        limit: anyNamed('limit'),
        offset: anyNamed('offset'),
      )).called(1);
    });

    test('should handle fetch purchase history failure', () async {
      // Arrange
      when(mockRepository.getPurchaseHistory(
        campaignId: anyNamed('campaignId'),
        limit: anyNamed('limit'),
        offset: anyNamed('offset'),
      )).thenThrow(Exception('購入履歴の取得に失敗しました'));

      // Act
      await purchaseProvider.fetchPurchaseHistory();

      // Assert
      expect(purchaseProvider.purchases, isEmpty);
      expect(purchaseProvider.hasError, isTrue);
      expect(purchaseProvider.errorMessage, contains('購入履歴の取得に失敗しました'));
      expect(purchaseProvider.isLoading, isFalse);
    });

    test('should set loading state during fetch', () async {
      // Arrange
      when(mockRepository.getPurchaseHistory(
        campaignId: anyNamed('campaignId'),
        limit: anyNamed('limit'),
        offset: anyNamed('offset'),
      )).thenAnswer((_) async {
        await Future.delayed(const Duration(milliseconds: 100));
        return [];
      });

      // Act
      final future = purchaseProvider.fetchPurchaseHistory();

      // Give a moment for the state to update
      await Future.delayed(const Duration(milliseconds: 10));

      // Assert during loading
      expect(purchaseProvider.isLoading, isTrue);

      // Wait for completion
      await future;
      expect(purchaseProvider.isLoading, isFalse);
    });

    test('should fetch purchase history with campaign filter', () async {
      // Arrange
      const campaignId = 'specific-campaign';
      when(mockRepository.getPurchaseHistory(
        campaignId: campaignId,
        limit: anyNamed('limit'),
        offset: anyNamed('offset'),
      )).thenAnswer((_) async => []);

      // Act
      await purchaseProvider.fetchPurchaseHistory(campaignId: campaignId);

      // Assert
      verify(mockRepository.getPurchaseHistory(
        campaignId: campaignId,
        limit: anyNamed('limit'),
        offset: anyNamed('offset'),
      )).called(1);
    });
  });

  group('PurchaseProvider - Get Purchase by ID', () {
    test('should get purchase by id successfully', () async {
      // Arrange
      const purchaseId = 'purchase-123';
      final mockPurchase = PurchaseModel(
        purchaseId: purchaseId,
        userId: 'user-123',
        campaignId: 'campaign-123',
        positionId: 'position-123',
        layerNumber: 1,
        rowNumber: 1,
        colNumber: 1,
        price: 10000,
        paymentMethod: 'card',
        paymentStatus: 'succeeded',
        createdAt: DateTime.now(),
        paidAt: DateTime.now(),
      );

      when(mockRepository.getPurchaseById(purchaseId))
          .thenAnswer((_) async => mockPurchase);

      // Act
      await purchaseProvider.fetchPurchaseById(purchaseId);

      // Assert
      expect(purchaseProvider.currentPurchase, equals(mockPurchase));
      expect(purchaseProvider.hasError, isFalse);
      verify(mockRepository.getPurchaseById(purchaseId)).called(1);
    });

    test('should handle get purchase by id failure', () async {
      // Arrange
      const purchaseId = 'invalid-id';
      when(mockRepository.getPurchaseById(purchaseId))
          .thenThrow(Exception('購入情報の取得に失敗しました'));

      // Act
      await purchaseProvider.fetchPurchaseById(purchaseId);

      // Assert
      expect(purchaseProvider.hasError, isTrue);
      expect(purchaseProvider.errorMessage, contains('購入情報の取得に失敗しました'));
    });
  });

  group('PurchaseProvider - Confirm Payment', () {
    test('should confirm payment successfully', () async {
      // Arrange
      const purchaseId = 'purchase-123';
      final updatedPurchase = PurchaseModel(
        purchaseId: purchaseId,
        userId: 'user-123',
        campaignId: 'campaign-123',
        positionId: 'position-123',
        layerNumber: 1,
        rowNumber: 1,
        colNumber: 1,
        price: 10000,
        paymentMethod: 'card',
        paymentStatus: 'succeeded',
        createdAt: DateTime.now(),
        paidAt: DateTime.now(),
      );

      when(mockRepository.confirmPayment(purchaseId))
          .thenAnswer((_) async => updatedPurchase);

      // Act
      final result = await purchaseProvider.confirmPayment(purchaseId);

      // Assert
      expect(result, isTrue);
      expect(purchaseProvider.currentPurchase?.paymentStatus, equals('succeeded'));
      expect(purchaseProvider.hasError, isFalse);
      verify(mockRepository.confirmPayment(purchaseId)).called(1);
    });

    test('should handle confirm payment failure', () async {
      // Arrange
      const purchaseId = 'purchase-123';
      when(mockRepository.confirmPayment(purchaseId))
          .thenThrow(Exception('決済確認に失敗しました'));

      // Act
      final result = await purchaseProvider.confirmPayment(purchaseId);

      // Assert
      expect(result, isFalse);
      expect(purchaseProvider.hasError, isTrue);
      expect(purchaseProvider.errorMessage, contains('決済確認に失敗しました'));
    });
  });

  group('PurchaseProvider - Cancel Purchase', () {
    test('should cancel purchase successfully', () async {
      // Arrange
      const purchaseId = 'purchase-123';
      when(mockRepository.cancelPurchase(purchaseId))
          .thenAnswer((_) async {});

      // Act
      final result = await purchaseProvider.cancelPurchase(purchaseId);

      // Assert
      expect(result, isTrue);
      expect(purchaseProvider.hasError, isFalse);
      verify(mockRepository.cancelPurchase(purchaseId)).called(1);
    });

    test('should handle cancel purchase failure', () async {
      // Arrange
      const purchaseId = 'purchase-123';
      when(mockRepository.cancelPurchase(purchaseId))
          .thenThrow(Exception('購入のキャンセルに失敗しました'));

      // Act
      final result = await purchaseProvider.cancelPurchase(purchaseId);

      // Assert
      expect(result, isFalse);
      expect(purchaseProvider.hasError, isTrue);
      expect(purchaseProvider.errorMessage, contains('購入のキャンセルに失敗しました'));
    });
  });

  group('PurchaseProvider - Error Handling', () {
    test('should clear error message', () {
      // Act
      purchaseProvider.clearError();

      // Assert
      expect(purchaseProvider.errorMessage, isNull);
      expect(purchaseProvider.hasError, isFalse);
    });

    test('should maintain error state until cleared', () async {
      // Arrange
      when(mockRepository.createPurchase(any))
          .thenThrow(Exception('Error'));

      // Act
      await purchaseProvider.createPurchase(
        campaignId: 'campaign-123',
        layerNumber: 1,
        paymentMethod: 'card',
      );

      // Assert
      expect(purchaseProvider.hasError, isTrue);
      expect(purchaseProvider.errorMessage, isNotNull);

      // Clear error
      purchaseProvider.clearError();
      expect(purchaseProvider.hasError, isFalse);
    });
  });

  group('PurchaseProvider - State Notifications', () {
    test('should notify listeners on state change', () async {
      // Arrange
      var notifyCount = 0;
      purchaseProvider.addListener(() {
        notifyCount++;
      });

      when(mockRepository.getPurchaseHistory(
        campaignId: anyNamed('campaignId'),
        limit: anyNamed('limit'),
        offset: anyNamed('offset'),
      )).thenAnswer((_) async => []);

      // Act
      await purchaseProvider.fetchPurchaseHistory();

      // Assert - should notify at least twice (loading start and end)
      expect(notifyCount, greaterThanOrEqualTo(2));
    });
  });
}
