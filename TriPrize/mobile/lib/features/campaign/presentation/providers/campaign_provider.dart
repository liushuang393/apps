import 'package:flutter/foundation.dart';
import '../../../admin/data/models/create_campaign_dto.dart';
import '../../data/models/campaign_model.dart';
import '../../domain/repositories/campaign_repository.dart';
import '../../../../core/utils/logger.dart';

/// Campaign provider for state management
/// 目的: 管理campaign列表的状态和数据获取
/// I/O: 从CampaignRepository获取数据,通知UI更新
/// 注意点: 使用ChangeNotifier实现简单的状态管理
class CampaignProvider with ChangeNotifier {
  final CampaignRepository repository;

  CampaignProvider({required this.repository});

  // State
  List<CampaignModel> _campaigns = [];
  CampaignDetailModel? _selectedCampaign;
  bool _isLoading = false;
  bool _isLoadingDetail = false;
  String? _errorMessage;

  // Getters
  List<CampaignModel> get campaigns => _campaigns;
  CampaignDetailModel? get selectedCampaign => _selectedCampaign;
  bool get isLoading => _isLoading;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get errorMessage => _errorMessage;
  bool get hasError => _errorMessage != null;

  /// Fetch campaigns from API
  /// 目的: 从后端API获取campaign列表
  /// I/O: 调用repository.getCampaigns(),更新_campaigns状态
  /// 注意点: 处理loading状态和错误
  Future<void> fetchCampaigns({String? status}) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      AppLogger.info('Fetching campaigns with status: $status');
      _campaigns = await repository.getCampaigns(
        status: status, // null の場合はすべて取得
        limit: 50,
      );
      AppLogger.info('Successfully fetched ${_campaigns.length} campaigns');
      _isLoading = false;
      notifyListeners();
    } catch (e) {
      AppLogger.error('Failed to fetch campaigns', e);
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Fetch campaign detail
  /// 目的: キャンペーン詳細を取得
  /// I/O: repository.getCampaignDetail()を呼び出し、_selectedCampaign状態を更新
  /// 注意点: loading状態とエラー処理
  Future<void> fetchCampaignDetail(String campaignId) async {
    _isLoadingDetail = true;
    _errorMessage = null;
    notifyListeners();

    try {
      AppLogger.info('Fetching campaign detail: $campaignId');
      _selectedCampaign = await repository.getCampaignDetail(campaignId);
      AppLogger.info('Successfully fetched campaign detail');
      _isLoadingDetail = false;
      notifyListeners();
    } catch (e) {
      AppLogger.error('Failed to fetch campaign detail', e);
      _errorMessage = e.toString();
      _isLoadingDetail = false;
      notifyListeners();
    }
  }

  /// Clear error message
  /// 目的: 清除错误消息
  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  /// Create a new campaign
  Future<CampaignDetailModel> createCampaign(CreateCampaignDto dto) async {
    _isLoadingDetail = true;
    _errorMessage = null;
    notifyListeners();

    try {
      AppLogger.info('Creating new campaign: ${dto.name}');
      final campaign = await repository.createCampaign(dto);
      AppLogger.info('Successfully created campaign: ${campaign.campaignId}');
      _isLoadingDetail = false;
      notifyListeners();
      return campaign;
    } catch (e) {
      AppLogger.error('Failed to create campaign', e);
      _errorMessage = e.toString();
      _isLoadingDetail = false;
      notifyListeners();
      rethrow;
    }
  }
}

