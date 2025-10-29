# VoiceTranslate Pro

<div align="center">

![Version](https://img.shields.io/badge/version-3.0.1-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4.svg)
![Node](https://img.shields.io/badge/Node.js-18+-339933.svg)

**AI 驱动的实时语音翻译系统**

使用 OpenAI Realtime API 实现会议和通话的实时语音翻译

[English](./README.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

</div>

---

## 📋 目录

- [概述](#概述)
- [核心功能](#核心功能)
- [系统要求](#系统要求)
- [安装](#安装)
- [配置](#配置)
- [使用方法](#使用方法)
- [架构](#架构)
- [订阅](#订阅)
- [开发](#开发)
- [故障排除](#故障排除)
- [许可证](#许可证)

---

## 概述

**VoiceTranslate Pro** 是一个基于 OpenAI 最新 Realtime API 的实时语音翻译系统。它支持在线会议（Microsoft Teams、Zoom、Google Meet）和系统音频的同声传译。

### 特性

- 🎯 **实时翻译**：低延迟（200-500ms）语音到语音翻译
- 🌐 **多语言支持**：自动检测并翻译 100+ 种语言
- 🎤 **灵活的音频输入**：麦克风、系统音频、会议应用音频捕获
- 🔒 **安全**：加密的 API 密钥存储，本地处理
- ⚡ **高性能**：使用 TypeScript + Chrome 扩展优化
- 🎨 **直观的界面**：简单易用的用户界面
- 💳 **订阅模式**：550日元/月，7天免费试用

---

## 核心功能

### 1. 实时语音翻译

- **语音到语音翻译**：通过 OpenAI Realtime API 实现高质量翻译
- **语音识别**：自动语音识别（集成 Whisper-1）
- **自动语言检测**：自动识别 100+ 种语言
- **低延迟**：200-500ms 响应时间

### 2. 音频输入源

- **麦克风输入**：翻译个人语音
- **系统音频**：翻译浏览器和应用程序音频
- **会议应用**：从 Teams、Zoom、Google Meet 捕获音频

### 3. 语音活动检测（VAD）

- **客户端 VAD**：本地语音检测（低网络负载）
- **服务器 VAD**：OpenAI 服务器上的高精度检测
- **可自定义**：可调节灵敏度和防抖时间

### 4. 翻译模式

- **语音到语音**：实时语音翻译
- **语音到文本**：语音识别 + 文本显示
- **文本到文本**：文本翻译（Chat Completions API）

---

## 🎯 使用场景

### 1️⃣ 国际会议同声传译
```
用日语发言 → 实时翻译成英语 → 参与者理解
```

### 2️⃣ 多语言团队协作
```
每个成员用母语发言 → 自动翻译 → 所有人都能理解
```

### 3️⃣ 在线培训和研讨会
```
讲师的讲解 → 同声传译成多种语言 → 支持全球受众
```

### 4️⃣ 客户支持
```
客户的语言 → 支持人员的语言 → 顺畅沟通
```

---

## 🔄 处理流程

VoiceTranslate Pro 通过 **3 个并行处理** 实现快速准确的翻译。

### 处理流程

```
用户语音输入
    ↓
┌───────────────────────────────────────────────────────┐
│  OpenAI Realtime API (VOICE_TO_VOICE_MODEL)          │
│  - 通过 WebSocket 进行低延迟通信                        │
│  - 实时语音识别 + 语音翻译                              │
└───────────────────────────────────────────────────────┘
    ↓                               ↓
处理 1-1: 立即显示                  处理 1-2: 仅播放语音
📥 输入语音转录                     🔊 输入的语音输出
    ↓                               ↓
显示输入文本                        播放翻译后的语音
(左列)                             (仅语音，无文本)
    ↓
    │
    └─────────────────────────────────┐
                                      ↓
                            ┌─────────────────────┐
                            │  处理 2: 文本        │
                            │  📤🔊 翻译          │
                            └─────────────────────┘
                                      ↓
                            OpenAI Chat API
                            (TRANSLATION_MODEL)
                            更高精度的文本翻译
                                      ↓
                            显示翻译后的文本
                            (右列)
```

### 处理详情

#### 处理 1: 通过 Realtime API 进行语音处理（并发）

**处理 1-1: 📥 输入语音转录**
- **处理**：通过 Realtime API 进行语音识别
- **模型**：`gpt-4o-realtime-preview-2024-12-17`
- **显示**：立即显示在左列
- **目的**：确认用户说了什么

**处理 1-2: 🔊 语音到语音翻译**
- **处理**：通过 Realtime API 直接进行语音翻译
- **模型**：`gpt-4o-realtime-preview-2024-12-17`
- **输出**：仅播放翻译后的语音（不显示文本）
- **目的**：提供即时音频反馈

#### 处理 2: 📤 通过 Chat API 进行文本翻译

- **处理**：高精度文本翻译
- **模型**：`gpt-4o` 或 `gpt-4o-mini`
- **显示**：显示在右列
- **目的**：提供准确的书面翻译

---

## 系统要求

### Chrome 扩展

- **浏览器**：Google Chrome 88+ 或 Microsoft Edge 88+
- **操作系统**：Windows 10/11、macOS 10.15+、Linux
- **网络**：稳定的互联网连接（推荐：5 Mbps+）
- **麦克风**：语音输入必需
- **OpenAI API 密钥**：必需（从 [OpenAI Platform](https://platform.openai.com/api-keys) 获取）

### API 要求

- **OpenAI API 密钥**：必需
- **Realtime API 访问**：必需（gpt-4o-realtime-preview-2024-12-17）
- **预估成本**：每小时使用 $0.50-1.00

---

## 安装

### Chrome 扩展安装

1. **下载扩展**
   ```bash
   git clone https://github.com/liushuang393/apps.git
   cd apps/simultaneous_interpretation
   ```

2. **在 Chrome 中加载扩展**
   - 打开 Chrome 并导航到 `chrome://extensions/`
   - 启用"开发者模式"（右上角）
   - 点击"加载已解压的扩展程序"
   - 选择 `simultaneous_interpretation` 文件夹

3. **验证安装**
   - VoiceTranslate Pro 图标应出现在 Chrome 工具栏中
   - 点击图标打开订阅页面

---

## 配置

### 1. 订阅 VoiceTranslate Pro

1. 点击扩展图标
2. 点击"开始订阅"
3. 使用 Google 登录
4. 通过 Stripe Checkout 完成支付
5. 享受 7 天免费试用

### 2. 配置 OpenAI API 密钥

1. 从 [OpenAI Platform](https://platform.openai.com/api-keys) 获取 API 密钥
2. 打开扩展设置
3. 输入您的 API 密钥
4. 点击"保存"

### 3. 配置音频设置

- **输入源**：选择麦克风或系统音频
- **输出设备**：选择音频输出设备
- **VAD 模式**：选择客户端或服务器 VAD
- **翻译模式**：选择语音到语音、语音到文本或文本到文本

---

## 使用方法

### 基本使用

1. **打开扩展**
   - 点击 Chrome 工具栏中的 VoiceTranslate Pro 图标

2. **开始翻译**
   - 点击"开始"按钮
   - 对着麦克风说话或播放音频
   - 翻译实时显示

3. **停止翻译**
   - 点击"停止"按钮

### 高级功能

- **语言选择**：自动检测或手动选择输入/输出语言
- **VAD 调整**：调整灵敏度以获得更好的语音检测
- **翻译历史**：查看过去的翻译（仅 Electron 应用）

---

## 架构

### 技术栈

- **前端**：HTML5、CSS3、JavaScript (ES6+)
- **后端**：Vercel Serverless Functions
- **数据库**：Supabase (PostgreSQL)
- **身份验证**：Supabase Auth (Google OAuth)
- **支付**：Stripe Checkout
- **API**：OpenAI Realtime API、OpenAI Chat API

### 系统架构

```
┌─────────────────────────────────────────────────────────┐
│  Chrome 扩展（前端）                                      │
│  - 用户界面                                              │
│  - 音频捕获                                              │
│  - 与 OpenAI 的 WebSocket 连接                          │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Vercel Serverless Functions（后端）                    │
│  - /api/create-checkout-session                         │
│  - /api/check-subscription                              │
│  - /api/stripe-webhook                                  │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Supabase（数据库 + 身份验证）                            │
│  - 用户身份验证（Google OAuth）                          │
│  - 订阅数据存储                                          │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Stripe（支付处理）                                       │
│  - Checkout 会话                                         │
│  - 订阅管理                                              │
│  - Webhook 事件                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 订阅

### 定价

- **月度订阅**：550日元/月
- **免费试用**：7 天
- **支付方式**：通过 Stripe 使用信用卡

### 包含内容

- ✅ 无限翻译会话
- ✅ 所有翻译模式（语音到语音、语音到文本、文本到文本）
- ✅ 优先支持
- ✅ 定期更新和新功能

### OpenAI API 成本（单独计费）

- **Realtime API**：约 $0.06/分钟输入，约 $0.24/分钟输出
- **Chat API**：约 $0.005/1K tokens
- **预估总计**：每小时使用 $0.50-1.00

---

## 开发

### 设置开发环境

1. **克隆仓库**
   ```bash
   git clone https://github.com/liushuang393/apps.git
   cd apps/simultaneous_interpretation
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **运行开发服务器**
   ```bash
   npm run dev
   ```

---

## 故障排除

### 常见问题

**问题**：扩展无法加载
- **解决方案**：在 `chrome://extensions/` 中启用开发者模式

**问题**：无音频输出
- **解决方案**：检查音频输出设备设置

**问题**：翻译不工作
- **解决方案**：验证 OpenAI API 密钥和订阅状态

**问题**：高延迟
- **解决方案**：检查网络连接，尝试使用服务器 VAD 而不是客户端 VAD

---

## 致谢

本项目使用了以下开源库：

- **[@supabase/supabase-js](https://github.com/supabase/supabase-js)** - Supabase 客户端库
- **[Stripe Node.js](https://github.com/stripe/stripe-node)** - 支付处理 SDK
- **[Vercel](https://vercel.com)** - Serverless 部署平台
- **[OpenAI API](https://platform.openai.com)** - AI 驱动的翻译和语音识别

特别感谢所有贡献者和开源社区！

---

## 许可证

MIT License - 详见 [LICENSE](./LICENSE) 文件

---

## 贡献

欢迎贡献！请随时提交 Pull Request。

1. Fork 仓库
2. 创建您的功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

---

## 支持

如有问题和疑问：
- **GitHub Issues**：[https://github.com/liushuang393/apps/issues](https://github.com/liushuang393/apps/issues)
- **Email**：liushuang393@sina.com

---

<div align="center">

Made with ❤️ by VoiceTranslate Pro Team

[⬆ 返回顶部](#voicetranslate-pro)

</div>

