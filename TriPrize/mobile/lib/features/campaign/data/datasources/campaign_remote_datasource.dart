import '../../../../core/network/api_client.dart';
import '../../../../core/utils/logger.dart';
import '../../../admin/data/models/create_campaign_dto.dart';
import '../models/campaign_model.dart';

/// Campaign remote data source interface
abstract class CampaignRemoteDataSource {
  Future<List<CampaignModel>> getCampaigns({String? status, int? limit, int? offset});
  Future<CampaignDetailModel> getCampaignDetail(String campaignId);
  Future<Map<String, dynamic>> getCampaignStats(String campaignId);
  Future<CampaignDetailModel> createCampaign(CreateCampaignDto dto);
  Future<CampaignDetailModel> publishCampaign(String campaignId);
  Future<CampaignDetailModel> closeCampaign(String campaignId);
  Future<void> deleteCampaign(String campaignId);

  /// 手動抽選を実行
  /// 目的: 管理者が手動で抽選を実行
  /// I/O: campaignId を受け取り、抽選結果を返す
  Future<Map<String, dynamic>> drawLottery(String campaignId);
}

/// Campaign remote data source implementation
class CampaignRemoteDataSourceImpl implements CampaignRemoteDataSource {
  final ApiClient apiClient;

  CampaignRemoteDataSourceImpl({required this.apiClient});

  @override
  Future<List<CampaignModel>> getCampaigns({
    String? status,
    int? limit,
    int? offset,
  }) async {
    try {
      final queryParams = <String, dynamic>{};
      if (status != null) queryParams['status'] = status;
      if (limit != null) queryParams['limit'] = limit;
      if (offset != null) queryParams['offset'] = offset;

      final response = await apiClient.get(
        '/api/campaigns',
        queryParameters: queryParams,
      );

      final data = response.data as Map<String, dynamic>;
      final campaigns = (data['data'] as List<dynamic>)
          .map((e) => CampaignModel.fromJson(e as Map<String, dynamic>))
          .toList();

      AppLogger.info('Fetched ${campaigns.length} campaigns');
      return campaigns;
    } catch (e) {
      AppLogger.error('Failed to fetch campaigns', e);
      throw Exception('Failed to fetch campaigns: $e');
    }
  }

  @override
  Future<CampaignDetailModel> getCampaignDetail(String campaignId) async {
    try {
      final response = await apiClient.get('/api/campaigns/$campaignId');

      final data = response.data as Map<String, dynamic>;
      final campaign = CampaignDetailModel.fromJson(data['data'] as Map<String, dynamic>);

      AppLogger.info('Fetched campaign detail: $campaignId');
      return campaign;
    } catch (e) {
      AppLogger.error('Failed to fetch campaign detail', e);
      throw Exception('Failed to fetch campaign detail: $e');
    }
  }

  @override
  Future<Map<String, dynamic>> getCampaignStats(String campaignId) async {
    try {
      final response = await apiClient.get('/api/campaigns/$campaignId/stats');

      final data = response.data as Map<String, dynamic>;
      final stats = data['data'] as Map<String, dynamic>;

      AppLogger.info('Fetched campaign stats: $campaignId');
      return stats;
    } catch (e) {
      AppLogger.error('Failed to fetch campaign stats', e);
      throw Exception('Failed to fetch campaign stats: $e');
    }
  }

  @override
  Future<CampaignDetailModel> createCampaign(CreateCampaignDto dto) async {
    try {
      final response = await apiClient.post(
        '/api/campaigns',
        data: dto.toJson(),
      );

      final data = response.data as Map<String, dynamic>;
      final campaign = CampaignDetailModel.fromJson(data['data'] as Map<String, dynamic>);

      AppLogger.info('Created campaign: ${campaign.campaignId}');
      return campaign;
    } catch (e) {
      AppLogger.error('Failed to create campaign', e);
      // エラー詳細をログに出力
      if (e is ApiException && e.data != null) {
        AppLogger.error('Campaign creation validation errors: ${e.data}');
      }
      throw Exception('Failed to create campaign: $e');
    }
  }

  @override
  Future<CampaignDetailModel> publishCampaign(String campaignId) async {
    try {
      final response = await apiClient.post('/api/campaigns/$campaignId/publish');

      final data = response.data as Map<String, dynamic>;
      final campaign = CampaignDetailModel.fromJson(data['data'] as Map<String, dynamic>);

      AppLogger.info('Published campaign: $campaignId');
      return campaign;
    } catch (e) {
      AppLogger.error('Failed to publish campaign', e);
      throw Exception('Failed to publish campaign: $e');
    }
  }

  @override
  Future<CampaignDetailModel> closeCampaign(String campaignId) async {
    try {
      final response = await apiClient.post('/api/campaigns/$campaignId/close');

      final data = response.data as Map<String, dynamic>;
      final campaign = CampaignDetailModel.fromJson(data['data'] as Map<String, dynamic>);

      AppLogger.info('Closed campaign: $campaignId');
      return campaign;
    } catch (e) {
      AppLogger.error('Failed to close campaign', e);
      throw Exception('Failed to close campaign: $e');
    }
  }

  @override
  Future<void> deleteCampaign(String campaignId) async {
    try {
      await apiClient.delete('/api/campaigns/$campaignId');
      AppLogger.info('Deleted campaign: $campaignId');
    } catch (e) {
      AppLogger.error('Failed to delete campaign', e);
      throw Exception('Failed to delete campaign: $e');
    }
  }

  @override
  Future<Map<String, dynamic>> drawLottery(String campaignId) async {
    try {
      final response = await apiClient.post('/api/lottery/draw/$campaignId');

      final data = response.data as Map<String, dynamic>;
      final result = data['data'] as Map<String, dynamic>;

      AppLogger.info('Drew lottery for campaign: $campaignId');
      return result;
    } catch (e) {
      AppLogger.error('Failed to draw lottery', e);
      throw Exception('Failed to draw lottery: $e');
    }
  }
}
