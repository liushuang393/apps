import 'package:flutter/material.dart';
import '../../features/admin/presentation/pages/admin_dashboard_page.dart';
import '../../features/campaign/presentation/pages/campaign_list_page.dart';

/// 导航サービス
/// 目的: ユーザーの役割に応じた画面遷移を一元管理
/// I/O: ユーザーロールに基づいて適切なホーム画面への遷移を提供
/// 注意点: 管理者と顧客で異なるホーム画面を持つ
class NavigationService {
  /// 現在のユーザーロールを保持
  static String _currentUserRole = 'customer';

  /// ユーザーロールを設定
  /// 目的: ログイン時にユーザーロールを記録
  static void setUserRole(String role) {
    _currentUserRole = role;
  }

  /// 現在のユーザーロールを取得
  static String get currentUserRole => _currentUserRole;

  /// 管理者かどうかを判定
  static bool get isAdmin => _currentUserRole == 'admin';

  /// ユーザーロールに応じたホーム画面を取得
  /// 目的: 管理者はダッシュボード、顧客はキャンペーン一覧
  static Widget getHomePageForRole([String? role]) {
    final targetRole = role ?? _currentUserRole;
    if (targetRole == 'admin') {
      return const AdminDashboardPage();
    }
    return const CampaignListPage();
  }

  /// ホーム画面へ遷移（全スタッククリア）
  /// 目的: 支払い完了後などにホーム画面に戻る
  /// 注意点: 管理者は管理ダッシュボード、顧客はキャンペーン一覧へ
  static void navigateToHome(BuildContext context, {String? role}) {
    final homePage = getHomePageForRole(role);
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (context) => homePage),
      (route) => false,
    );
  }

  /// ホーム画面へ戻る（可能な場合はpop、無理な場合はpushAndRemoveUntil）
  /// 目的: 画面スタックに応じた最適な戻り方を提供
  static void returnToHome(BuildContext context, {String? role}) {
    // スタックに戻れる画面がある場合はpopToFirst、なければnavigate
    if (Navigator.of(context).canPop()) {
      // ルートまでpop
      Navigator.of(context).popUntil((route) => route.isFirst);
    } else {
      navigateToHome(context, role: role);
    }
  }

  /// ログイン画面へ遷移（全スタッククリア）
  /// 目的: ログアウト時にログイン画面へ戻る
  static void navigateToLogin(BuildContext context) {
    Navigator.of(context).pushNamedAndRemoveUntil('/', (route) => false);
  }
}

