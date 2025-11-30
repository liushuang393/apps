import '../../../../core/network/api_client.dart';
import '../../../../core/utils/logger.dart';
import '../models/user_model.dart';

/// User remote data source interface
abstract class UserRemoteDataSource {
  Future<List<UserModel>> getUsers({int? limit, int? offset});
  Future<UserModel> updateUserRole(String userId, String role);
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
}
