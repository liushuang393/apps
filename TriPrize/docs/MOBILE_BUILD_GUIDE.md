# 📱 TriPrize 移动应用编译完整指南

**目标**: 将Flutter应用编译成可发布的iOS和Android安装包

---

## 📋 前置准备

### 通用要求
- ✅ Flutter 3.16+ 已安装
- ✅ `flutter doctor` 全部通过
- ✅ 代码已提交到Git
- ✅ 所有测试通过

### iOS要求 (仅macOS)
- ✅ macOS 12+
- ✅ Xcode 14+
- ✅ Apple Developer账户 ($99/年)
- ✅ CocoaPods已安装

### Android要求
- ✅ Android Studio已安装
- ✅ Java JDK 11+
- ✅ Google Play Console账户 ($25一次性)

---

## 🍎 iOS编译指南

### 步骤1: 准备Apple Developer账户

#### 1.1 注册Apple Developer
```
访问: https://developer.apple.com/programs/
费用: $99/年
审核时间: 1-2天
```

#### 1.2 创建App ID
```
1. 登录 https://developer.apple.com/account/
2. Certificates, IDs & Profiles → Identifiers
3. 点击 + 创建新的App ID
4. 配置:
   - Description: TriPrize
   - Bundle ID: com.yourcompany.triprize (明确)
   - Capabilities:
     ✅ Push Notifications
     ✅ Sign in with Apple
     ✅ Associated Domains (可选)
```

#### 1.3 创建Provisioning Profile
```
1. Certificates, IDs & Profiles → Profiles
2. 点击 + 创建新Profile
3. 选择: App Store
4. 选择App ID: com.yourcompany.triprize
5. 选择证书: 你的Distribution证书
6. 下载Profile文件
```

### 步骤2: 配置Xcode项目

#### 2.1 打开Xcode项目
```bash
cd D:\apps\TriPrize\mobile
open ios/Runner.xcworkspace
```

#### 2.2 配置签名
```
1. 选择 Runner 项目
2. Signing & Capabilities标签
3. Team: 选择你的Apple Developer Team
4. Bundle Identifier: com.yourcompany.triprize
5. 确保 "Automatically manage signing" 已勾选
```

#### 2.3 配置版本号
```
1. General标签
2. Identity部分:
   - Display Name: TriPrize
   - Version: 1.0.0
   - Build: 1
```

#### 2.4 配置推送通知
```
1. Signing & Capabilities标签
2. 点击 + Capability
3. 添加 "Push Notifications"
4. 添加 "Background Modes"
   - 勾选 "Remote notifications"
```

### 步骤3: 配置Firebase (iOS)

#### 3.1 下载配置文件
```
1. Firebase Console → 项目设置
2. iOS应用 → 下载 GoogleService-Info.plist
3. 拖拽到 Xcode: ios/Runner/
4. 确保 "Copy items if needed" 已勾选
5. 确保 Target 选择了 "Runner"
```

#### ⚠️ 关键检查: API Key有效性
**必须确认**: 下载的 `GoogleService-Info.plist` 中包含的 API Key 必须在 Google Cloud Console 中有效且未过期。
- 如果启用了 API Key 限制（推荐），必须将 iOS Bundle ID (`com.yourcompany.triprize`) 添加到允许列表。
- **错误症状**: 如果 Key 无效，应用启动时会白屏或崩溃 (Firebase Auth Error 400)。

#### 3.2 配置APNs证书
```
1. Xcode → Preferences → Accounts
2. 选择你的Apple ID → Download Manual Profiles
3. Firebase Console → 项目设置 → Cloud Messaging
4. iOS应用配置 → 上传APNs证书
```

### 步骤4: 构建iOS应用

#### 4.1 清理构建
```bash
cd D:\apps\TriPrize\mobile
flutter clean
flutter pub get
cd ios
pod install
cd ..
```

#### 4.2 构建Release版本
```bash
# 方式1: 使用Flutter命令
flutter build ios --release

# 方式2: 在Xcode中构建
# Product → Scheme → Runner
# Product → Destination → Any iOS Device
# Product → Archive
```

#### 4.3 验证构建
```
构建成功后会显示:
✓ Built ios/Runner.app
```

### 步骤5: 上传到App Store Connect

#### 5.1 创建应用
```
1. 访问 https://appstoreconnect.apple.com/
2. 我的App → + → 新建App
3. 配置:
   - 平台: iOS
   - 名称: TriPrize
   - 主要语言: 日语
   - Bundle ID: com.yourcompany.triprize
   - SKU: triprize-ios-001
```

