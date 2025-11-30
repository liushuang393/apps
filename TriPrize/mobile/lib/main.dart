import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:provider/provider.dart';
import 'firebase_options.dart';
import 'core/di/injection.dart';
import 'core/constants/app_theme.dart';
import 'core/utils/logger.dart';
import 'features/auth/presentation/pages/role_selection_page.dart';
import 'features/auth/presentation/providers/auth_provider.dart';
import 'features/campaign/presentation/providers/campaign_provider.dart';
import 'features/purchase/presentation/providers/purchase_provider.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Load environment variables
  try {
    await dotenv.load(fileName: '.env');
  } catch (e) {
    AppLogger.warning('.env not found, loading example.env');
    await dotenv.load(fileName: 'example.env');
  }

  // Initialize Firebase
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  AppLogger.info('Firebase initialized');

  // Initialize Stripe (skip on web platform as flutter_stripe doesn't support web)
  if (!kIsWeb) {
    final stripePublishableKey = dotenv.env['STRIPE_PUBLISHABLE_KEY'];
    if (stripePublishableKey != null && stripePublishableKey.isNotEmpty) {
      Stripe.publishableKey = stripePublishableKey;
      AppLogger.info('Stripe initialized');
    } else {
      AppLogger.warning('Stripe publishable key not found in .env');
    }
  } else {
    AppLogger.info('Stripe initialization skipped (not supported on web)');
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

  runApp(const TriPrizeApp());
}

class TriPrizeApp extends StatelessWidget {
  const TriPrizeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (_) => getIt<AuthProvider>()..initialize(),
        ),
        ChangeNotifierProvider(
          create: (_) => getIt<CampaignProvider>(),
        ),
        ChangeNotifierProvider(
          create: (_) => getIt<PurchaseProvider>(),
        ),
      ],
      child: MaterialApp(
        title: 'TriPrize',
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
            // App name
            const Text(
              'TriPrize',
              style: TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 8),
            // Tagline
            const Text(
              '三角形抽選販売プラットフォーム',
              style: TextStyle(
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
