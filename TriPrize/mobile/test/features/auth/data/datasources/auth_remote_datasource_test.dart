import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/mockito.dart';
import 'package:mockito/annotations.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:dio/dio.dart';
import 'package:triprize_mobile/features/auth/data/datasources/auth_remote_datasource.dart';
import 'package:triprize_mobile/core/network/api_client.dart';

@GenerateMocks([ApiClient, FirebaseAuth, User, UserCredential])
import 'auth_remote_datasource_test.mocks.dart';

/// Helper to create mock Response
Response<T> _mockResponse<T>(T data, {int statusCode = 200}) {
  return Response<T>(
    data: data,
    statusCode: statusCode,
    requestOptions: RequestOptions(path: ''),
  );
}

void main() {
  // Ensure Flutter binding is initialized for Firebase mocking
  TestWidgetsFlutterBinding.ensureInitialized();

  late AuthRemoteDataSourceImpl dataSource;
  late MockApiClient mockApiClient;
  late MockFirebaseAuth mockFirebaseAuth;
  late MockUser mockUser;
  late MockUserCredential mockUserCredential;

  setUp(() {
    mockApiClient = MockApiClient();
    mockFirebaseAuth = MockFirebaseAuth();
    mockUser = MockUser();
    mockUserCredential = MockUserCredential();

    dataSource = AuthRemoteDataSourceImpl(
      apiClient: mockApiClient,
      firebaseAuth: mockFirebaseAuth,
    );

    // Default mock setup for Firebase Auth methods
    when(mockFirebaseAuth.createUserWithEmailAndPassword(email: anyNamed('email'), password: anyNamed('password')))
        .thenAnswer((_) async => mockUserCredential);
    when(mockFirebaseAuth.signInWithEmailAndPassword(email: anyNamed('email'), password: anyNamed('password')))
        .thenAnswer((_) async => mockUserCredential);
    when(mockFirebaseAuth.signOut()).thenAnswer((_) async => Future.value(null));
    when(mockFirebaseAuth.currentUser).thenReturn(mockUser); // Default current user

    // Default mock setup for MockUser
    when(mockUser.uid).thenReturn('test-user-id');
    when(mockUser.email).thenReturn('test@example.com');
    when(mockUser.displayName).thenReturn('Test User');
    when(mockUser.getIdToken()).thenAnswer((_) async => 'fake-firebase-id-token'); // Mock ID token
    when(mockUser.updateDisplayName(any)).thenAnswer((_) async {});

    // Default mock setup for MockUserCredential
    when(mockUserCredential.user).thenReturn(mockUser);
  });

  tearDown(() {
    // Reset mocks after each test
    reset(mockApiClient);
    reset(mockFirebaseAuth);
    reset(mockUser);
    reset(mockUserCredential);
  });

  group('AuthRemoteDataSource - Register', () {
    const email = 'newuser@example.com';
    const password = 'password123';
    const displayName = 'New User';
    const fakeIdToken = 'fake-firebase-id-token';

    test('should call POST /api/auth/register when registering new user', () async {
      // Arrange
      when(mockApiClient.post(any, data: anyNamed('data'))).thenAnswer((_) async => _mockResponse({
        'success': true,
        'user_id': 'test-user-id',
      }));

      // Act
      final result = await dataSource.register(email, password, displayName);

      // Assert
      expect(result, isA<User>());
      expect(result.uid, 'test-user-id');
      verify(mockFirebaseAuth.createUserWithEmailAndPassword(email: email, password: password)).called(1);
      verify(mockUser.updateDisplayName(displayName)).called(1);
      verify(mockUser.getIdToken()).called(1);
      verify(mockApiClient.post(
        '/api/auth/register',
        data: {
          'firebase_token': fakeIdToken,
          'email': email,
          'display_name': displayName,
        },
      )).called(1);
    });

    test('should throw exception if backend API POST /api/auth/register fails', () async {
      // Arrange
      when(mockApiClient.post(any, data: anyNamed('data'))).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/api/auth/register'),
        response: Response(
          data: {'message': 'Backend error'},
          statusCode: 500,
          requestOptions: RequestOptions(path: '/api/auth/register'),
        ),
      ));

      // Act & Assert
      try {
        await dataSource.register(email, password, displayName);
        fail('Expected an exception to be thrown');
      } catch (e) {
        expect(e, isA<Exception>());
      }

      // Verify API was called before throwing
      verify(mockApiClient.post(any, data: anyNamed('data'))).called(1);
    });

    // Firebase specific error handling tests
    test('should handle Firebase email-already-in-use error', () async {
      when(mockFirebaseAuth.createUserWithEmailAndPassword(email: anyNamed('email'), password: anyNamed('password')))
          .thenThrow(FirebaseAuthException(code: 'email-already-in-use', message: 'Email in use'));
      
      expect(
        () async => dataSource.register(email, password, displayName),
        throwsA(predicate((e) => e is Exception && e.toString().contains('An account with this email already exists'))),
      );
    });

    test('should handle Firebase weak-password error', () async {
      when(mockFirebaseAuth.createUserWithEmailAndPassword(email: anyNamed('email'), password: anyNamed('password')))
          .thenThrow(FirebaseAuthException(code: 'weak-password', message: 'Password is too weak'));
      
      expect(
        () async => dataSource.register(email, password, displayName),
        throwsA(predicate((e) => e is Exception && e.toString().contains('The password is too weak'))),
      );
    });
  });

  group('AuthRemoteDataSource - Login', () {
    const email = 'user@example.com';
    const password = 'password123';
    const fakeIdToken = 'fake-firebase-id-token';

    test('should call POST /api/auth/login after successful login', () async {
      // Arrange
      when(mockApiClient.post(any, data: anyNamed('data'))).thenAnswer((_) async => _mockResponse({'success': true}));

      // Act
      final result = await dataSource.login(email, password);

      // Assert
      expect(result, isA<User>());
      expect(result.uid, 'test-user-id');
      verify(mockFirebaseAuth.signInWithEmailAndPassword(email: email, password: password)).called(1);
      verify(mockUser.getIdToken()).called(1);
      verify(mockApiClient.post(
        '/api/auth/login',
        data: {
          'firebase_token': fakeIdToken,
        },
      )).called(1);
    });

    test('should throw exception if backend API POST /api/auth/login fails', () async {
      // Arrange
      when(mockApiClient.post(any, data: anyNamed('data'))).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/api/auth/login'),
        response: Response(
          data: {'message': 'Backend error'},
          statusCode: 500,
          requestOptions: RequestOptions(path: '/api/auth/login'),
        ),
      ));

      // Act & Assert
      try {
        await dataSource.login(email, password);
        fail('Expected an exception to be thrown');
      } catch (e) {
        expect(e, isA<Exception>());
      }

      // Verify API was called before throwing
      verify(mockApiClient.post(any, data: anyNamed('data'))).called(1);
    });

    // Firebase specific error handling tests
    test('should handle Firebase user-not-found error', () async {
      when(mockFirebaseAuth.signInWithEmailAndPassword(email: anyNamed('email'), password: anyNamed('password')))
          .thenThrow(FirebaseAuthException(code: 'user-not-found', message: 'No user'));
      
      expect(
        () async => dataSource.login(email, password),
        throwsA(predicate((e) => e is Exception && e.toString().contains('No user found with this email'))),
      );
    });

    test('should handle Firebase wrong-password error', () async {
      when(mockFirebaseAuth.signInWithEmailAndPassword(email: anyNamed('email'), password: anyNamed('password')))
          .thenThrow(FirebaseAuthException(code: 'wrong-password', message: 'Wrong password'));
      
      expect(
        () async => dataSource.login(email, password),
        throwsA(predicate((e) => e is Exception && e.toString().contains('Incorrect password'))),
      );
    });
  });

  group('AuthRemoteDataSource - Logout', () {
    test('should successfully logout from Firebase', () async {
      // Arrange
      when(mockFirebaseAuth.signOut()).thenAnswer((_) async {});

      // Act
      await dataSource.logout();

      // Assert
      verify(mockFirebaseAuth.signOut()).called(1);
    });

    test('should handle logout failure', () async {
      // Arrange
      when(mockFirebaseAuth.signOut()).thenThrow(Exception('Logout failed'));

      // Act & Assert
      expect(() async => dataSource.logout(), throwsException);
    });
  });

  group('AuthRemoteDataSource - Get Current User', () {
    test('should return current user from Firebase', () async {
      // Arrange
      when(mockFirebaseAuth.currentUser).thenReturn(mockUser);

      // Act
      final user = await dataSource.getCurrentUser();

      // Assert
      expect(user, mockUser);
    });

    test('should return null when no user is logged in', () async {
      // Arrange
      when(mockFirebaseAuth.currentUser).thenReturn(null);

      // Act
      final user = await dataSource.getCurrentUser();

      // Assert
      expect(user, isNull);
    });
  });



  // Removed AuthRemoteDataSource - Integration Scenarios group as tests have been updated
  // Removed AuthRemoteDataSource - P0 Issue Documentation group as issues are resolved
}