#### 5.2 Archive并上传
```
1. Xcode → Product → Archive
2. 等待Archive完成
3. Window → Organizer
4. 选择最新的Archive
5. 点击 "Distribute App"
6. 选择 "App Store Connect"
7. 选择 "Upload"
8. 等待上传完成 (5-30分钟)
```

#### 5.3 提交审核
```
1. App Store Connect → 我的App → TriPrize
2. + 版本或平台 → iOS
3. 填写信息:
   - 版本号: 1.0.0
   - 新功能: 初始版本
   - 截图: 至少4张 (6.5", 5.5")
   - 描述: 应用介绍
   - 关键词: 抽奖,三角形,购物
   - 支持URL: https://your-website.com/support
   - 隐私政策URL: https://your-website.com/privacy
4. 构建版本 → 选择刚上传的版本
5. 提交审核
```

**审核时间**: 通常1-3天

---

## 🤖 Android编译指南

### 步骤1: 准备Google Play Console

#### 1.1 注册开发者账户
```
访问: https://play.google.com/console/signup
费用: $25 (一次性)
```

#### 1.2 创建应用
```
1. 登录 Google Play Console
2. 所有应用 → 创建应用
3. 配置:
   - 应用名称: TriPrize
   - 默认语言: 日语
   - 应用类型: 应用
   - 免费/付费: 免费
```

### 步骤2: 生成签名密钥

#### 2.1 创建密钥库
```bash
# Windows
cd D:\apps\TriPrize\mobile\android\app

# 生成密钥
keytool -genkey -v -keystore triprize.jks ^
  -keyalg RSA -keysize 2048 -validity 10000 ^
  -alias triprize

# 输入信息:
密钥库口令: [输入强密码,记住!]
再次输入: [再次输入]
姓名: Your Name
组织单位: Your Company
组织: Your Company
城市: Tokyo
省份: Tokyo
国家代码: JP

密钥口令: [可以与密钥库口令相同]
```

**重要**: 
- ⚠️ 保存好密钥文件和密码!
- ⚠️ 丢失密钥 = 无法更新应用!
- ⚠️ 备份到安全位置!

#### 2.2 创建key.properties
```bash
# 创建文件: android/key.properties
cd D:\apps\TriPrize\mobile\android
```

内容:
```properties
storePassword=你的密钥库密码
keyPassword=你的密钥密码
keyAlias=triprize
storeFile=app/triprize.jks
```

**重要**: 
- ⚠️ 不要提交key.properties到Git!
- ⚠️ 添加到.gitignore

### 步骤3: 配置build.gradle

#### 3.1 编辑android/app/build.gradle

在文件顶部添加:
```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

在android块中添加签名配置:
```gradle
android {
    ...
    
    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
            storePassword keystoreProperties['storePassword']
        }
    }
    
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            shrinkResources true
        }
    }
}
```

### 步骤4: 配置Firebase (Android)

#### 4.1 下载配置文件
```
1. Firebase Console → 项目设置
2. Android应用 → 下载 google-services.json
3. 复制到: android/app/google-services.json
```

#### 4.2 验证配置
```bash
# 检查文件存在
ls android/app/google-services.json
```

### 步骤5: 更新版本号

编辑 `pubspec.yaml`:
```yaml
version: 1.0.0+1
# 格式: 版本名+版本号
# 1.0.0 = versionName (用户看到的)
# 1 = versionCode (内部版本号,每次递增)
```

### 步骤6: 构建Android应用

#### 6.1 清理构建
```bash
cd D:\apps\TriPrize\mobile
flutter clean
flutter pub get
```

#### 6.2 构建APK (测试用)
```bash
# 构建Release APK
flutter build apk --release

# 输出位置:
# build/app/outputs/flutter-apk/app-release.apk
```

#### 6.3 构建App Bundle (推荐,用于发布)
```bash
# 构建Release App Bundle
flutter build appbundle --release

# 输出位置:
# build/app/outputs/bundle/release/app-release.aab
```

**App Bundle vs APK**:
- APK: 直接安装文件,体积大
- AAB: Google Play优化格式,体积小,推荐

### 步骤7: 上传到Google Play

#### 7.1 准备资源

**应用图标**:
- 512x512 PNG (高分辨率图标)

**截图** (至少2张,最多8张):
- 手机: 1080x1920 或 1440x2560
- 7寸平板: 1200x1920
- 10寸平板: 1600x2560

**宣传图** (可选):
- 1024x500

#### 7.2 上传AAB
```
1. Google Play Console → TriPrize
2. 制作 → 正式版
3. 创建新版本
4. 上传 app-release.aab
5. 填写版本说明:
   - 日语: 初回リリース
   - 英语: Initial release
