import 'package:flutter_test/flutter_test.dart';
import 'package:triprize_mobile/features/campaign/data/models/campaign_model.dart';

void main() {
  group('CampaignModel Tests', () {
    final testJson = {
      'campaign_id': 'test-campaign-id',
      'name': 'Test Campaign',
      'description': 'Test Description',
      'base_length': 5,
      'positions_total': 15,
      'positions_sold': 8,
      'progress_percent': 53.33,
      'min_price': 100,
      'max_price': 500,
      'status': 'published',
      'end_date': '2025-12-31T23:59:59.000Z',
      'created_at': '2025-01-01T00:00:00.000Z',
    };

    test('should create CampaignModel from JSON', () {
      final campaign = CampaignModel.fromJson(testJson);

      expect(campaign.campaignId, equals('test-campaign-id'));
      expect(campaign.name, equals('Test Campaign'));
      expect(campaign.description, equals('Test Description'));
      expect(campaign.baseLength, equals(5));
      expect(campaign.positionsTotal, equals(15));
      expect(campaign.positionsSold, equals(8));
      expect(campaign.progressPercent, equals(53.33));
      expect(campaign.minPrice, equals(100));
      expect(campaign.maxPrice, equals(500));
      expect(campaign.status, equals('published'));
      expect(campaign.endDate, isA<DateTime>());
      expect(campaign.createdAt, isA<DateTime>());
    });

    test('should handle null description', () {
      final jsonWithoutDescription = Map<String, dynamic>.from(testJson);
      jsonWithoutDescription['description'] = null;

      final campaign = CampaignModel.fromJson(jsonWithoutDescription);

      expect(campaign.description, isNull);
    });

    test('should handle null end_date', () {
      final jsonWithoutEndDate = Map<String, dynamic>.from(testJson);
      jsonWithoutEndDate['end_date'] = null;

      final campaign = CampaignModel.fromJson(jsonWithoutEndDate);

      expect(campaign.endDate, isNull);
    });

    test('should convert to JSON correctly', () {
      final campaign = CampaignModel.fromJson(testJson);
      final json = campaign.toJson();

      expect(json['campaign_id'], equals('test-campaign-id'));
      expect(json['name'], equals('Test Campaign'));
      expect(json['base_length'], equals(5));
      expect(json['positions_total'], equals(15));
      expect(json['status'], equals('published'));
    });

    test('should support equality comparison', () {
      final campaign1 = CampaignModel.fromJson(testJson);
      final campaign2 = CampaignModel.fromJson(testJson);

      expect(campaign1, equals(campaign2));
    });
  });

  group('LayerModel Tests', () {
    final testJson = {
      'layer_id': 'test-layer-id',
      'campaign_id': 'test-campaign-id',
      'layer_number': 1,
      'positions_count': 5,
      'positions_sold': 3,
      'price': 500,
    };

    test('should create LayerModel from JSON', () {
      final layer = LayerModel.fromJson(testJson);

      expect(layer.layerId, equals('test-layer-id'));
      expect(layer.campaignId, equals('test-campaign-id'));
      expect(layer.layerNumber, equals(1));
      expect(layer.positionsCount, equals(5));
      expect(layer.positionsSold, equals(3));
      expect(layer.price, equals(500));
    });

    test('should support equality comparison', () {
      final layer1 = LayerModel.fromJson(testJson);
      final layer2 = LayerModel.fromJson(testJson);

      expect(layer1, equals(layer2));
    });
  });

  group('PrizeModel Tests', () {
    final testJson = {
      'prize_id': 'test-prize-id',
      'campaign_id': 'test-campaign-id',
      'name': 'Grand Prize',
      'description': 'Amazing prize',
      'rank': 1,
      'quantity': 1,
      'image_url': 'https://example.com/prize.jpg',
    };

    test('should create PrizeModel from JSON', () {
      final prize = PrizeModel.fromJson(testJson);

      expect(prize.prizeId, equals('test-prize-id'));
      expect(prize.campaignId, equals('test-campaign-id'));
      expect(prize.name, equals('Grand Prize'));
      expect(prize.description, equals('Amazing prize'));
      expect(prize.rank, equals(1));
      expect(prize.quantity, equals(1));
      expect(prize.imageUrl, equals('https://example.com/prize.jpg'));
    });

    test('should handle null optional fields', () {
      final jsonWithNulls = {
        'prize_id': 'test-prize-id',
        'campaign_id': 'test-campaign-id',
        'name': 'Prize',
        'description': null,
        'rank': 1,
        'quantity': 1,
        'image_url': null,
      };

      final prize = PrizeModel.fromJson(jsonWithNulls);

      expect(prize.description, isNull);
      expect(prize.imageUrl, isNull);
    });
  });
}
