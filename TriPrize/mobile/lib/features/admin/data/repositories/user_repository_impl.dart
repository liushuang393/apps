import '../../domain/repositories/user_repository.dart';
import '../datasources/user_remote_datasource.dart';
import '../models/user_model.dart';

/// ユーザーリポジトリ実装
/// 目的: UserRepositoryインターフェースの具体的な実装
class UserRepositoryImpl implements UserRepository {
  final UserRemoteDataSource remoteDataSource;

  UserRepositoryImpl({required this.remoteDataSource});

  @override
  Future<List<UserModel>> getUsers({int? limit, int? offset}) async {
    return await remoteDataSource.getUsers(limit: limit, offset: offset);
  }

  @override
  Future<UserModel> updateUserRole(String userId, String role) async {
    return await remoteDataSource.updateUserRole(userId, role);
  }

  @override
  Future<UserModel> updateAddress({
    required String postalCode,
    required String prefecture,
    required String city,
    required String addressLine1,
    String? addressLine2,
  }) async {
    return await remoteDataSource.updateAddress(
      postalCode: postalCode,
      prefecture: prefecture,
      city: city,
      addressLine1: addressLine1,
      addressLine2: addressLine2,
    );
  }
}
