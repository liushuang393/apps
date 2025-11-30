import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../../data/models/purchase_model.dart';
import '../../domain/repositories/purchase_repository.dart';
import '../../../../core/utils/logger.dart';

/// Purchase provider for state management
/// 目的: 管理购买流程的状态
/// I/O: 从PurchaseRepository获取数据，通知UI更新
/// 注意点: 处理购买流程、支付状态、错误处理
class PurchaseProvider with ChangeNotifier {
  final PurchaseRepository repository;

  PurchaseProvider({required this.repository});

  // State
  List<PurchaseModel> _purchases = [];
  PurchaseModel? _currentPurchase;
  bool _isLoading = false;
  bool _isProcessing = false;
  String? _errorMessage;

  // Getters
  List<PurchaseModel> get purchases => _purchases;
  PurchaseModel? get currentPurchase => _currentPurchase;
  bool get isLoading => _isLoading;
  bool get isProcessing => _isProcessing;
  String? get errorMessage => _errorMessage;
  bool get hasError => _errorMessage != null;

  /// Create a new purchase
  /// 目的: 创建购买订单
  /// I/O: 发送购买请求到后端
  /// 返回: true if successful
  Future<bool> createPurchase({
    required String campaignId,
    required int layerNumber,
    required String paymentMethod,
  }) async {
    _isProcessing = true;
    _errorMessage = null;
    notifyListeners();

    try {
      // Generate idempotency key
      const uuid = Uuid();
      final idempotencyKey = uuid.v4();

      AppLogger.info('Creating purchase for campaign: $campaignId, layer: $layerNumber');

      final request = CreatePurchaseRequest(
        campaignId: campaignId,
        layerNumber: layerNumber,
        paymentMethod: paymentMethod,
        idempotencyKey: idempotencyKey,
      );

      _currentPurchase = await repository.createPurchase(request);

      AppLogger.info('Purchase created successfully: ${_currentPurchase!.purchaseId}');
      _isProcessing = false;
      notifyListeners();

      return true;
    } catch (e) {
      AppLogger.error('Failed to create purchase', e);
      _errorMessage = e.toString();
      _isProcessing = false;
      notifyListeners();
      return false;
    }
  }

  /// Fetch purchase history
  /// 目的: 获取用户的购买历史
  Future<void> fetchPurchaseHistory({
    String? campaignId,
    int? limit,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      AppLogger.info('Fetching purchase history');

      _purchases = await repository.getPurchaseHistory(
        campaignId: campaignId,
        limit: limit ?? 50,
      );

      AppLogger.info('Successfully fetched ${_purchases.length} purchases');
      _isLoading = false;
      notifyListeners();
    } catch (e) {
      AppLogger.error('Failed to fetch purchase history', e);
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Fetch purchase by ID
  /// 目的: 获取特定购买的详细信息
  Future<void> fetchPurchaseById(String purchaseId) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      AppLogger.info('Fetching purchase: $purchaseId');

      _currentPurchase = await repository.getPurchaseById(purchaseId);

      AppLogger.info('Purchase fetched successfully');
      _isLoading = false;
      notifyListeners();
    } catch (e) {
      AppLogger.error('Failed to fetch purchase', e);
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Confirm payment
  /// 目的: 确认支付完成（用于卡支付）
  Future<bool> confirmPayment(String purchaseId) async {
    _isProcessing = true;
    _errorMessage = null;
    notifyListeners();

    try {
      AppLogger.info('Confirming payment for purchase: $purchaseId');

      _currentPurchase = await repository.confirmPayment(purchaseId);

      AppLogger.info('Payment confirmed successfully');
      _isProcessing = false;
      notifyListeners();

      return true;
    } catch (e) {
      AppLogger.error('Failed to confirm payment', e);
      _errorMessage = e.toString();
      _isProcessing = false;
      notifyListeners();
      return false;
    }
  }

  /// Cancel purchase
  /// 目的: 取消购买
  Future<bool> cancelPurchase(String purchaseId) async {
    _isProcessing = true;
    _errorMessage = null;
    notifyListeners();

    try {
      AppLogger.info('Canceling purchase: $purchaseId');

      await repository.cancelPurchase(purchaseId);

      AppLogger.info('Purchase canceled successfully');

      // Refresh purchase list if available
      if (_purchases.isNotEmpty) {
        await fetchPurchaseHistory();
      }

      _isProcessing = false;
      notifyListeners();

      return true;
    } catch (e) {
      AppLogger.error('Failed to cancel purchase', e);
      _errorMessage = e.toString();
      _isProcessing = false;
      notifyListeners();
      return false;
    }
  }

  /// Clear error message
  /// 目的: 清除错误消息
  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  /// Clear current purchase
  /// 目的: 清除当前购买信息
  void clearCurrentPurchase() {
    _currentPurchase = null;
    notifyListeners();
  }
}
