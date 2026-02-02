import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';
import '../network/api_client.dart';
import '../network/auth_interceptor.dart';
import '../../features/auth/data/datasources/auth_remote_datasource.dart';
import '../../features/auth/data/repositories/auth_repository_impl.dart';
import '../../features/auth/domain/repositories/auth_repository.dart';
import '../../features/auth/domain/usecases/login_usecase.dart';
import '../../features/auth/domain/usecases/logout_usecase.dart';
import '../../features/auth/domain/usecases/register_usecase.dart';
import '../../features/campaign/data/datasources/campaign_remote_datasource.dart';
import '../../features/campaign/data/repositories/campaign_repository_impl.dart';
import '../../features/campaign/domain/repositories/campaign_repository.dart';
import '../../features/campaign/presentation/providers/campaign_provider.dart';
import '../../features/purchase/data/datasources/purchase_remote_datasource.dart';
import '../../features/purchase/data/repositories/purchase_repository_impl.dart';
import '../../features/purchase/domain/repositories/purchase_repository.dart';
import '../../features/purchase/presentation/providers/purchase_provider.dart';
import '../../features/auth/presentation/providers/auth_provider.dart';
import '../../features/admin/data/datasources/user_remote_datasource.dart';
import '../../features/admin/data/repositories/user_repository_impl.dart';
import '../../features/admin/domain/repositories/user_repository.dart';
import '../../features/admin/presentation/providers/user_provider.dart';

final GetIt getIt = GetIt.instance;

/// Configure dependency injection
@InjectableInit()
Future<void> configureDependencies() async {
  // Register API client
  getIt.registerLazySingleton<AuthInterceptor>(() => AuthInterceptor());
  getIt.registerLazySingleton<ApiClient>(
    () => ApiClient(authInterceptor: getIt<AuthInterceptor>()),
  );

  // Auth feature
  getIt.registerLazySingleton<AuthRemoteDataSource>(
    () => AuthRemoteDataSourceImpl(apiClient: getIt<ApiClient>()),
  );
  getIt.registerLazySingleton<AuthRepository>(
    () => AuthRepositoryImpl(remoteDataSource: getIt<AuthRemoteDataSource>()),
  );
  getIt.registerFactory(() => LoginUseCase(repository: getIt<AuthRepository>()));
  getIt.registerFactory(() => RegisterUseCase(repository: getIt<AuthRepository>()));
  getIt.registerFactory(() => LogoutUseCase(repository: getIt<AuthRepository>()));
  getIt.registerFactory(() => AuthProvider(
        repository: getIt<AuthRepository>(),
        authInterceptor: getIt<AuthInterceptor>(),
      ));

  // Campaign feature
  getIt.registerLazySingleton<CampaignRemoteDataSource>(
    () => CampaignRemoteDataSourceImpl(apiClient: getIt<ApiClient>()),
  );
  getIt.registerLazySingleton<CampaignRepository>(
    () => CampaignRepositoryImpl(remoteDataSource: getIt<CampaignRemoteDataSource>()),
  );
  getIt.registerFactory(() => CampaignProvider(repository: getIt<CampaignRepository>()));

  // Purchase feature
  getIt.registerLazySingleton<PurchaseRemoteDataSource>(
    () => PurchaseRemoteDataSourceImpl(apiClient: getIt<ApiClient>()),
  );
  getIt.registerLazySingleton<PurchaseRepository>(
    () => PurchaseRepositoryImpl(remoteDataSource: getIt<PurchaseRemoteDataSource>()),
  );
  getIt.registerFactory(() => PurchaseProvider(repository: getIt<PurchaseRepository>()));

  // Admin feature
  getIt.registerLazySingleton<UserRemoteDataSource>(
    () => UserRemoteDataSourceImpl(apiClient: getIt<ApiClient>()),
  );
  getIt.registerLazySingleton<UserRepository>(
    () => UserRepositoryImpl(remoteDataSource: getIt<UserRemoteDataSource>()),
  );
  getIt.registerFactory(() => UserProvider(repository: getIt<UserRepository>()));
}

/// Get dependency from service locator
T inject<T extends Object>() => getIt<T>();
