import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../utils/logger.dart';
import '../services/mock_auth_service.dart';

/// Authentication interceptor to add Firebase ID token to requests
class AuthInterceptor extends Interceptor {
  final FirebaseAuth _firebaseAuth = FirebaseAuth.instance;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    try {
      // Get current user
      final user = _firebaseAuth.currentUser;

      if (user != null) {
        String? idToken;

        // Check if using mock authentication
        if (MockAuthService.isEnabled) {
          // Use mock token
          idToken = MockAuthService.generateMockToken(user.email ?? 'test@example.com');
          AppLogger.debug('Added mock auth token to request');
        } else {
          // Get Firebase ID token
          idToken = await user.getIdToken();
          AppLogger.debug('Added Firebase ID token to request');
        }

        // Add Authorization header
        options.headers['Authorization'] = 'Bearer $idToken';
            }
    } catch (e) {
      AppLogger.error('Failed to get auth token', e);
      // Continue without token - let the server handle unauthorized requests
    }

    super.onRequest(options, handler);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    // Handle 401 Unauthorized - token might be expired
    if (err.response?.statusCode == 401) {
      try {
        final user = _firebaseAuth.currentUser;

        if (user != null) {
          AppLogger.info('Token expired, refreshing...');

          // Force token refresh
          final newIdToken = await user.getIdToken(true);

          if (newIdToken != null) {
            // Retry the request with new token
            final opts = Options(
              method: err.requestOptions.method,
              headers: {
                ...err.requestOptions.headers,
                'Authorization': 'Bearer $newIdToken',
              },
            );

            final cloneReq = await Dio().request(
              err.requestOptions.path,
              options: opts,
              data: err.requestOptions.data,
              queryParameters: err.requestOptions.queryParameters,
            );

            return handler.resolve(cloneReq);
          }
        }
      } catch (e) {
        AppLogger.error('Failed to refresh token', e);
      }
    }

    super.onError(err, handler);
  }
}
