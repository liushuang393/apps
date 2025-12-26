import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';
import 'firebase_options.dart';
import 'core/di/injection.dart';
import 'core/constants/app_theme.dart';
import 'core/constants/app_config.dart';
import 'core/network/api_client.dart';
import 'core/utils/logger.dart';
import 'features/auth/presentation/pages/role_selection_page.dart';
import 'features/auth/presentation/providers/auth_provider.dart';
import 'features/campaign/presentation/providers/campaign_provider.dart';
import 'features/purchase/presentation/providers/purchase_provider.dart';
import 'features/admin/presentation/providers/user_provider.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 全体のエラーハンドリング（release モードで白画面を防ぐ）
  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
    if (kReleaseMode) {
      // Release モードではログに記録
      AppLogger.error('Flutter Error: ${details.exception}');
    }
  };

  try {
    await _initializeApp();
    runApp(const MainApp());
  } catch (e) {
    AppLogger.error('App initialization failed: $e');
    // エラー時にフォールバックUIを表示
    runApp(MaterialApp(
      home: Scaffold(
        body: Center(
          child: Text('アプリの初期化に失敗しました: $e'),
        ),
      ),
    ));
    if (kDebugMode) {
      rethrow;
    }
  }
}

/// アプリ初期化処理
/// 目的: main()からの初期化ロジック分離
Future<void> _initializeApp() async {
  // Load environment variables
  try {
    await dotenv.load(fileName: '.env');
  } catch (e) {
    AppLogger.warning('.env not found, loading example.env');
    try {
      await dotenv.load(fileName: 'example.env');
    } catch (e2) {
      AppLogger.warning('example.env also not found, using defaults');
    }
  }

  // Initialize date formatting for configured locale
  // 目的: ロケールの日付フォーマットを使用するための初期化
  await initializeDateFormatting(AppConfig.defaultLocale, null);
  AppLogger.info('Date formatting initialized for ${AppConfig.defaultLocale}');

  // Initialize Firebase
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  AppLogger.info('Firebase initialized');

  // Initialize Stripe
  // 目的: Stripeを初期化（Web/モバイル両対応）
  final stripePublishableKey = AppConfig.stripePublishableKey;
  if (stripePublishableKey.isNotEmpty) {
    try {
      Stripe.publishableKey = stripePublishableKey;
      if (kIsWeb) {
        // Web環境ではmerchanctIdentifierを設定
        await Stripe.instance.applySettings();
      }
      AppLogger.info(
          'Stripe initialized (platform: ${kIsWeb ? 'web' : 'mobile'})');
    } catch (e) {
      AppLogger.warning('Stripe initialization failed: $e');
    }
  } else {
    AppLogger.warning('Stripe publishable key not found in .env');
  }

  // Configure dependency injection
  await configureDependencies();
  AppLogger.info('Dependency injection configured');

  // Set system UI overlay style
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: Colors.white,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );

  // Lock orientation to portrait
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);
}

/// Main application widget
/// アプリ名は AppConfig から取得
class MainApp extends StatelessWidget {
  const MainApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        // ApiClient を Provider として提供（抽選結果表示などで使用）
        Provider<ApiClient>.value(value: getIt<ApiClient>()),
        ChangeNotifierProvider(
          create: (_) => getIt<AuthProvider>()..initialize(),
        ),
        ChangeNotifierProvider(
          create: (_) => getIt<CampaignProvider>(),
        ),
        ChangeNotifierProvider(
          create: (_) => getIt<PurchaseProvider>(),
        ),
        // UserProvider を Provider として提供（配送先住所編集で使用）
        ChangeNotifierProvider(
          create: (_) => getIt<UserProvider>(),
        ),
      ],
      child: MaterialApp(
        title: AppConfig.displayName,
        debugShowCheckedModeBanner: false,
        theme: AppTheme.lightTheme,
        darkTheme: AppTheme.darkTheme,
        themeMode: ThemeMode.light,
        home: const SplashScreen(),
      ),
    );
  }
}

/// Splash screen shown during app initialization
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    // Perform initialization tasks
    await Future.delayed(const Duration(seconds: 2));

    // Navigate to role selection page
    if (mounted) {
      AppLogger.info('App initialization complete');
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (context) => const RoleSelectionPage(),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.primaryColor,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // App logo
            Container(
              width: 120,
              height: 120,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(24),
              ),
              child: const Icon(
                Icons.landscape,
                size: 80,
                color: AppTheme.primaryColor,
              ),
            ),
            const SizedBox(height: 24),
            // App name (from config)
            Text(
              AppConfig.displayName,
              style: const TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 8),
            // Tagline (from config)
            Text(
              AppConfig.description,
              style: const TextStyle(
                fontSize: 16,
                color: Colors.white70,
              ),
            ),
            const SizedBox(height: 48),
            // Loading indicator
            const CircularProgressIndicator(
              valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
            ),
          ],
        ),
      ),
    );
  }
}
