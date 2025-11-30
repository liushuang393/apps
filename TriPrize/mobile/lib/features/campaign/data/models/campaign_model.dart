import 'package:equatable/equatable.dart';

/// Campaign model
class CampaignModel extends Equatable {
  final String campaignId;
  final String name;
  final String? description;
  final int baseLength;
  final int positionsTotal;
  final int positionsSold;
  final double progressPercent;
  final int minPrice;
  final int maxPrice;
  final String status;
  final DateTime? endDate;
  final DateTime createdAt;

  const CampaignModel({
    required this.campaignId,
    required this.name,
    required this.baseLength, required this.positionsTotal, required this.positionsSold, required this.progressPercent, required this.minPrice, required this.maxPrice, required this.status, required this.createdAt, this.description,
    this.endDate,
  });

  factory CampaignModel.fromJson(Map<String, dynamic> json) {
    return CampaignModel(
      campaignId: json['campaign_id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      baseLength: json['base_length'] as int,
      positionsTotal: json['positions_total'] as int,
      positionsSold: json['positions_sold'] as int,
      progressPercent: (json['progress_percent'] as num).toDouble(),
      minPrice: json['min_price'] as int,
      maxPrice: json['max_price'] as int,
      status: json['status'] as String,
      endDate: json['end_date'] != null
          ? DateTime.parse(json['end_date'] as String)
          : null,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'campaign_id': campaignId,
      'name': name,
      'description': description,
      'base_length': baseLength,
      'positions_total': positionsTotal,
      'positions_sold': positionsSold,
      'progress_percent': progressPercent,
      'min_price': minPrice,
      'max_price': maxPrice,
      'status': status,
      'end_date': endDate?.toIso8601String(),
      'created_at': createdAt.toIso8601String(),
    };
  }

  @override
  List<Object?> get props => [
        campaignId,
        name,
        description,
        baseLength,
        positionsTotal,
        positionsSold,
        progressPercent,
        minPrice,
        maxPrice,
        status,
        endDate,
        createdAt,
      ];
}

/// Campaign detail model
class CampaignDetailModel extends Equatable {
  final String campaignId;
  final String name;
  final String? description;
  final int baseLength;
  final int positionsTotal;
  final int positionsSold;
  final Map<String, int> layerPrices;
  final double profitMarginPercent;
  final int? purchaseLimit;
  final DateTime? startDate;
  final DateTime? endDate;
  final String status;
  final DateTime createdAt;
  final DateTime updatedAt;
  final List<LayerModel> layers;
  final List<PrizeModel> prizes;

  const CampaignDetailModel({
    required this.campaignId,
    required this.name,
    required this.baseLength, required this.positionsTotal, required this.positionsSold, required this.layerPrices, required this.profitMarginPercent, required this.status, required this.createdAt, required this.updatedAt, required this.layers, required this.prizes, this.description,
    this.purchaseLimit,
    this.startDate,
    this.endDate,
  });

  factory CampaignDetailModel.fromJson(Map<String, dynamic> json) {
    return CampaignDetailModel(
      campaignId: json['campaign_id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      baseLength: json['base_length'] as int,
      positionsTotal: json['positions_total'] as int,
      positionsSold: json['positions_sold'] as int,
      layerPrices: (json['layer_prices'] as Map<String, dynamic>)
          .map((k, v) => MapEntry(k, v as int)),
      profitMarginPercent: (json['profit_margin_percent'] as num).toDouble(),
      purchaseLimit: json['purchase_limit'] as int?,
      startDate: json['start_date'] != null
          ? DateTime.parse(json['start_date'] as String)
          : null,
      endDate: json['end_date'] != null
          ? DateTime.parse(json['end_date'] as String)
          : null,
      status: json['status'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
      updatedAt: DateTime.parse(json['updated_at'] as String),
      layers: (json['layers'] as List<dynamic>)
          .map((e) => LayerModel.fromJson(e as Map<String, dynamic>))
          .toList(),
      prizes: (json['prizes'] as List<dynamic>)
          .map((e) => PrizeModel.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  @override
  List<Object?> get props => [
        campaignId,
        name,
        description,
        baseLength,
        positionsTotal,
        positionsSold,
        layerPrices,
        profitMarginPercent,
        purchaseLimit,
        startDate,
        endDate,
        status,
        createdAt,
        updatedAt,
        layers,
        prizes,
      ];
}

/// Layer model
class LayerModel extends Equatable {
  final String layerId;
  final String campaignId;
  final int layerNumber;
  final int positionsCount;
  final int positionsSold;
  final int price;

  const LayerModel({
    required this.layerId,
    required this.campaignId,
    required this.layerNumber,
    required this.positionsCount,
    required this.positionsSold,
    required this.price,
  });

  factory LayerModel.fromJson(Map<String, dynamic> json) {
    return LayerModel(
      layerId: json['layer_id'] as String,
      campaignId: json['campaign_id'] as String,
      layerNumber: json['layer_number'] as int,
      positionsCount: json['positions_count'] as int,
      positionsSold: json['positions_sold'] as int,
      price: json['price'] as int,
    );
  }

  @override
  List<Object?> get props => [
        layerId,
        campaignId,
        layerNumber,
        positionsCount,
        positionsSold,
        price,
      ];
}

/// Prize model
class PrizeModel extends Equatable {
  final String prizeId;
  final String campaignId;
  final String name;
  final String? description;
  final int rank;
  final int quantity;
  final String? imageUrl;

  const PrizeModel({
    required this.prizeId,
    required this.campaignId,
    required this.name,
    required this.rank, required this.quantity, this.description,
    this.imageUrl,
  });

  factory PrizeModel.fromJson(Map<String, dynamic> json) {
    return PrizeModel(
      prizeId: json['prize_id'] as String,
      campaignId: json['campaign_id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      rank: json['rank'] as int,
      quantity: json['quantity'] as int,
      imageUrl: json['image_url'] as String?,
    );
  }

  @override
  List<Object?> get props => [
        prizeId,
        campaignId,
        name,
        description,
        rank,
        quantity,
        imageUrl,
      ];
}
