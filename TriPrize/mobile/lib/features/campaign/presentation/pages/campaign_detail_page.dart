import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/utils/logger.dart';
import '../../data/models/campaign_model.dart';
import '../providers/campaign_provider.dart';
import '../widgets/triangle_widget.dart';
import '../../../lottery/data/models/lottery_result_model.dart';
import '../../../lottery/presentation/pages/lottery_result_page.dart';
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

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Campaign header
              _buildHeader(campaign),

              // Scrollable content
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Triangle visualization
                      _buildTriangleSection(campaign),

                      // Layer selection (prizes)
                      _buildLayerSelection(campaign),

                      const SizedBox(height: 8),
                    ],
                  ),
                ),
              ),

              // Fixed purchase button at bottom
              _buildPurchaseButton(campaign),
              const SizedBox(height: 16),
            ],
          );
        },
      ),
    );
  }

  Widget _buildHeader(CampaignDetailModel campaign) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
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
              fontSize: 22,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
          if (campaign.description != null) ...[
            const SizedBox(height: 6),
            Text(
              campaign.description!,
              style: const TextStyle(
                fontSize: 14,
                color: Colors.white70,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: 10),
          // Progress bar
          Row(
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: campaign.positionsSold / campaign.positionsTotal,
                    backgroundColor: Colors.white30,
                    valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
                    minHeight: 6,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '${campaign.positionsSold}/${campaign.positionsTotal} (${((campaign.positionsSold / campaign.positionsTotal) * 100).toStringAsFixed(1)}%)',
                style: const TextStyle(
                  fontSize: 12,
                  color: Colors.white,
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
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '三角形抽選マップ',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          TriangleWidget(
            baseLength: campaign.baseLength,
            layers: campaign.layers,
            selectedLayerNumber: null, // 抽選システムでは選択不要
            onLayerTap: null, // タップ無効
          ),
        ],
      ),
    );
  }

  /// 賞品層選択ウィジェット
  /// 目的: 顧客に賞品名と枠数を表示（価格は非表示）
  /// 注意点: 当選確率も表示
  Widget _buildLayerSelection(CampaignDetailModel campaign) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // セクションヘッダー
          const Row(
            children: [
              Icon(Icons.emoji_events, color: Colors.amber, size: 20),
              SizedBox(width: 6),
              Text(
                '抽選賞品',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  '購入後、抽選でいずれかの賞品が当たります',
                  style: TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondaryColor,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ListView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: campaign.layers.length,
            itemBuilder: (context, index) {
              final layer = campaign.layers[index];
              final isSoldOut = layer.positionsSold >= layer.positionsCount;
              // 当選確率（1枠あたり）
              final winRate = campaign.positionsTotal > 0
                  ? (layer.positionsCount / campaign.positionsTotal * 100)
                  : 0.0;
              // 賞品名（prize_name がない場合は「N等賞」）
              final prizeName = layer.prizeName ?? '${layer.layerNumber}等賞';

              return Container(
                margin: const EdgeInsets.only(bottom: 8),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: isSoldOut
                        ? [Colors.grey.shade200, Colors.grey.shade100]
                        : _getGradientColors(layer.layerNumber),
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: isSoldOut
                      ? null
                      : [
                          BoxShadow(
                            color: _getPrizeColor(layer.layerNumber)
                                .withValues(alpha: 0.3),
                            blurRadius: 4,
                            offset: const Offset(0, 2),
                          ),
                        ],
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  child: Row(
                    children: [
                      // 賞品アイコン
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.9),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Center(
                          child: _getPrizeIcon(layer.layerNumber, isSoldOut),
                        ),
                      ),
                      const SizedBox(width: 12),
                      // 賞品情報
                      Expanded(
                        child: Row(
                          children: [
                            // 賞品名
                            Expanded(
                              child: Text(
                                prizeName,
                                style: TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.bold,
                                  color: isSoldOut
                                      ? Colors.grey
                                      : Colors.white,
                                ),
                              ),
                            ),
                            // 枠数と当選確率
                            Text(
                              '${layer.positionsCount}枠 / ${winRate.toStringAsFixed(1)}%',
                              style: TextStyle(
                                fontSize: 12,
                                color: isSoldOut
                                    ? Colors.grey
                                    : Colors.white70,
                              ),
                            ),
                          ],
                        ),
                      ),
                      // 完売バッジ
                      if (isSoldOut)
                        Container(
                          margin: const EdgeInsets.only(left: 8),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.grey,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Text(
                            '完売',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
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

  /// 賞品グラデーションカラー取得
  List<Color> _getGradientColors(int layerNumber) {
    switch (layerNumber) {
      case 1:
        return [const Color(0xFFFFD700), const Color(0xFFFFA500)]; // ゴールド
      case 2:
        return [const Color(0xFFC0C0C0), const Color(0xFF808080)]; // シルバー
      case 3:
        return [const Color(0xFFCD7F32), const Color(0xFF8B4513)]; // ブロンズ
      default:
        return [AppTheme.primaryColor, AppTheme.secondaryColor];
    }
  }

  /// 賞品カラー取得
  Color _getPrizeColor(int layerNumber) {
    switch (layerNumber) {
      case 1:
        return const Color(0xFFFFD700);
      case 2:
        return const Color(0xFFC0C0C0);
      case 3:
        return const Color(0xFFCD7F32);
      default:
        return AppTheme.primaryColor;
    }
  }

  /// 賞品アイコン取得
  Widget _getPrizeIcon(int layerNumber, bool isSoldOut) {
    final color = isSoldOut ? Colors.grey : _getPrizeColor(layerNumber);
    switch (layerNumber) {
      case 1:
        return Icon(Icons.emoji_events, color: color, size: 24);
      case 2:
        return Icon(Icons.military_tech, color: color, size: 24);
      case 3:
        return Icon(Icons.workspace_premium, color: color, size: 24);
      default:
        return Icon(Icons.card_giftcard, color: color, size: 24);
    }
  }

  /// 購入ボタン
  /// 目的: 統一価格で抽選チケットを購入
  /// 注意点: 層選択は不要、抽選で自動割り当て、ステータスチェック必須
  Widget _buildPurchaseButton(CampaignDetailModel campaign) {
    final numberFormat = NumberFormat('#,###', 'ja_JP');
    final hasAvailablePositions = campaign.positionsSold < campaign.positionsTotal;
    final isPublished = campaign.status == 'published';
    final isDrawn = campaign.status == 'drawn';
    final canPurchase = hasAvailablePositions && isPublished;

    // デバッグログ
    AppLogger.info('Campaign status: ${campaign.status}, isDrawn: $isDrawn, isPublished: $isPublished');

    // ステータスに応じたメッセージとボタン色
    String buttonText;
    Color buttonColor;
    IconData buttonIcon;

    if (!isPublished) {
      // 未公開
      switch (campaign.status) {
        case 'draft':
          buttonText = 'まだ公開されていません';
          buttonColor = Colors.grey;
          buttonIcon = Icons.edit_note;
          break;
        case 'closed':
          buttonText = '販売終了しました';
          buttonColor = Colors.grey;
          buttonIcon = Icons.cancel_outlined;
          break;
        case 'drawn':
          buttonText = '抽選済み';
          buttonColor = Colors.amber;
          buttonIcon = Icons.emoji_events;
          break;
        default:
          buttonText = '購入できません';
          buttonColor = Colors.grey;
          buttonIcon = Icons.block;
      }
    } else if (!hasAvailablePositions) {
      buttonText = '完売しました';
      buttonColor = Colors.grey;
      buttonIcon = Icons.inventory_2;
    } else {
      buttonText = '抽選に参加 ¥${numberFormat.format(campaign.effectiveTicketPrice)}';
      buttonColor = AppTheme.primaryColor;
      buttonIcon = Icons.shopping_cart;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ステータス警告メッセージ（未公開の場合）
          if (!isPublished)
            Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.orange.shade50,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.orange.shade200),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, color: Colors.orange.shade700, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _getStatusMessage(campaign.status),
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.orange.shade800,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          // 抽選完了の場合は結果確認ボタンを表示
          if (campaign.status == 'drawn')
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () => _showLotteryResult(context, campaign),
                icon: const Icon(Icons.emoji_events, color: Colors.white),
                label: const Text('抽選結果を見る', style: TextStyle(color: Colors.white)),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  textStyle: const TextStyle(fontSize: 16),
                  backgroundColor: Colors.amber.shade700,
                  minimumSize: const Size(double.infinity, 50),
                ),
              ),
            )
          else
          // 購入ボタン
          ElevatedButton(
            onPressed: canPurchase
                ? () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (context) => PurchaseConfirmPage(
                          campaign: campaign,
                          selectedLayer: null, // 抽選なので層選択は不要
                        ),
                      ),
                    );
                  }
                : null,
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
              textStyle: const TextStyle(fontSize: 16),
              backgroundColor: buttonColor,
              disabledBackgroundColor: buttonColor.withValues(alpha: 0.6),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(buttonIcon, color: Colors.white, size: 20),
                const SizedBox(width: 8),
                Text(
                  buttonText,
                  style: const TextStyle(color: Colors.white),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// ステータスに応じたメッセージを取得
  String _getStatusMessage(String status) {
    switch (status) {
      case 'draft':
        return 'このキャンペーンはまだ公開されていません。公開後に購入できるようになります。';
      case 'closed':
        return 'このキャンペーンは販売終了しました。';
      case 'drawn':
        return 'このキャンペーンは抽選が完了しました。';
      default:
        return 'このキャンペーンは現在購入できません。';
    }
  }

  /// 抽選結果を表示
  /// 目的: APIから抽選結果を取得し、ユーザーの当選状況も確認して結果画面に遷移
  /// 注意点: /api/lottery/check/:campaignId でユーザーの当選状況をチェック
  Future<void> _showLotteryResult(
    BuildContext context,
    CampaignDetailModel campaign,
  ) async {
    // ローディング表示
    unawaited(showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(
        child: CircularProgressIndicator(),
      ),
    ));

    try {
      final apiClient = context.read<ApiClient>();

      // 抽選結果を取得（認証必要）
      // 管理者: 全当選者の詳細情報
      // 顧客: 自分の当選情報のみ
      final resultsResponse = await apiClient.get(
        '/api/lottery/results/${campaign.campaignId}',
      );

      if (!context.mounted) return;
      Navigator.of(context).pop(); // ローディングを閉じる

      final resultsData = resultsResponse.data as Map<String, dynamic>;
      final winnersData = resultsData['data'] as List<dynamic>;
      final isAdmin = resultsData['isAdmin'] as bool? ?? false;
      final myWinData = resultsData['myWin'] as Map<String, dynamic>?;

      // 結果モデルを構築
      final winners = winnersData.map((w) {
        final winner = w as Map<String, dynamic>;
        return WinnerModel(
          positionId: winner['position_id'] as String? ?? '',
          userId: winner['user_id'] as String?,
          userName: winner['user_display_name'] as String?,
          prizeId: winner['prize_id'] as String? ?? '',
          prizeName: winner['prize_name'] as String? ?? '',
          prizeRank: winner['prize_rank'] as int? ?? 0,
          prizeValue: winner['prize_value'] as int? ?? 0,
          layerNumber: winner['position_layer'] as int? ?? 0,
          rowNumber: winner['position_row'] as int? ?? 0,
          colNumber: winner['position_col'] as int? ?? 0,
        );
      }).toList();

      // ユーザーの当選情報を判定
      final isUserWinner = myWinData != null || (winners.isNotEmpty && !isAdmin);
      List<UserWinModel>? userWins;
      if (myWinData != null) {
        userWins = [
          UserWinModel(
            positionId: myWinData['position_id'] as String? ?? '',
            prizeName: myWinData['prize_name'] as String? ?? '',
            prizeRank: myWinData['prize_rank'] as int? ?? 0,
            prizeValue: myWinData['prize_value'] as int? ?? 0,
            layerNumber: myWinData['position_layer'] as int? ?? 0,
            rowNumber: myWinData['position_row'] as int? ?? 0,
            colNumber: myWinData['position_col'] as int? ?? 0,
          ),
        ];
      } else if (!isAdmin && winners.isNotEmpty) {
        // 顧客で当選している場合（dataに自分の結果が含まれている）
        userWins = winners.map((w) => UserWinModel(
          positionId: w.positionId,
          prizeName: w.prizeName,
          prizeRank: w.prizeRank,
          prizeValue: w.prizeValue,
          layerNumber: w.layerNumber,
          rowNumber: w.rowNumber,
          colNumber: w.colNumber,
        )).toList();
      }

      final result = LotteryResultModel(
        lotteryId: campaign.campaignId,
        campaignId: campaign.campaignId,
        campaignName: campaign.name,
        status: 'completed',
        winners: winners,
        isUserWinner: isUserWinner,
        userWins: userWins,
        drawnAt: DateTime.now(),
        isAdmin: isAdmin,
      );

      if (context.mounted) {
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (context) => LotteryResultPage(result: result),
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        Navigator.of(context).pop(); // ローディングを閉じる
        // エラーメッセージを長時間表示し、ユーザーが閉じるまで表示
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('抽選結果の取得に失敗しました: $e'),
            backgroundColor: AppTheme.errorColor,
            duration: const Duration(seconds: 10),
            action: SnackBarAction(
              label: '閉じる',
              textColor: Colors.white,
              onPressed: () {
                ScaffoldMessenger.of(context).hideCurrentSnackBar();
              },
            ),
          ),
        );
      }
    }
  }
}
