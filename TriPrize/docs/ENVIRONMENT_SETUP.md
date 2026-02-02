# 环境变量配置说明

## 概述

本文档说明 TriPrize 项目所需的环境变量配置。

---

## 必需的环境变量

### 1. Database Configuration
```env
DB_PASSWORD=triprize_password
```
- **用途**: PostgreSQL 数据库密码
- **默认值**: `triprize_password`
- **生产环境**: 使用强密码

### 2. Firebase Configuration
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```
- **用途**: Firebase 认证和后端验证
- **获取方式**: 
  1. 访问 [Firebase Console](https://console.firebase.google.com/)
  2. 选择项目 > Project Settings > Service Accounts
  3. 点击 "Generate New Private Key"
  4. 下载 JSON 文件，从中提取这些值

### 3. Stripe Configuration
```env
STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET_KEY
STRIPE_PUBLISHABLE_KEY=YOUR_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET
```
- **用途**: 支付处理
- **当前状态**: ✅ 已配置测试密钥
- **获取方式**: [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys)
- **注意**: 
  - 测试环境使用 `sk_test_` 和 `pk_test_` 开头的密钥
  - 生产环境必须切换到 `sk_live_` 和 `pk_live_` 开头的密钥

### 4. JWT Secret
```env
JWT_SECRET=your_jwt_secret_at_least_32_characters_long
```
- **用途**: 生成和验证 JWT token
- **要求**: 至少 32 个字符的随机字符串
- **生成方式**: 
  ```bash
  # Linux/Mac
  openssl rand -base64 32
  
  # Windows PowerShell
  -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | % {[char]$_})
  ```

---

## 可选的环境变量

### AWS S3 Configuration (目前未使用)
```env
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=
```
- **用途**: 云端图片存储
- **当前状态**: ❌ 未使用
- **说明**: 
  - 图片目前存储在本地文件系统/Docker 卷中
  - 开发和生产环境都不需要 AWS S3
  - 如果将来需要云存储，可以配置这些值

### CORS Configuration
```env
CORS_ORIGIN=http://localhost:8080
```
- **用途**: 跨域资源共享配置
- **默认值**: `http://localhost:8080`
- **生产环境**: 设置为实际的前端域名

---

## 配置文件位置

### 根目录 `.env`
用于 `docker-compose.yml`，包含所有服务的环境变量。

### `api/.env`
API 服务的环境变量，包含更详细的配置（如数据库连接字符串等）。

### `mobile/.env`
移动应用的环境变量，主要包含：
- API_BASE_URL
- STRIPE_PUBLISHABLE_KEY
- Firebase 配置

---

## 快速开始

1. **复制示例文件**:
   ```bash
   cp .env.example .env
   cp api/.env.example api/.env
   cp mobile/.env.example mobile/.env
   ```

2. **配置必需的值**:
   - Stripe 密钥（已提供测试密钥）
   - Firebase 配置（需要创建 Firebase 项目）
   - JWT Secret（生成随机字符串）

3. **启动服务**:
   ```bash
   docker-compose up -d
   ```

---

## 安全注意事项

⚠️ **重要**:
- 永远不要将 `.env` 文件提交到 Git
- 生产环境使用强密码和真实的密钥
- 定期轮换密钥和密码
- 使用环境变量管理工具（如 AWS Secrets Manager、HashiCorp Vault）管理生产环境的密钥

