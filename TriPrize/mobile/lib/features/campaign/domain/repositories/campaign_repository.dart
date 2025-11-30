import '../../../admin/data/models/create_campaign_dto.dart';
import '../../data/models/campaign_model.dart';

/// Campaign repository interface
abstract class CampaignRepository {
  Future<List<CampaignModel>> getCampaigns({String? status, int? limit, int? offset});
  Future<CampaignDetailModel> getCampaignDetail(String campaignId);
  Future<Map<String, dynamic>> getCampaignStats(String campaignId);
  Future<CampaignDetailModel> createCampaign(CreateCampaignDto dto);
  Future<CampaignDetailModel> publishCampaign(String campaignId);
  Future<CampaignDetailModel> closeCampaign(String campaignId);
  Future<void> deleteCampaign(String campaignId);
}
