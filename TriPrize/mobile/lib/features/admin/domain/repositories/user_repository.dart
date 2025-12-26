import '../../data/models/user_model.dart';

/// ユーザーリポジトリインターフェース
/// 目的: ユーザー情報の取得・更新を抽象化
abstract class UserRepository {
  /// ユーザー一覧を取得
  Future<List<UserModel>> getUsers({int? limit, int? offset});

  /// ユーザーの役割を更新（管理者用）
  Future<UserModel> updateUserRole(String userId, String role);

  /// 配送先住所を更新
  /// 目的: ユーザーの配送先住所を登録・更新
  Future<UserModel> updateAddress({
    required String postalCode,
    required String prefecture,
    required String city,
    required String addressLine1,
    String? addressLine2,
  });
}
