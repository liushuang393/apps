# Firebase 配置指南

## 问题说明

当前应用使用的是演示Firebase配置,无法进行真实的用户认证。需要配置真实的Firebase项目才能完成测试。

## 故障排除

### "Failed to parse private key: Error: Too few bytes to read ASN.1 value"

**原因**: `.env` 文件中的私钥格式不正确，通常是因为换行符丢失或未正确转义。

**解决**:
1. 打开 `.env` 文件。
2. 确保私钥包含 `-----BEGIN PRIVATE KEY-----` 和 `-----END PRIVATE KEY-----`。
3. 确保私钥是**单行**字符串，原来的换行符替换为 `\n`。
4. 整个私钥值用双引号包裹。

示例:
```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"
```

## 快速解决方案: 使用Firebase Emulator (推荐)

### 1. 安装Firebase CLI

```powershell
npm install -g firebase-tools
```

### 2. 登录Firebase

```powershell
firebase login
```

### 3. 初始化Firebase项目

在项目根目录执行:

```powershell
cd d:\apps\TriPrize
firebase init
```

选择以下选项:
- ✅ Emulators
- ✅ Authentication Emulator
- ✅ Firestore Emulator (可选)

### 4. 配置Emulator端口

编辑 `firebase.json`:

```json
{
  "emulators": {
    "auth": {
      "port": 9099
    },
    "firestore": {
      "port": 8080
    },
    "ui": {
      "enabled": true,
      "port": 4000
    }
  }
}
```

### 5. 启动Emulator

```powershell
firebase emulators:start
```

### 6. 更新应用配置连接到Emulator

编辑 `mobile/lib/main.dart`,在Firebase初始化后添加:

```dart
// 在开发环境使用Firebase Emulator
if (kDebugMode) {
  await FirebaseAuth.instance.useAuthEmulator('localhost', 9099);
}
```

### 7. 重新启动应用

```powershell
cd mobile
flutter run -d chrome --web-port=8888
```

---

## 完整解决方案: 配置真实Firebase项目

### 步骤1: 创建Firebase项目

1. 访问 [Firebase Console](https://console.firebase.google.com/)
2. 点击"添加项目"
3. 输入项目名称: `triprize-prod` (或其他名称)
4. 选择是否启用Google Analytics (可选)
5. 创建项目

### 步骤2: 启用Authentication

1. 在Firebase Console中,选择你的项目
2. 点击左侧菜单的"Authentication"
3. 点击"开始使用"
4. 在"登录方法"标签页中:
   - 启用"电子邮件/密码"
   - 启用"匿名"(可选,用于测试)

### 步骤3: 注册Web应用

1. 在项目概览页面,点击"Web"图标 (</>)
2. 输入应用昵称: `TriPrize Web`
3. 不勾选"Firebase Hosting"
4. 点击"注册应用"
5. 复制配置信息

### 步骤4: 更新Web配置

编辑 `mobile/lib/firebase_options.dart`:

```dart
static const FirebaseOptions web = FirebaseOptions(
  apiKey: 'YOUR_API_KEY',              // 从Firebase Console复制
  appId: 'YOUR_APP_ID',                // 从Firebase Console复制
  messagingSenderId: 'YOUR_SENDER_ID', // 从Firebase Console复制
  projectId: 'YOUR_PROJECT_ID',        // 从Firebase Console复制
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
);
```

### 步骤5: 配置Firebase Admin SDK (后端)

1. 在Firebase Console中,点击设置图标 > 项目设置
2. 选择"服务账号"标签页
3. 点击"生成新的私钥"
4. 下载JSON文件

5. 从JSON文件中提取信息,更新 `api/.env`:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
```

**注意**: 私钥中的换行符需要保留为 `\n`

### 步骤6: 配置Android应用 (可选)

1. 在Firebase Console中,点击Android图标
2. 输入包名: `com.triprize.mobile`
3. 下载 `google-services.json`
4. 将文件放到 `mobile/android/app/` 目录

### 步骤7: 配置iOS应用 (可选)

1. 在Firebase Console中,点击iOS图标
2. 输入Bundle ID: `com.triprize.mobile`
3. 下载 `GoogleService-Info.plist`
4. 将文件放到 `mobile/ios/Runner/` 目录

### 步骤8: 重新构建应用

```powershell
# 清理构建缓存
cd mobile
flutter clean

# 重新获取依赖
flutter pub get

# 重新构建Web应用
flutter build web

# 或直接运行
flutter run -d chrome --web-port=8888
```

### 步骤9: 重启API服务器

```powershell
cd api
npm run dev
```

---

## 验证配置

### 1. 检查API日志

启动API后,应该看到:
```
✓ Firebase Admin SDK initialized
```

如果看到警告:
```
Firebase credentials not configured - running in test mode without Firebase
```
说明配置不正确。

### 2. 测试Web注册

1. 打开 http://localhost:8888
2. 选择"管理者"
3. 点击"新規登録"
4. 填写注册信息
5. 点击"登録"

如果成功,应该:
- 不显示错误信息
- 自动跳转到活动列表页面

如果失败,检查:
- 浏览器控制台的错误信息
- API服务器的日志
- Firebase Console的Authentication页面

---

## 常见问题

### Q1: "api-key-not-valid" 错误

**原因**: API密钥无效或项目ID不匹配

**解决**:
- 确认 `firebase_options.dart` 中的配置与Firebase Console一致
- 确认项目ID正确
- 重新构建应用

### Q2: "Authentication service not available" 错误

**原因**: 后端Firebase Admin SDK未初始化

**解决**:
- 检查 `api/.env` 中的Firebase配置
- 确认私钥格式正确(包含 `\n` 换行符)
- 重启API服务器

### Q3: CORS错误

**原因**: Firebase项目未授权当前域名

**解决**:
1. 在Firebase Console > Authentication > Settings
2. 在"授权域名"中添加 `localhost`

---

## 推荐配置

### 开发环境
- 使用 **Firebase Emulator** (免费,本地运行)
- 优点: 快速,可重置,无网络依赖

### 测试环境
- 使用 **真实Firebase项目** (免费套餐)
- 优点: 真实环境,可以测试所有功能

### 生产环境
- 使用 **真实Firebase项目** (付费套餐)
- 启用安全规则
- 配置备份
- 监控和日志

---

## 下一步

配置完成后:

1. ✅ 重新运行测试
2. ✅ 完成Web浏览器测试
3. ✅ 完成iOS测试
4. ✅ 完成Android测试
5. ✅ 整理测试结果
6. ✅ 准备上线

---

**需要帮助?**

查看官方文档:
- [Firebase Web Setup](https://firebase.google.com/docs/web/setup)
- [Firebase Admin SDK Setup](https://firebase.google.com/docs/admin/setup)
- [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite)

