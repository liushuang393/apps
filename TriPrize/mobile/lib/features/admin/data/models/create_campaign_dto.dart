/// DTO for creating a new campaign
/// 目的: キャンペーン作成時のデータ転送オブジェクト
/// 注意点:
///   - prizes は後端で layer_names/layer_prices から自動生成されるため、空リストで送信可
///   - manualTicketPrice が設定されている場合、自動計算値より優先される
class CreateCampaignDto {
  final String name;
  final String? description;
  final int baseLength;
  final Map<String, int> layerPrices;
  final Map<String, String> layerNames; // 各層の賞品名
  final double profitMarginPercent;
  final int? purchaseLimit;
  final DateTime? startDate;
  final DateTime? endDate;
  // 手動設定の抽選価格（円）- 未設定は自動計算を使用
  final int? manualTicketPrice;
  // 賞品リスト（後端で自動生成されるため、通常は空リスト）
  final List<CreatePrizeDto> prizes;

  const CreateCampaignDto({
    required this.name,
    required this.baseLength,
    required this.layerPrices,
    required this.layerNames,
    required this.profitMarginPercent,
    this.prizes = const [], // デフォルトは空リスト
    this.description,
    this.purchaseLimit,
    this.startDate,
    this.endDate,
    this.manualTicketPrice,
  });

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{
      'name': name,
      'base_length': baseLength,
      'layer_prices': layerPrices,
      'layer_names': layerNames,
      'profit_margin_percent': profitMarginPercent,
      'prizes': prizes.map((p) => p.toJson()).toList(),
    };
    // null値を除外（Zodバリデーションで問題になるため）
    if (description != null) json['description'] = description;
    if (purchaseLimit != null) json['purchase_limit'] = purchaseLimit;
    if (startDate != null) json['start_date'] = startDate!.toIso8601String();
    if (endDate != null) json['end_date'] = endDate!.toIso8601String();
    if (manualTicketPrice != null) json['manual_ticket_price'] = manualTicketPrice;
    return json;
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
    final json = <String, dynamic>{
      'name': name,
      'rank': rank,
      'quantity': quantity,
      'value': value,
    };
    // null値を除外（Zodバリデーションで問題になるため）
    if (description != null) json['description'] = description;
    if (imageUrl != null) json['image_url'] = imageUrl;
    return json;
  }
}
