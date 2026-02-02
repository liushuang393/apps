import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/constants/app_theme.dart';
import '../../data/models/lottery_result_model.dart';

/// Lottery result page
/// 目的: 抽選結果を表示する
/// I/O: LotteryResultModelを受け取り、当選情報を表示
/// 注意点: ユーザーの当選をハイライト、全当選者を表示
class LotteryResultPage extends StatelessWidget {
  final LotteryResultModel result;

  const LotteryResultPage({
    required this.result, super.key,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('抽選結果'),
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Campaign header
            _buildHeader(),

            // Lottery status
            _buildLotteryStatus(),

            // User wins (if any)
            if (result.isUserWinner) _buildUserWinsSection(),

            // All winners
            _buildWinnersSection(),

            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
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
            result.campaignName,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '抽選ID: ${result.lotteryId}',
            style: const TextStyle(
              fontSize: 14,
              color: Colors.white70,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLotteryStatus() {
    Color statusColor;
    String statusText;
    IconData statusIcon;

    if (result.isCompleted) {
      statusColor = AppTheme.successColor;
      statusText = '抽選完了';
      statusIcon = Icons.check_circle;
    } else if (result.isPending) {
      statusColor = AppTheme.warningColor;
      statusText = '抽選待ち';
      statusIcon = Icons.schedule;
    } else {
      statusColor = Colors.grey;
      statusText = 'キャンセル';
      statusIcon = Icons.cancel;
    }

    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: statusColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: statusColor.withValues(alpha: 0.3),
        ),
      ),
      child: Row(
        children: [
          Icon(
            statusIcon,
            color: statusColor,
            size: 32,
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  statusText,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: statusColor,
                  ),
                ),
                if (result.drawnAt != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    DateFormat('yyyy年MM月dd日 HH:mm', 'ja_JP')
                        .format(result.drawnAt!),
                    style: TextStyle(
                      fontSize: 14,
                      color: Colors.grey[700],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildUserWinsSection() {
    if (result.userWins == null || result.userWins!.isEmpty) {
      return const SizedBox.shrink();
    }

    final numberFormat = NumberFormat('#,###', 'ja_JP');

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Congratulations header
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [
                  Color(0xFFFFD700),
                  Color(0xFFFFA500),
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                const Icon(
                  Icons.emoji_events,
                  size: 64,
                  color: Colors.white,
                ),
                const SizedBox(height: 16),
                const Text(
                  'おめでとうございます！',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '${result.userWins!.length}個の賞品が当選しました',
                  style: const TextStyle(
                    fontSize: 16,
                    color: Colors.white,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // User's wins
          ...result.userWins!.map((win) => Card(
                margin: const EdgeInsets.only(bottom: 12),
                color: AppTheme.primaryColor.withValues(alpha: 0.05),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      // Prize rank
                      Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [
                              Color(0xFFFFD700),
                              Color(0xFFFFA500),
                            ],
                          ),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Center(
                          child: Text(
                            '${win.prizeRank}等',
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
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
                              win.prizeName,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '価値: ¥${numberFormat.format(win.prizeValue)}',
                              style: const TextStyle(
                                fontSize: 14,
                                color: AppTheme.textSecondaryColor,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'ポジション: L${win.layerNumber} 行${win.rowNumber} 列${win.colNumber}',
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
              )),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildWinnersSection() {
    // 顧客で当選していない場合は残念メッセージを表示
    if (!result.isAdmin && !result.isUserWinner) {
      return Container(
        padding: const EdgeInsets.all(32),
        child: Center(
          child: Column(
            children: [
              Icon(
                Icons.sentiment_dissatisfied_outlined,
                size: 64,
                color: Colors.grey[400],
              ),
              const SizedBox(height: 16),
              Text(
                '残念ながら今回は当選しませんでした',
                style: TextStyle(
                  fontSize: 16,
                  color: Colors.grey[600],
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                '次回もぜひご参加ください！',
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.grey[500],
                ),
              ),
            ],
          ),
        ),
      );
    }

    // 管理者でも当選者がいない場合
    if (result.winners.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(32),
        child: Center(
          child: Column(
            children: [
              Icon(
                Icons.info_outline,
                size: 64,
                color: Colors.grey[400],
              ),
              const SizedBox(height: 16),
              Text(
                '当選者情報はまだありません',
                style: TextStyle(
                  fontSize: 16,
                  color: Colors.grey[600],
                ),
              ),
            ],
          ),
        ),
      );
    }

    final numberFormat = NumberFormat('#,###', 'ja_JP');

    return Container(
      margin: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            result.isAdmin ? '当選者一覧' : 'あなたの当選結果',
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          // 不重複の当選者数をカウント
          Builder(
            builder: (context) {
              final uniqueWinners = result.winners
                  .map((w) => w.userId)
                  .where((id) => id != null)
                  .toSet()
                  .length;
              return Text(
                result.isAdmin
                    ? '当選者 $uniqueWinners 名 / 賞品 ${result.winners.length} 件'
                    : '',
                style: const TextStyle(
                  fontSize: 14,
                  color: AppTheme.textSecondaryColor,
                ),
              );
            },
          ),
          const SizedBox(height: 16),

          // Winners list
          ...result.winners.asMap().entries.map((entry) {
            final index = entry.key;
            final winner = entry.value;
            final isUserWin = result.userWins?.any(
                  (win) => win.positionId == winner.positionId,
                ) ??
                false;

            return Card(
              margin: const EdgeInsets.only(bottom: 12),
              color: isUserWin
                  ? AppTheme.primaryColor.withValues(alpha: 0.1)
                  : null,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    // Rank number
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: isUserWin
                            ? AppTheme.primaryColor
                            : Colors.grey[200],
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Center(
                        child: Text(
                          '${index + 1}',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: isUserWin ? Colors.white : Colors.grey[700],
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
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: AppTheme.primaryColor
                                      .withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Text(
                                  '${winner.prizeRank}等',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                    color: AppTheme.primaryColor,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              if (isUserWin)
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 4,
                                  ),
                                  decoration: BoxDecoration(
                                    color: AppTheme.primaryColor,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: const Text(
                                    'あなた',
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.bold,
                                      color: Colors.white,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            winner.prizeName,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          // 管理者の場合は当選者名を表示
                          if (result.isAdmin && winner.userName != null) ...[
                            const SizedBox(height: 4),
                            Text(
                              '当選者: ${winner.userName}',
                              style: const TextStyle(
                                fontSize: 14,
                                color: AppTheme.textSecondaryColor,
                              ),
                            ),
                          ],
                          const SizedBox(height: 4),
                          Text(
                            '¥${numberFormat.format(winner.prizeValue)}',
                            style: const TextStyle(
                              fontSize: 14,
                              color: AppTheme.textSecondaryColor,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'L${winner.layerNumber} 行${winner.rowNumber} 列${winner.colNumber}',
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
          }),
        ],
      ),
    );
  }
}
