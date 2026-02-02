import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../../core/utils/logger.dart';
import '../providers/auth_provider.dart';
import 'login_page.dart';
import 'register_page.dart';

/// 役割選択画面（改善版）
/// 目的: ユーザーに直接ログイン/登録画面を表示、管理者が存在しない場合のみ右上に管理者ボタンを表示
/// I/O: ログイン/登録画面を直接表示、管理者登録が必要な場合のみ右上ボタンからアクセス可能
/// 注意点: DBに管理者データがある場合は管理者ボタンを非表示
class RoleSelectionPage extends StatefulWidget {
  const RoleSelectionPage({super.key});

  @override
  State<RoleSelectionPage> createState() => _RoleSelectionPageState();
}

class _RoleSelectionPageState extends State<RoleSelectionPage>
    with SingleTickerProviderStateMixin {
  bool _hasAdmin = false;
  bool _isCheckingAdmin = true;
  late TabController _tabController;
  String? _registerPageInitialRole; // 登録ページの初期ロール

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _checkAdminExists();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  /// 管理者が存在するかチェック
  /// 目的: DBに管理者データがあるか確認
  /// I/O: 管理者の存在有無を返す
  /// 注意点: エラー時はセキュリティのため管理者が存在すると仮定
  Future<void> _checkAdminExists() async {
    final authProvider = context.read<AuthProvider>();
    try {
      final hasAdmin = await authProvider.checkAdminExists();
      AppLogger.info('管理者チェック結果: hasAdmin=$hasAdmin');
      if (mounted) {
        setState(() {
          _hasAdmin = hasAdmin;
          _isCheckingAdmin = false;
        });
        AppLogger.info('管理者ボタン表示状態: ${!_hasAdmin ? "表示" : "非表示"}');
      }
    } catch (e, stackTrace) {
      AppLogger.error('管理者チェックエラー', e, stackTrace);
      if (mounted) {
        setState(() {
          _hasAdmin = true; // エラー時はセキュリティのため管理者が存在すると仮定
          _isCheckingAdmin = false;
        });
        AppLogger.info('エラー時の管理者ボタン表示状態: 非表示（エラーのため）');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      body: SafeArea(
        child: Stack(
          children: [
            // メインコンテンツ: ログイン/登録タブ
            Column(
              children: [
                // タブバー
                TabBar(
                  controller: _tabController,
                  labelColor: AppTheme.primaryColor,
                  unselectedLabelColor: AppTheme.textSecondaryColor,
                  indicatorColor: AppTheme.primaryColor,
                  tabs: const [
                    Tab(text: 'ログイン'),
                    Tab(text: '新規登録'),
                  ],
                ),
                // タブビュー
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      const LoginPage(showAppBar: false),
                      RegisterPage(
                        key: ValueKey(_registerPageInitialRole),
                        showAppBar: false,
                        initialRole: _registerPageInitialRole,
                      ),
                    ],
                  ),
                ),
              ],
            ),
            // 右上の管理者ボタン（管理者が存在しない場合のみ表示）
            if (!_isCheckingAdmin && !_hasAdmin)
              Positioned(
                top: 8,
                right: 8,
                child: _buildAdminButton(context),
              ),
          ],
        ),
      ),
    );
  }

  /// 右上の小さな管理者ボタンを構築
  /// 目的: 管理者が存在しない場合のみ表示される小さなボタン
  /// I/O: タップで管理者登録画面に遷移
  Widget _buildAdminButton(BuildContext context) {
    return Container(
      margin: const EdgeInsets.all(8),
      child: Material(
        color: AppTheme.primaryColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          onTap: () {
            // 管理者登録画面に遷移（タブを登録タブに切り替え、管理者ロールを自動選択）
            setState(() {
              _registerPageInitialRole = 'admin';
            });
            _tabController.animateTo(1);
          },
          borderRadius: BorderRadius.circular(20),
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.admin_panel_settings,
                  size: 16,
                  color: AppTheme.primaryColor,
                ),
                SizedBox(width: 4),
                Text(
                  '管理者',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.primaryColor,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
