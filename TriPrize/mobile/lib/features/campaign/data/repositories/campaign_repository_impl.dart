import '../../../admin/data/models/create_campaign_dto.dart';
import '../../domain/repositories/campaign_repository.dart';
import '../datasources/campaign_remote_datasource.dart';
import '../models/campaign_model.dart';

/// Campaign repository implementation
class CampaignRepositoryImpl implements CampaignRepository {
  final CampaignRemoteDataSource remoteDataSource;

  CampaignRepositoryImpl({required this.remoteDataSource});

  @override
  Future<List<CampaignModel>> getCampaigns({
    String? status,
    int? limit,
    int? offset,
  }) async {
    return await remoteDataSource.getCampaigns(
      status: status,
      limit: limit,
      offset: offset,
    );
  }

  @override
  Future<CampaignDetailModel> getCampaignDetail(String campaignId) async {
    return await remoteDataSource.getCampaignDetail(campaignId);
  }

  @override
  Future<Map<String, dynamic>> getCampaignStats(String campaignId) async {
    return await remoteDataSource.getCampaignStats(campaignId);
  }

  @override
  Future<CampaignDetailModel> createCampaign(CreateCampaignDto dto) async {
    return await remoteDataSource.createCampaign(dto);
  }

  @override
  Future<CampaignDetailModel> publishCampaign(String campaignId) async {
    return await remoteDataSource.publishCampaign(campaignId);
  }

  @override
  Future<CampaignDetailModel> closeCampaign(String campaignId) async {
    return await remoteDataSource.closeCampaign(campaignId);
  }

  @override
  Future<void> deleteCampaign(String campaignId) async {
    return await remoteDataSource.deleteCampaign(campaignId);
  }
}
