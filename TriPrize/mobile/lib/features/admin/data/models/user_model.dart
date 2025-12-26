import 'package:equatable/equatable.dart';

/// 配送先住所モデル
/// 目的: ユーザーの配送先住所情報を管理
/// 注意点: 日本の住所形式に対応
class ShippingAddress extends Equatable {
  /// 郵便番号（例: 123-4567）
  final String? postalCode;
  /// 都道府県
  final String? prefecture;
  /// 市区町村
  final String? city;
  /// 町名・番地
  final String? addressLine1;
  /// 建物名・部屋番号（任意）
  final String? addressLine2;

  const ShippingAddress({
    this.postalCode,
    this.prefecture,
    this.city,
    this.addressLine1,
    this.addressLine2,
  });

  factory ShippingAddress.fromJson(Map<String, dynamic> json) {
    return ShippingAddress(
      postalCode: json['postal_code'] as String?,
      prefecture: json['prefecture'] as String?,
      city: json['city'] as String?,
      addressLine1: json['address_line1'] as String?,
      addressLine2: json['address_line2'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'postal_code': postalCode,
      'prefecture': prefecture,
      'city': city,
      'address_line1': addressLine1,
      'address_line2': addressLine2,
    };
  }

  /// 住所が設定されているかどうか
  bool get isComplete =>
      postalCode != null &&
      prefecture != null &&
      city != null &&
      addressLine1 != null;

  /// フォーマットされた住所文字列
  String get formattedAddress {
    if (!isComplete) return '';
    final parts = <String>[];
    if (postalCode != null) parts.add('〒$postalCode');
    if (prefecture != null) parts.add(prefecture!);
    if (city != null) parts.add(city!);
    if (addressLine1 != null) parts.add(addressLine1!);
    if (addressLine2 != null && addressLine2!.isNotEmpty) {
      parts.add(addressLine2!);
    }
    return parts.join(' ');
  }

  @override
  List<Object?> get props => [
        postalCode,
        prefecture,
        city,
        addressLine1,
        addressLine2,
      ];
}

/// ユーザーモデル
/// 目的: 管理者向けのユーザー情報管理
/// 注意点: 配送先住所情報を含む
class UserModel extends Equatable {
  final String userId;
  final String email;
  final String? displayName;
  final String? avatarUrl;
  final String role;
  final bool notificationEnabled;
  final int totalPurchases;
  final int totalSpent;
  final int prizesWon;
  final DateTime createdAt;
  final DateTime? lastLoginAt;
  /// 配送先住所
  final ShippingAddress? shippingAddress;

  const UserModel({
    required this.userId,
    required this.email,
    required this.role,
    required this.notificationEnabled,
    required this.totalPurchases,
    required this.totalSpent,
    required this.prizesWon,
    required this.createdAt,
    this.displayName,
    this.avatarUrl,
    this.lastLoginAt,
    this.shippingAddress,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      userId: json['user_id'] as String,
      email: json['email'] as String,
      displayName: json['display_name'] as String?,
      avatarUrl: json['avatar_url'] as String?,
      role: json['role'] as String,
      notificationEnabled: json['notification_enabled'] as bool? ?? true,
      totalPurchases: json['total_purchases'] as int? ?? 0,
      totalSpent: json['total_spent'] as int? ?? 0,
      prizesWon: json['prizes_won'] as int? ?? 0,
      createdAt: DateTime.parse(json['created_at'] as String),
      lastLoginAt: json['last_login_at'] != null
          ? DateTime.parse(json['last_login_at'] as String)
          : null,
      shippingAddress: json['shipping_address'] != null
          ? ShippingAddress.fromJson(
              json['shipping_address'] as Map<String, dynamic>)
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'user_id': userId,
      'email': email,
      'display_name': displayName,
      'avatar_url': avatarUrl,
      'role': role,
      'notification_enabled': notificationEnabled,
      'total_purchases': totalPurchases,
      'total_spent': totalSpent,
      'prizes_won': prizesWon,
      'created_at': createdAt.toIso8601String(),
      'last_login_at': lastLoginAt?.toIso8601String(),
      'shipping_address': shippingAddress?.toJson(),
    };
  }

  /// 配送先住所が設定されているか
  bool get hasShippingAddress => shippingAddress?.isComplete ?? false;

  @override
  List<Object?> get props => [
        userId,
        email,
        displayName,
        avatarUrl,
        role,
        notificationEnabled,
        totalPurchases,
        totalSpent,
        prizesWon,
        createdAt,
        lastLoginAt,
        shippingAddress,
      ];
}
