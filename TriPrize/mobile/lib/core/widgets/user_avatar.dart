import 'package:flutter/material.dart';
import '../constants/app_theme.dart';

/// ユーザーアバターコンポーネント
/// 目的: ユーザーのアバターを表示する（円形、名前の最初の文字、ロールバッジ付き）
/// I/O: 
///   - 入力: displayName, email, avatarUrl, role
///   - 出力: アバターウィジェット
/// 注意点: 
///   - アバターURLがある場合は画像を表示
///   - ない場合は名前の最初の文字を表示
///   - ロールバッジ（管理者/顧客）を表示
class UserAvatar extends StatelessWidget {
  /// ユーザーの表示名
  final String? displayName;
  
  /// ユーザーのメールアドレス（表示名がない場合のフォールバック）
  final String email;
  
  /// アバター画像のURL（オプション）
  final String? avatarUrl;
  
  /// ユーザーのロール（'admin' または 'customer'）
  final String role;
  
  /// アバターのサイズ（半径）
  final double radius;
  
  /// ロールバッジを表示するかどうか
  final bool showRoleBadge;
  
  /// クリック時のコールバック
  final VoidCallback? onTap;

  const UserAvatar({
    required this.email, required this.role, super.key,
    this.displayName,
    this.avatarUrl,
    this.radius = 24.0,
    this.showRoleBadge = true,
    this.onTap,
  });

  /// 名前の最初の文字を取得
  String _getInitial() {
    if (displayName != null && displayName!.isNotEmpty) {
      return displayName!.substring(0, 1).toUpperCase();
    }
    if (email.isNotEmpty) {
      return email.substring(0, 1).toUpperCase();
    }
    return '?';
  }

  /// アバターの背景色を取得（名前の最初の文字に基づく）
  Color _getAvatarColor() {
    final initial = _getInitial();
    final colors = [
      AppTheme.primaryColor,
      Colors.blue,
      Colors.green,
      Colors.orange,
      Colors.purple,
      Colors.teal,
      Colors.pink,
      Colors.indigo,
    ];
    final index = initial.codeUnitAt(0) % colors.length;
    return colors[index];
  }

  /// ロールバッジの色を取得
  Color _getRoleBadgeColor() {
    return role == 'admin' ? Colors.amber : Colors.blue;
  }

  /// ロールバッジのテキストを取得
  String _getRoleText() {
    return role == 'admin' ? '管理者' : '顧客';
  }

  /// ロールバッジのアイコンを取得
  IconData _getRoleIcon() {
    return role == 'admin' ? Icons.admin_panel_settings : Icons.person;
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // メインアバター
          CircleAvatar(
            radius: radius,
            backgroundColor: _getAvatarColor(),
            backgroundImage: avatarUrl != null && avatarUrl!.isNotEmpty
                ? NetworkImage(avatarUrl!)
                : null,
            child: avatarUrl == null || avatarUrl!.isEmpty
                ? Text(
                    _getInitial(),
                    style: TextStyle(
                      fontSize: radius * 0.8,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  )
                : null,
          ),
          // ロールバッジ
          if (showRoleBadge)
            Positioned(
              bottom: -2,
              right: -2,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: _getRoleBadgeColor(),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Colors.white,
                    width: 2,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.2),
                      blurRadius: 4,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Icon(
                  _getRoleIcon(),
                  size: radius * 0.4,
                  color: Colors.white,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// ユーザーアバター（詳細表示付き）
/// 目的: アバターと名前、ロールを一緒に表示する
class UserAvatarWithInfo extends StatelessWidget {
  /// ユーザーの表示名
  final String? displayName;
  
  /// ユーザーのメールアドレス
  final String email;
  
  /// アバター画像のURL（オプション）
  final String? avatarUrl;
  
  /// ユーザーのロール（'admin' または 'customer'）
  final String role;
  
  /// アバターのサイズ（半径）
  final double avatarRadius;
  
  /// 名前のスタイル
  final TextStyle? nameStyle;
  
  /// メールのスタイル
  final TextStyle? emailStyle;
  
  /// クリック時のコールバック
  final VoidCallback? onTap;

  const UserAvatarWithInfo({
    required this.email, required this.role, super.key,
    this.displayName,
    this.avatarUrl,
    this.avatarRadius = 28.0,
    this.nameStyle,
    this.emailStyle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return GestureDetector(
      onTap: onTap,
      child: Row(
        children: [
          // アバター
          UserAvatar(
            displayName: displayName,
            email: email,
            avatarUrl: avatarUrl,
            role: role,
            radius: avatarRadius,
            showRoleBadge: true,
          ),
          const SizedBox(width: 16),
          // 名前とメール
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  displayName ?? 'No Name',
                  style: nameStyle ?? theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  email,
                  style: emailStyle ?? theme.textTheme.bodySmall?.copyWith(
                    color: AppTheme.textSecondaryColor,
                  ),
                ),
              ],
            ),
          ),
          // ロールバッジ（テキスト）
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: role == 'admin' 
                  ? Colors.amber.withOpacity(0.2)
                  : Colors.blue.withOpacity(0.2),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: role == 'admin' ? Colors.amber : Colors.blue,
                width: 1,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  role == 'admin' ? Icons.admin_panel_settings : Icons.person,
                  size: 14,
                  color: role == 'admin' ? Colors.amber.shade700 : Colors.blue.shade700,
                ),
                const SizedBox(width: 4),
                Text(
                  role == 'admin' ? '管理者' : '顧客',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: role == 'admin' ? Colors.amber.shade700 : Colors.blue.shade700,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