```

#### 7.3 完成商店信息
```
1. 商店设置 → 主要商店信息
   - 应用名称: TriPrize
   - 简短说明: 三角形抽奖应用
   - 完整说明: [详细介绍]
   - 应用图标: 上传512x512图标
   - 宣传图: 上传1024x500图片

2. 截图
   - 手机截图: 至少2张
   - 7寸平板: 至少2张 (可选)
   - 10寸平板: 至少2张 (可选)

3. 分类
   - 应用类别: 娱乐
   - 标签: 抽奖, 游戏

4. 联系信息
   - 电子邮件: support@yourcompany.com
   - 网站: https://your-website.com
   - 隐私政策: https://your-website.com/privacy
```

#### 7.4 内容分级
```
1. 商店设置 → 应用内容 → 内容分级
2. 填写问卷
3. 获取分级 (通常: PEGI 3, ESRB Everyone)
```

#### 7.5 提交审核
```
1. 检查所有必填项
2. 点击 "审核版本"
3. 提交发布
```

**审核时间**: 通常几小时到1天

---

## 🔍 验证构建

### 关键：Release模式本地测试
发布前，**必须**在本地设备上运行 Release 版本以捕获配置错误（如 API Key 问题）。
```bash
# iOS真机测试 Release 包
flutter run --release -d [你的iPhone设备ID]

# Android真机测试 Release 包
flutter run --release
```
*注意: Release 模式不支持热重载，且调试信息较少，主要用于验证崩溃和性能。*

### iOS验证
```bash
# 检查IPA文件
unzip -l build/ios/iphoneos/Runner.app

# 验证签名
codesign -dv --verbose=4 build/ios/iphoneos/Runner.app
```

### Android验证
```bash
# 检查APK签名
jarsigner -verify -verbose -certs build/app/outputs/flutter-apk/app-release.apk

# 检查AAB内容
bundletool build-apks --bundle=build/app/outputs/bundle/release/app-release.aab --output=test.apks
```

---

## 📊 构建大小优化

### 减小iOS包大小
```bash
# 使用--split-debug-info
flutter build ios --release --split-debug-info=./debug-info

# 使用--obfuscate
flutter build ios --release --obfuscate --split-debug-info=./debug-info
```

### 减小Android包大小
```bash
# 启用代码混淆
flutter build appbundle --release --obfuscate --split-debug-info=./debug-info

# 启用资源压缩 (已在build.gradle配置)
```

---

## ✅ 发布检查清单

### iOS
- [ ] Apple Developer账户已激活
- [ ] App ID已创建
- [ ] Provisioning Profile已配置
- [ ] GoogleService-Info.plist已添加
- [ ] 版本号已更新
- [ ] Archive成功
- [ ] 上传到App Store Connect成功
- [ ] 截图已准备 (至少4张)
- [ ] 应用描述已填写
- [ ] 隐私政策URL已设置
- [ ] 提交审核

### Android
- [ ] Google Play Console账户已注册
- [ ] 签名密钥已生成并备份
- [ ] key.properties已配置
- [ ] google-services.json已添加
- [ ] 版本号已更新
- [ ] AAB构建成功
- [ ] 上传到Google Play成功
- [ ] 截图已准备 (至少2张)
- [ ] 应用描述已填写
- [ ] 内容分级已完成
- [ ] 隐私政策URL已设置
- [ ] 提交审核

---

## 🆘 常见问题

### Q1: iOS构建失败 "No signing certificate"

**解决**:
```
1. Xcode → Preferences → Accounts
2. 选择Apple ID → Download Manual Profiles
3. 或在Xcode中重新选择Team
```

### Q2: Android签名失败

**解决**:
```bash
# 检查key.properties路径
cat android/key.properties

# 检查密钥文件存在
ls android/app/triprize.jks
```

### Q3: 构建体积太大

**解决**:
```bash
# 使用代码混淆和分离调试信息
flutter build appbundle --release \
  --obfuscate \
  --split-debug-info=./debug-info
```

---

**预计时间**:
- iOS首次: 4-6小时
- Android首次: 2-4小时
- 后续更新: 1-2小时

**审核时间**:
- iOS: 1-3天
- Android: 几小时到1天

