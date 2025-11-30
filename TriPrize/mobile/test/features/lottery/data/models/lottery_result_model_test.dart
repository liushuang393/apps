import 'package:flutter_test/flutter_test.dart';
import 'package:triprize_mobile/features/lottery/data/models/lottery_result_model.dart';

void main() {
  group('LotteryResultModel', () {
    final testWinnerJson = {
      'position_id': 'position-123',
      'layer_number': 1,
      'row_number': 2,
      'col_number': 3,
      'prize_id': 'prize-123',
      'prize_name': '1等: iPhone',
      'prize_rank': 1,
      'prize_value': 100000,
      'user_id': 'user-123',
      'user_name': 'Test User',
    };

    final testUserWinJson = {
      'position_id': 'position-456',
      'layer_number': 2,
      'row_number': 1,
      'col_number': 1,
      'prize_name': '2等: iPad',
      'prize_rank': 2,
      'prize_value': 50000,
    };

    final testLotteryJson = {
      'lottery_id': 'lottery-123',
      'campaign_id': 'campaign-123',
      'campaign_name': 'Test Campaign',
      'status': 'completed',
      'drawn_at': '2025-01-19T10:00:00.000Z',
      'winners': [testWinnerJson],
      'is_user_winner': true,
      'user_wins': [testUserWinJson],
    };

    test('should create LotteryResultModel from JSON', () {
      // Act
      final result = LotteryResultModel.fromJson(testLotteryJson);

      // Assert
      expect(result.lotteryId, equals('lottery-123'));
      expect(result.campaignId, equals('campaign-123'));
      expect(result.campaignName, equals('Test Campaign'));
      expect(result.status, equals('completed'));
      expect(result.drawnAt, isNotNull);
      expect(result.winners.length, equals(1));
      expect(result.isUserWinner, isTrue);
      expect(result.userWins?.length, equals(1));
    });

    test('should convert LotteryResultModel to JSON', () {
      // Arrange
      final model = LotteryResultModel.fromJson(testLotteryJson);

      // Act
      final json = model.toJson();

      // Assert
      expect(json['lottery_id'], equals('lottery-123'));
      expect(json['campaign_id'], equals('campaign-123'));
      expect(json['campaign_name'], equals('Test Campaign'));
      expect(json['status'], equals('completed'));
      expect(json['is_user_winner'], isTrue);
    });

    test('isPending should return true for pending status', () {
      final model = LotteryResultModel.fromJson({
        ...testLotteryJson,
        'status': 'pending',
      });

      expect(model.isPending, isTrue);
      expect(model.isCompleted, isFalse);
      expect(model.isCancelled, isFalse);
    });

    test('isCompleted should return true for completed status', () {
      final model = LotteryResultModel.fromJson({
        ...testLotteryJson,
        'status': 'completed',
      });

      expect(model.isCompleted, isTrue);
      expect(model.isPending, isFalse);
      expect(model.isCancelled, isFalse);
    });

    test('isCancelled should return true for cancelled status', () {
      final model = LotteryResultModel.fromJson({
        ...testLotteryJson,
        'status': 'cancelled',
      });

      expect(model.isCancelled, isTrue);
      expect(model.isPending, isFalse);
      expect(model.isCompleted, isFalse);
    });

    test('should handle null drawn_at', () {
      final jsonWithoutDrawnAt = Map<String, dynamic>.from(testLotteryJson);
      jsonWithoutDrawnAt.remove('drawn_at');

      final result = LotteryResultModel.fromJson(jsonWithoutDrawnAt);
      expect(result.drawnAt, isNull);
    });

    test('should handle empty winners list', () {
      final jsonWithoutWinners = {
        ...testLotteryJson,
        'winners': [],
      };

      final result = LotteryResultModel.fromJson(jsonWithoutWinners);
      expect(result.winners, isEmpty);
    });

    test('should handle null user_wins', () {
      final jsonWithoutUserWins = Map<String, dynamic>.from(testLotteryJson);
      jsonWithoutUserWins.remove('user_wins');

      final result = LotteryResultModel.fromJson(jsonWithoutUserWins);
      expect(result.userWins, isNull);
    });

    test('should support equality comparison', () {
      final model1 = LotteryResultModel.fromJson(testLotteryJson);
      final model2 = LotteryResultModel.fromJson(testLotteryJson);

      expect(model1, equals(model2));
    });
  });

  group('WinnerModel', () {
    final testWinnerJson = {
      'position_id': 'position-123',
      'layer_number': 1,
      'row_number': 2,
      'col_number': 3,
      'prize_id': 'prize-123',
      'prize_name': '1等: iPhone',
      'prize_rank': 1,
      'prize_value': 100000,
      'user_id': 'user-123',
      'user_name': 'Test User',
    };

    test('should create WinnerModel from JSON', () {
      // Act
      final result = WinnerModel.fromJson(testWinnerJson);

      // Assert
      expect(result.positionId, equals('position-123'));
      expect(result.layerNumber, equals(1));
      expect(result.rowNumber, equals(2));
      expect(result.colNumber, equals(3));
      expect(result.prizeId, equals('prize-123'));
      expect(result.prizeName, equals('1等: iPhone'));
      expect(result.prizeRank, equals(1));
      expect(result.prizeValue, equals(100000));
      expect(result.userId, equals('user-123'));
      expect(result.userName, equals('Test User'));
    });

    test('should convert WinnerModel to JSON', () {
      // Arrange
      final model = WinnerModel.fromJson(testWinnerJson);

      // Act
      final json = model.toJson();

      // Assert
      expect(json['position_id'], equals('position-123'));
      expect(json['layer_number'], equals(1));
      expect(json['row_number'], equals(2));
      expect(json['col_number'], equals(3));
      expect(json['prize_id'], equals('prize-123'));
      expect(json['prize_name'], equals('1等: iPhone'));
      expect(json['prize_rank'], equals(1));
      expect(json['prize_value'], equals(100000));
      expect(json['user_id'], equals('user-123'));
      expect(json['user_name'], equals('Test User'));
    });

    test('should handle null user_id and user_name', () {
      final jsonWithoutUser = Map<String, dynamic>.from(testWinnerJson);
      jsonWithoutUser.remove('user_id');
      jsonWithoutUser.remove('user_name');

      final result = WinnerModel.fromJson(jsonWithoutUser);
      expect(result.userId, isNull);
      expect(result.userName, isNull);
    });

    test('should support equality comparison', () {
      final winner1 = WinnerModel.fromJson(testWinnerJson);
      final winner2 = WinnerModel.fromJson(testWinnerJson);

      expect(winner1, equals(winner2));
    });
  });

  group('UserWinModel', () {
    final testUserWinJson = {
      'position_id': 'position-456',
      'layer_number': 2,
      'row_number': 1,
      'col_number': 1,
      'prize_name': '2等: iPad',
      'prize_rank': 2,
      'prize_value': 50000,
    };

    test('should create UserWinModel from JSON', () {
      // Act
      final result = UserWinModel.fromJson(testUserWinJson);

      // Assert
      expect(result.positionId, equals('position-456'));
      expect(result.layerNumber, equals(2));
      expect(result.rowNumber, equals(1));
      expect(result.colNumber, equals(1));
      expect(result.prizeName, equals('2等: iPad'));
      expect(result.prizeRank, equals(2));
      expect(result.prizeValue, equals(50000));
    });

    test('should convert UserWinModel to JSON', () {
      // Arrange
      final model = UserWinModel.fromJson(testUserWinJson);

      // Act
      final json = model.toJson();

      // Assert
      expect(json['position_id'], equals('position-456'));
      expect(json['layer_number'], equals(2));
      expect(json['row_number'], equals(1));
      expect(json['col_number'], equals(1));
      expect(json['prize_name'], equals('2等: iPad'));
      expect(json['prize_rank'], equals(2));
      expect(json['prize_value'], equals(50000));
    });

    test('should support equality comparison', () {
      final win1 = UserWinModel.fromJson(testUserWinJson);
      final win2 = UserWinModel.fromJson(testUserWinJson);

      expect(win1, equals(win2));
    });

    test('should handle different prize ranks', () {
      final rank1 = UserWinModel.fromJson({...testUserWinJson, 'prize_rank': 1});
      final rank2 = UserWinModel.fromJson({...testUserWinJson, 'prize_rank': 2});
      final rank3 = UserWinModel.fromJson({...testUserWinJson, 'prize_rank': 3});

      expect(rank1.prizeRank, equals(1));
      expect(rank2.prizeRank, equals(2));
      expect(rank3.prizeRank, equals(3));
      expect(rank1, isNot(equals(rank2)));
    });
  });

  group('LotteryResultModel - Complex Scenarios', () {
    test('should handle lottery with multiple winners', () {
      final jsonWithMultipleWinners = {
        'lottery_id': 'lottery-123',
        'campaign_id': 'campaign-123',
        'campaign_name': 'Big Campaign',
        'status': 'completed',
        'drawn_at': '2025-01-19T10:00:00.000Z',
        'winners': [
          {
            'position_id': 'pos-1',
            'layer_number': 1,
            'row_number': 1,
            'col_number': 1,
            'prize_id': 'prize-1',
            'prize_name': '1等',
            'prize_rank': 1,
            'prize_value': 100000,
          },
          {
            'position_id': 'pos-2',
            'layer_number': 2,
            'row_number': 1,
            'col_number': 1,
            'prize_id': 'prize-2',
            'prize_name': '2等',
            'prize_rank': 2,
            'prize_value': 50000,
          },
          {
            'position_id': 'pos-3',
            'layer_number': 3,
            'row_number': 1,
            'col_number': 1,
            'prize_id': 'prize-3',
            'prize_name': '3等',
            'prize_rank': 3,
            'prize_value': 10000,
          },
        ],
        'is_user_winner': false,
      };

      final result = LotteryResultModel.fromJson(jsonWithMultipleWinners);
      expect(result.winners.length, equals(3));
      expect(result.isUserWinner, isFalse);
      expect(result.userWins, isNull);
    });

    test('should handle user winning multiple prizes', () {
      final jsonWithMultipleUserWins = {
        'lottery_id': 'lottery-123',
        'campaign_id': 'campaign-123',
        'campaign_name': 'Lucky Campaign',
        'status': 'completed',
        'drawn_at': '2025-01-19T10:00:00.000Z',
        'winners': [],
        'is_user_winner': true,
        'user_wins': [
          {
            'position_id': 'pos-1',
            'layer_number': 1,
            'row_number': 1,
            'col_number': 1,
            'prize_name': '1等: Grand Prize',
            'prize_rank': 1,
            'prize_value': 100000,
          },
          {
            'position_id': 'pos-2',
            'layer_number': 2,
            'row_number': 1,
            'col_number': 2,
            'prize_name': '3等: Small Prize',
            'prize_rank': 3,
            'prize_value': 10000,
          },
        ],
      };

      final result = LotteryResultModel.fromJson(jsonWithMultipleUserWins);
      expect(result.isUserWinner, isTrue);
      expect(result.userWins?.length, equals(2));
      expect(result.userWins?[0].prizeRank, equals(1));
      expect(result.userWins?[1].prizeRank, equals(3));
    });

    test('should handle pending lottery with no winners', () {
      final pendingLotteryJson = {
        'lottery_id': 'lottery-456',
        'campaign_id': 'campaign-456',
        'campaign_name': 'Upcoming Lottery',
        'status': 'pending',
        'winners': [],
        'is_user_winner': false,
      };

      final result = LotteryResultModel.fromJson(pendingLotteryJson);
      expect(result.isPending, isTrue);
      expect(result.drawnAt, isNull);
      expect(result.winners, isEmpty);
      expect(result.isUserWinner, isFalse);
    });
  });
}
