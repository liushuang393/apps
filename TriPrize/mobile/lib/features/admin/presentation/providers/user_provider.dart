import 'package:flutter/foundation.dart';
import '../../data/models/user_model.dart';
import '../../domain/repositories/user_repository.dart';
import '../../../../core/utils/logger.dart';

/// User provider for state management
class UserProvider with ChangeNotifier {
  final UserRepository repository;

  UserProvider({required this.repository});

  // State
  List<UserModel> _users = [];
  bool _isLoading = false;
  String? _errorMessage;

  // Getters
  List<UserModel> get users => _users;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  bool get hasError => _errorMessage != null;

  /// Fetch users from API
  Future<void> fetchUsers({int? limit, int? offset}) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      AppLogger.info('Fetching users');
      _users = await repository.getUsers(
        limit: limit ?? 50,
        offset: offset ?? 0,
      );
      AppLogger.info('Successfully fetched ${_users.length} users');
      _isLoading = false;
      notifyListeners();
    } catch (e) {
      AppLogger.error('Failed to fetch users', e);
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Update user role
  Future<void> updateUserRole(String userId, String role) async {
    try {
      AppLogger.info('Updating user role: $userId to $role');
      final updatedUser = await repository.updateUserRole(userId, role);

      // Update local list
      final index = _users.indexWhere((u) => u.userId == userId);
      if (index != -1) {
        _users[index] = updatedUser;
        notifyListeners();
      }

      AppLogger.info('Successfully updated user role');
    } catch (e) {
      AppLogger.error('Failed to update user role', e);
      _errorMessage = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  /// Clear error message
  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }
}
