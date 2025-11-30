import 'package:equatable/equatable.dart';

/// User model for admin management
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
    };
  }

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
      ];
}
