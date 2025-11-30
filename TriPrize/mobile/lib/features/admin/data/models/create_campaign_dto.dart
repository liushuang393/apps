/// DTO for creating a new campaign
class CreateCampaignDto {
  final String name;
  final String? description;
  final int baseLength;
  final Map<String, int> layerPrices;
  final double profitMarginPercent;
  final int? purchaseLimit;
  final DateTime? startDate;
  final DateTime? endDate;
  final List<CreatePrizeDto> prizes;

  const CreateCampaignDto({
    required this.name,
    required this.baseLength,
    required this.layerPrices,
    required this.profitMarginPercent,
    required this.prizes,
    this.description,
    this.purchaseLimit,
    this.startDate,
    this.endDate,
  });

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'description': description,
      'base_length': baseLength,
      'layer_prices': layerPrices,
      'profit_margin_percent': profitMarginPercent,
      'purchase_limit': purchaseLimit,
      'start_date': startDate?.toIso8601String(),
      'end_date': endDate?.toIso8601String(),
      'prizes': prizes.map((p) => p.toJson()).toList(),
    };
  }
}

/// DTO for creating a prize
class CreatePrizeDto {
  final String name;
  final String? description;
  final int rank;
  final int quantity;
  final int value; // Prize value in yen
  final String? imageUrl;

  const CreatePrizeDto({
    required this.name,
    required this.rank,
    required this.quantity,
    required this.value,
    this.description,
    this.imageUrl,
  });

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'description': description,
      'rank': rank,
      'quantity': quantity,
      'value': value,
      'image_url': imageUrl,
    };
  }
}
