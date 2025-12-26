import '../../../../core/network/api_client.dart';
import '../../../../core/utils/logger.dart';
import '../models/user_model.dart';

/// ユーザーリモートデータソースインターフェース
/// 目的: ユーザー情報のAPI通信を抽象化
abstract class UserRemoteDataSource {
  /// ユーザー一覧を取得
  Future<List<UserModel>> getUsers({int? limit, int? offset});

  /// ユーザーの役割を更新
  Future<UserModel> updateUserRole(String userId, String role);

  /// 配送先住所を更新
  Future<UserModel> updateAddress({
    required String postalCode,
    required String prefecture,
    required String city,
    required String addressLine1,
    String? addressLine2,
  });
}

/// User remote data source implementation
class UserRemoteDataSourceImpl implements UserRemoteDataSource {
  final ApiClient apiClient;

  UserRemoteDataSourceImpl({required this.apiClient});

  @override
  Future<List<UserModel>> getUsers({
    int? limit,
    int? offset,
  }) async {
    try {
      final queryParams = <String, dynamic>{};
      if (limit != null) queryParams['limit'] = limit;
      if (offset != null) queryParams['offset'] = offset;

      final response = await apiClient.get(
        '/api/users',
        queryParameters: queryParams,
      );

      final data = response.data as Map<String, dynamic>;
      final users = (data['data'] as List<dynamic>)
          .map((e) => UserModel.fromJson(e as Map<String, dynamic>))
          .toList();

      AppLogger.info('Fetched ${users.length} users');
      return users;
    } catch (e) {
      AppLogger.error('Failed to fetch users', e);
      throw Exception('Failed to fetch users: $e');
    }
  }

  @override
  Future<UserModel> updateUserRole(String userId, String role) async {
    try {
      final response = await apiClient.patch(
        '/api/users/$userId/role',
        data: {'role': role},
      );

      final data = response.data as Map<String, dynamic>;
      final user = UserModel.fromJson(data['data'] as Map<String, dynamic>);

      AppLogger.info('Updated user role: $userId to $role');
      return user;
    } catch (e) {
      AppLogger.error('Failed to update user role', e);
      throw Exception('Failed to update user role: $e');
    }
  }

  @override
  Future<UserModel> updateAddress({
    required String postalCode,
    required String prefecture,
    required String city,
    required String addressLine1,
    String? addressLine2,
  }) async {
    try {
      final response = await apiClient.put(
        '/api/users/me/address',
        data: {
          'postal_code': postalCode,
          'prefecture': prefecture,
          'city': city,
          'address_line1': addressLine1,
          if (addressLine2 != null) 'address_line2': addressLine2,
        },
      );

      final data = response.data as Map<String, dynamic>;
      final user = UserModel.fromJson(data['data'] as Map<String, dynamic>);

      AppLogger.info('配送先住所を更新しました');
      return user;
    } catch (e) {
      AppLogger.error('配送先住所の更新に失敗しました', e);
      throw Exception('配送先住所の更新に失敗しました: $e');
    }
  }
}
