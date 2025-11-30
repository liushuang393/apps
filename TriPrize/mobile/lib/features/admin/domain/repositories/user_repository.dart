import '../../data/models/user_model.dart';

/// User repository interface
abstract class UserRepository {
  Future<List<UserModel>> getUsers({int? limit, int? offset});
  Future<UserModel> updateUserRole(String userId, String role);
}
