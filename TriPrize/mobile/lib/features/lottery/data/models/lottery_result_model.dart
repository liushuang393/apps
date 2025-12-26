import 'package:equatable/equatable.dart';

/// Lottery result model
/// 目的: 抽選結果データの保持
/// 注意点: isAdminはAPIから返される。管理者は全員の結果を見れる
class LotteryResultModel extends Equatable {
  final String lotteryId;
  final String campaignId;
  final String campaignName;
  final String status; // 'pending', 'completed', 'cancelled'
  final DateTime? drawnAt;
  final List<WinnerModel> winners;
  final bool isUserWinner;
  final List<UserWinModel>? userWins; // User's wins in this campaign
  final bool isAdmin; // 管理者かどうか

  const LotteryResultModel({
    required this.lotteryId,
    required this.campaignId,
    required this.campaignName,
    required this.status,
    required this.winners,
    required this.isUserWinner,
    this.drawnAt,
    this.userWins,
    this.isAdmin = false,
  });

  factory LotteryResultModel.fromJson(Map<String, dynamic> json) {
    return LotteryResultModel(
      lotteryId: json['lottery_id'] as String,
      campaignId: json['campaign_id'] as String,
      campaignName: json['campaign_name'] as String? ?? '',
      status: json['status'] as String,
      drawnAt: json['drawn_at'] != null
          ? DateTime.parse(json['drawn_at'] as String)
          : null,
      winners: (json['winners'] as List<dynamic>?)
              ?.map((e) => WinnerModel.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      isUserWinner: json['is_user_winner'] as bool? ?? false,
      userWins: (json['user_wins'] as List<dynamic>?)
          ?.map((e) => UserWinModel.fromJson(e as Map<String, dynamic>))
          .toList(),
      isAdmin: json['is_admin'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'lottery_id': lotteryId,
      'campaign_id': campaignId,
      'campaign_name': campaignName,
      'status': status,
      'drawn_at': drawnAt?.toIso8601String(),
      'winners': winners.map((e) => e.toJson()).toList(),
      'is_user_winner': isUserWinner,
      'user_wins': userWins?.map((e) => e.toJson()).toList(),
      'is_admin': isAdmin,
    };
  }

  bool get isPending => status == 'pending';
  bool get isCompleted => status == 'completed';
  bool get isCancelled => status == 'cancelled';

  @override
  List<Object?> get props => [
        lotteryId,
        campaignId,
        campaignName,
        status,
        drawnAt,
        winners,
        isUserWinner,
        userWins,
        isAdmin,
      ];
}

/// Winner model
/// 目的: 当選者情報の保持
class WinnerModel extends Equatable {
  final String positionId;
  final int layerNumber;
  final int rowNumber;
  final int colNumber;
  final String prizeId;
  final String prizeName;
  final int prizeRank;
  final int prizeValue;
  final String? userId; // May be null if winner hasn't been revealed
  final String? userName; // May be null for privacy

  const WinnerModel({
    required this.positionId,
    required this.layerNumber,
    required this.rowNumber,
    required this.colNumber,
    required this.prizeId,
    required this.prizeName,
    required this.prizeRank,
    required this.prizeValue,
    this.userId,
    this.userName,
  });

  factory WinnerModel.fromJson(Map<String, dynamic> json) {
    return WinnerModel(
      positionId: json['position_id'] as String,
      layerNumber: json['layer_number'] as int,
      rowNumber: json['row_number'] as int,
      colNumber: json['col_number'] as int,
      prizeId: json['prize_id'] as String,
      prizeName: json['prize_name'] as String,
      prizeRank: json['prize_rank'] as int,
      prizeValue: json['prize_value'] as int,
      userId: json['user_id'] as String?,
      userName: json['user_name'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'position_id': positionId,
      'layer_number': layerNumber,
      'row_number': rowNumber,
      'col_number': colNumber,
      'prize_id': prizeId,
      'prize_name': prizeName,
      'prize_rank': prizeRank,
      'prize_value': prizeValue,
      'user_id': userId,
      'user_name': userName,
    };
  }

  @override
  List<Object?> get props => [
        positionId,
        layerNumber,
        rowNumber,
        colNumber,
        prizeId,
        prizeName,
        prizeRank,
        prizeValue,
        userId,
        userName,
      ];
}

/// User win model
/// 目的: ユーザーの当選情報
class UserWinModel extends Equatable {
  final String positionId;
  final int layerNumber;
  final int rowNumber;
  final int colNumber;
  final String prizeName;
  final int prizeRank;
  final int prizeValue;

  const UserWinModel({
    required this.positionId,
    required this.layerNumber,
    required this.rowNumber,
    required this.colNumber,
    required this.prizeName,
    required this.prizeRank,
    required this.prizeValue,
  });

  factory UserWinModel.fromJson(Map<String, dynamic> json) {
    return UserWinModel(
      positionId: json['position_id'] as String,
      layerNumber: json['layer_number'] as int,
      rowNumber: json['row_number'] as int,
      colNumber: json['col_number'] as int,
      prizeName: json['prize_name'] as String,
      prizeRank: json['prize_rank'] as int,
      prizeValue: json['prize_value'] as int,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'position_id': positionId,
      'layer_number': layerNumber,
      'row_number': rowNumber,
      'col_number': colNumber,
      'prize_name': prizeName,
      'prize_rank': prizeRank,
      'prize_value': prizeValue,
    };
  }

  @override
  List<Object?> get props => [
        positionId,
        layerNumber,
        rowNumber,
        colNumber,
        prizeName,
        prizeRank,
        prizeValue,
      ];
}
