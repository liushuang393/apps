import '../../domain/repositories/purchase_repository.dart';
import '../datasources/purchase_remote_datasource.dart';
import '../models/purchase_model.dart';

/// Purchase repository implementation
/// 目的: 实现购买repository接口
/// I/O: 委托给remote datasource处理API调用
/// 注意点: 作为domain和data层之间的桥梁
class PurchaseRepositoryImpl implements PurchaseRepository {
  final PurchaseRemoteDataSource remoteDataSource;

  PurchaseRepositoryImpl({required this.remoteDataSource});

  @override
  Future<PurchaseModel> createPurchase(CreatePurchaseRequest request) async {
    return await remoteDataSource.createPurchase(request);
  }

  @override
  Future<List<PurchaseModel>> getPurchaseHistory({
    String? campaignId,
    int? limit,
    int? offset,
  }) async {
    return await remoteDataSource.getPurchaseHistory(
      campaignId: campaignId,
      limit: limit,
      offset: offset,
    );
  }

  @override
  Future<PurchaseModel> getPurchaseById(String purchaseId) async {
    return await remoteDataSource.getPurchaseById(purchaseId);
  }

  @override
  Future<PurchaseModel> confirmPayment(String purchaseId) async {
    return await remoteDataSource.confirmPayment(purchaseId);
  }

  @override
  Future<void> cancelPurchase(String purchaseId) async {
    return await remoteDataSource.cancelPurchase(purchaseId);
  }
}
