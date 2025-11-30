plugins {
    id("com.android.application")
    // START: FlutterFire Configuration
    id("com.google.gms.google-services")
    // END: FlutterFire Configuration
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.triprizeshuang.triprizeMobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        // Application ID: com.triprizeshuang.triprizeMobile
        // 目的: Androidアプリの一意の識別子
        // 注意点: 本番環境では適切なApplication IDを設定済み
        applicationId = "com.triprizeshuang.triprizeMobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // 署名設定: 本番環境では適切な署名キーを設定する必要があります
            // 目的: リリースビルド用の署名設定
            // 注意点: 現在はデバッグキーを使用しています。本番環境では以下の手順で設定してください:
            // 1. keystoreファイルを作成: keytool -genkey -v -keystore ~/upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
            // 2. android/key.propertiesファイルを作成してkeystore情報を設定
            // 3. android/app/build.gradle.ktsでkey.propertiesを読み込み、signingConfigを設定
            // 詳細: https://docs.flutter.dev/deployment/android#signing-the-app
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}
