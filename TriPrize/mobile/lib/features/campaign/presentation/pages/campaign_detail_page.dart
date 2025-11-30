import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../data/models/campaign_model.dart';
import '../providers/campaign_provider.dart';
import '../widgets/triangle_widget.dart';
import '../../../purchase/presentation/pages/purchase_confirm_page.dart';

/// Campaign detail page
/// 目的: キャンペーンの詳細情報を表示し、層を選択して購入に進む
/// I/O: CampaignProviderから詳細データを取得
/// 注意点: 三角形ビジュアライゼーションと層選択UIを含む
class CampaignDetailPage extends StatefulWidget {
  final String campaignId;

  const CampaignDetailPage({
    required this.campaignId, super.key,
  });

  @override
  State<CampaignDetailPage> createState() => _CampaignDetailPageState();
}

class _CampaignDetailPageState extends State<CampaignDetailPage> {
  int? _selectedLayerNumber;

  @override
  void initState() {
    super.initState();
    // Fetch campaign detail when page loads
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<CampaignProvider>().fetchCampaignDetail(widget.campaignId);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('キャンペーン詳細'),
      ),
      body: Consumer<CampaignProvider>(
        builder: (context, provider, child) {
          if (provider.isLoadingDetail) {
            return const Center(
              child: CircularProgressIndicator(),
            );
          }

          if (provider.hasError) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.error_outline, size: 64, color: Colors.red),
                  const SizedBox(height: 16),
                  Text(
                    'キャンペーンの読み込みに失敗しました',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Text(
                      provider.errorMessage ?? '不明なエラー',
                      style: Theme.of(context).textTheme.bodyMedium,
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () {
                      provider.clearError();
                      provider.fetchCampaignDetail(widget.campaignId);
                    },
                    child: const Text('再試行'),
                  ),
                ],
              ),
            );
          }

          final campaign = provider.selectedCampaign;
          if (campaign == null) {
            return const Center(
              child: Text('キャンペーンが見つかりません'),
            );
          }

          return SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Campaign header
                _buildHeader(campaign),

                // Triangle visualization
                _buildTriangleSection(campaign),

                // Layer selection
                _buildLayerSelection(campaign),

                // Prizes
                _buildPrizesSection(campaign),

                // Purchase button
                _buildPurchaseButton(campaign),

                const SizedBox(height: 32),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildHeader(CampaignDetailModel campaign) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primaryColor,
            AppTheme.primaryColor.withValues(alpha: 0.8),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            campaign.name,
            style: const TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
          if (campaign.description != null) ...[
            const SizedBox(height: 12),
            Text(
              campaign.description!,
              style: const TextStyle(
                fontSize: 16,
                color: Colors.white70,
              ),
            ),
          ],
          const SizedBox(height: 20),
          // Progress bar
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '販売済: ${campaign.positionsSold} / ${campaign.positionsTotal}',
                    style: const TextStyle(
                      fontSize: 14,
                      color: Colors.white,
                    ),
                  ),
                  Text(
                    '${((campaign.positionsSold / campaign.positionsTotal) * 100).toStringAsFixed(1)}%',
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: campaign.positionsSold / campaign.positionsTotal,
                  backgroundColor: Colors.white30,
                  valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
                  minHeight: 8,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTriangleSection(CampaignDetailModel campaign) {
    return Container(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '三角形抽選マップ',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          TriangleWidget(
            baseLength: campaign.baseLength,
            layers: campaign.layers,
            selectedLayerNumber: _selectedLayerNumber,
            onLayerTap: (layerNumber) {
              setState(() {
                _selectedLayerNumber = layerNumber;
              });
            },
          ),
        ],
      ),
    );
  }

  Widget _buildLayerSelection(CampaignDetailModel campaign) {
    final numberFormat = NumberFormat('#,###', 'ja_JP');

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '層を選択',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          ListView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: campaign.layers.length,
            itemBuilder: (context, index) {
              final layer = campaign.layers[index];
              final isSelected = _selectedLayerNumber == layer.layerNumber;
              final isSoldOut = layer.positionsSold >= layer.positionsCount;

              return Card(
                margin: const EdgeInsets.only(bottom: 12),
                color: isSelected
                    ? AppTheme.primaryColor.withValues(alpha: 0.1)
                    : null,
                child: InkWell(
                  onTap: isSoldOut
                      ? null
                      : () {
                          setState(() {
                            _selectedLayerNumber = layer.layerNumber;
                          });
                        },
                  borderRadius: BorderRadius.circular(12),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        // Layer number
                        Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            color: isSoldOut
                                ? Colors.grey.withValues(alpha: 0.3)
                                : AppTheme.primaryColor.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Center(
                            child: Text(
                              'L${layer.layerNumber}',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: isSoldOut
                                    ? Colors.grey
                                    : AppTheme.primaryColor,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 16),
                        // Layer info
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '¥${numberFormat.format(layer.price)}',
                                style: TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                  color: isSoldOut
                                      ? Colors.grey
                                      : AppTheme.textPrimaryColor,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                isSoldOut
                                    ? '完売'
                                    : '残り ${layer.positionsCount - layer.positionsSold} / ${layer.positionsCount}',
                                style: TextStyle(
                                  fontSize: 14,
                                  color: isSoldOut
                                      ? Colors.grey
                                      : AppTheme.textSecondaryColor,
                                ),
                              ),
                            ],
                          ),
                        ),
                        // Selection indicator
                        if (isSelected)
                          const Icon(
                            Icons.check_circle,
                            color: AppTheme.primaryColor,
                            size: 28,
                          ),
                        if (isSoldOut)
                          const Icon(
                            Icons.block,
                            color: Colors.grey,
                            size: 28,
                          ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildPrizesSection(CampaignDetailModel campaign) {
    if (campaign.prizes.isEmpty) {
      return const SizedBox.shrink();
    }

    return Container(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '賞品一覧',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          ListView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: campaign.prizes.length,
            itemBuilder: (context, index) {
              final prize = campaign.prizes[index];
              return Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      // Prize rank
                      Container(
                        width: 48,
                        height: 48,
                        decoration: BoxDecoration(
                          color: AppTheme.primaryColor.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Center(
                          child: Text(
                            '${prize.rank}等',
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.primaryColor,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 16),
                      // Prize info
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              prize.name,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            if (prize.description != null) ...[
                              const SizedBox(height: 4),
                              Text(
                                prize.description!,
                                style: const TextStyle(
                                  fontSize: 14,
                                  color: AppTheme.textSecondaryColor,
                                ),
                              ),
                            ],
                            const SizedBox(height: 4),
                            Text(
                              '数量: ${prize.quantity}',
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppTheme.textSecondaryColor,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildPurchaseButton(CampaignDetailModel campaign) {
    final isSelectionValid = _selectedLayerNumber != null;
    final selectedLayer = isSelectionValid
        ? campaign.layers.firstWhere(
            (layer) => layer.layerNumber == _selectedLayerNumber)
        : null;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: ElevatedButton(
        onPressed: isSelectionValid
            ? () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) => PurchaseConfirmPage(
                      campaign: campaign,
                      selectedLayer: selectedLayer!,
                    ),
                  ),
                );
              }
            : null,
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.all(16),
          textStyle: const TextStyle(fontSize: 18),
        ),
        child: Text(
          isSelectionValid
              ? '購入に進む (¥${NumberFormat('#,###', 'ja_JP').format(selectedLayer!.price)})'
              : '層を選択してください',
        ),
      ),
    );
  }
}
