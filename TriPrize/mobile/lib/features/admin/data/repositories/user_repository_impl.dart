import '../../domain/repositories/user_repository.dart';
import '../datasources/user_remote_datasource.dart';
import '../models/user_model.dart';

/// User repository implementation
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
}
