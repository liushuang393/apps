# Firebase 配置指南

本指南说明如何配置 Firebase Admin SDK，适用于**本地开发**和**生产环境**。

---

## 统一配置方式：Service Account JSON 文件

我们采用 **Service Account JSON 文件** 方式配置 Firebase Admin SDK。

**优点**：
- ✅ 本地开发和生产环境配置方式完全一致
- ✅ 不需要在 `.env` 中处理复杂的私钥格式
- ✅ JSON 文件可以直接从 Firebase Console 下载使用
- ✅ 便于管理多个环境（dev / staging / prod）

---

## 第一步：下载 Service Account JSON

1. 访问 [Firebase Console](https://console.firebase.google.com/)
2. 选择你的项目（例如：`product-triprizeweb-dev`）
3. 点击 **设置图标** ⚙️ → **项目设置**
4. 选择 **服务账号** 标签页
5. 点击 **生成新的私钥**
6. 下载 JSON 文件，重命名为环境对应的名称：
   - 开发环境：`product-triprizeweb-dev-firebase-adminsdk.json`
   - 生产环境：`product-triprizeweb-prod-firebase-adminsdk.json`
7. 将文件放到 `api/` 目录下

---

## 第二步：配置环境变量

编辑 `api/.env`，设置 JSON 文件路径：

```env
# 开发环境
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./product-triprizeweb-dev-firebase-adminsdk.json

# 生产环境（使用不同的文件）
# FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./product-triprizeweb-prod-firebase-adminsdk.json
```

---

## 第三步：配置 GCP IAM 权限（必须）

Service Account 需要正确的 IAM 权限才能调用 Firebase API。

### 方法一：使用 gcloud CLI（推荐）

#### 1. 安装 gcloud CLI

```powershell
# Windows
winget install Google.CloudSDK
```

#### 2. 登录 gcloud

```powershell
gcloud auth login
```

浏览器会打开，选择你的 Google 账户完成授权。

#### 3. 设置项目

```powershell
gcloud config set project product-triprizeweb-dev
```

#### 4. 添加必要权限

```powershell
# 添加 Service Usage Consumer 权限（必须）
gcloud projects add-iam-policy-binding product-triprizeweb-dev \
  --member="serviceAccount:firebase-adminsdk-fbsvc@product-triprizeweb-dev.iam.gserviceaccount.com" \
  --role="roles/serviceusage.serviceUsageConsumer"
```

> **注意**：`--member` 中的 Service Account 邮箱可以在 JSON 文件的 `client_email` 字段找到。

### 方法二：使用 GCP Console（备选）

1. 打开 [GCP IAM Console](https://console.cloud.google.com/iam-admin/iam)
2. 选择你的项目
3. 点击 **授予访问权限（Grant Access）**
4. **新的主账号**：输入 JSON 文件中的 `client_email`
5. **选择角色**：`Service Usage Consumer`
6. 点击 **保存**
7. 等待 1-5 分钟让权限传播

---

## 第四步：验证配置

运行诊断脚本确认配置正确：

```powershell
cd api
npx ts-node src/utils/diagnose_firebase.ts
```

**成功输出**：
```
🔍 Diagnosing Firebase Configuration...
✅ Service Account loaded successfully:
   Project ID: product-triprizeweb-dev
   Client Email: firebase-adminsdk-fbsvc@product-triprizeweb-dev.iam.gserviceaccount.com
✅ Firebase Admin SDK initialized successfully!
✅ Firebase Auth instance created successfully!
🔄 Testing actual API call (listUsers) to verify permissions...
✅ API call successful! Found 0 user(s).
🎉 All configurations and permissions are correctly set up!
```

---

## 第五步：启动服务

```powershell
cd api
npm run dev
```

启动日志应显示：
```
✓ Firebase Admin SDK initialized successfully
```

---

## 生产环境部署

生产环境使用相同的配置方式：

### Docker 部署

```dockerfile
# Dockerfile
COPY product-triprizeweb-prod-firebase-adminsdk.json /app/
ENV FIREBASE_SERVICE_ACCOUNT_KEY_PATH=/app/product-triprizeweb-prod-firebase-adminsdk.json
```

### Kubernetes 部署

```yaml
# 使用 Secret 存储 JSON 内容
apiVersion: v1
kind: Secret
metadata:
  name: firebase-credentials
type: Opaque
stringData:
  service-account.json: |
    {
      "type": "service_account",
      "project_id": "product-triprizeweb-prod",
      ...
    }
---
# 挂载到 Pod
volumes:
  - name: firebase-credentials
    secret:
      secretName: firebase-credentials
volumeMounts:
  - name: firebase-credentials
    mountPath: /secrets/firebase
    readOnly: true
env:
  - name: FIREBASE_SERVICE_ACCOUNT_KEY_PATH
    value: /secrets/firebase/service-account.json
```

### 云平台部署

- **Google Cloud Run**：使用 Secret Manager 存储 JSON
- **AWS ECS**：使用 Secrets Manager 或 Parameter Store
- **Azure**：使用 Key Vault

---

## 安全注意事项

### 1. 不要提交 JSON 文件到 Git

`.gitignore` 已配置忽略规则：
```gitignore
*-firebase-adminsdk*.json
*firebase*adminsdk*.json
serviceAccount*.json
```

### 2. 验证 JSON 文件未被追踪

```powershell
git check-ignore -v api/product-triprizeweb-dev-firebase-adminsdk.json
```

应输出类似：
```
.gitignore:19:*firebase*adminsdk*.json  api/product-triprizeweb-dev-firebase-adminsdk.json
```

### 3. 最小权限原则

只授予 Service Account 必要的权限：
- `roles/serviceusage.serviceUsageConsumer`（必须）
- `roles/firebaseauth.admin`（如需管理用户）

---

## 故障排除

### 错误：PERMISSION_DENIED / USER_PROJECT_DENIED

**原因**：Service Account 缺少 `serviceusage.services.use` 权限

**解决**：
```powershell
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/serviceusage.serviceUsageConsumer"
```

### 错误：Invalid JWT Signature

**原因**：服务器时间不同步

**解决**：
```powershell
# Windows - 检查时间同步状态
w32tm /query /status

# 强制同步
w32tm /resync
```

### 错误：Service account file not found

**原因**：JSON 文件路径错误

**解决**：
1. 确认 `.env` 中的路径正确
2. 确认 JSON 文件存在于指定位置
3. 使用相对路径时，相对于 `api/` 目录

---

## 多环境配置示例

```
api/
├── .env.development
│   └── FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./product-triprizeweb-dev-firebase-adminsdk.json
├── .env.staging
│   └── FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./product-triprizeweb-staging-firebase-adminsdk.json
├── .env.production
│   └── FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./product-triprizeweb-prod-firebase-adminsdk.json
├── product-triprizeweb-dev-firebase-adminsdk.json
├── product-triprizeweb-staging-firebase-adminsdk.json
└── product-triprizeweb-prod-firebase-adminsdk.json
```

---

## 参考文档

- [Firebase Admin SDK Setup](https://firebase.google.com/docs/admin/setup)
- [GCP IAM Roles](https://cloud.google.com/iam/docs/understanding-roles)
- [gcloud CLI Reference](https://cloud.google.com/sdk/gcloud/reference)

