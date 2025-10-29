# Chrome Web Store 发布指南

## 📦 步骤1: 打包Chrome插件

### 1.1 运行打包脚本

```bash
npm run pack:extension
```

这会在 `build/` 文件夹中生成 `voicetranslate-pro-extension.zip` 文件。

### 1.2 验证打包内容

打包后的zip文件应包含以下内容：
- `manifest.json` - 插件配置文件
- `background.js` - 后台服务脚本
- `config.js` - 配置文件
- `*.html` - HTML页面（subscription.html, success.html等）
- `*.js` - JavaScript文件
- `icons/` - 图标文件夹
- `ui/` - UI组件文件夹

**不应包含**:
- `node_modules/`
- `src/`, `dist/`, `electron/`
- `.ts` 文件
- `package.json`, `tsconfig.json`
- `.md` 文档文件

---

## 🌐 步骤2: 注册Chrome Web Store开发者账号

### 2.1 访问开发者控制台

https://chrome.google.com/webstore/devconsole

### 2.2 支付注册费

- **费用**: 一次性支付 **$5 USD**
- **支付方式**: 信用卡/借记卡
- **注意**: 这是终身费用，只需支付一次

### 2.3 填写开发者信息

- 开发者名称
- 联系邮箱
- 网站（可选）

---

## 📤 步骤3: 上传Chrome插件

### 3.1 创建新项目

1. 点击 **"新建项目"** (New Item)
2. 上传 `build/voicetranslate-pro-extension.zip`
3. 等待上传完成

### 3.2 填写商店信息

#### 基本信息

**英文版**:
- **Name**: VoiceTranslate Pro - Real-time Voice Translation
- **Summary**: High-precision real-time voice translation using OpenAI Realtime API. Works with Teams, Zoom, and other online meetings.
- **Description**:
```
VoiceTranslate Pro is a powerful Chrome extension that provides real-time voice translation for online meetings.

🎯 Key Features:
• Real-time voice-to-voice translation using OpenAI Realtime API
• Support for 50+ languages
• Works with Teams, Zoom, Google Meet, and other platforms
• High-quality audio processing with echo cancellation
• Conversation history and terminology management

💡 Use Cases:
• International business meetings
• Online language learning
• Cross-border collaboration
• Multilingual customer support

🔒 Privacy & Security:
• Your OpenAI API key is stored locally
• No data is sent to our servers
• Open source project on GitHub

📝 Requirements:
• OpenAI API key (get it from https://platform.openai.com)
• Chrome browser version 88+
• Microphone permission for voice input

💰 Pricing:
• Free 7-day trial
• $3/month subscription (plugin fee)
• OpenAI API costs: ~$0.50-$1.00 per hour (paid directly to OpenAI)
```

**中文版**:
- **名称**: VoiceTranslate Pro - 实时语音翻译
- **简介**: 使用OpenAI Realtime API的高精度实时语音翻译工具。支持Teams、Zoom等在线会议。
- **详细说明**:
```
VoiceTranslate Pro 是一款强大的Chrome扩展程序，为在线会议提供实时语音翻译。

🎯 核心功能：
• 使用OpenAI Realtime API进行实时语音到语音翻译
• 支持50多种语言
• 兼容Teams、Zoom、Google Meet等平台
• 高质量音频处理，带回声消除
• 对话历史和术语管理

💡 使用场景：
• 国际商务会议
• 在线语言学习
• 跨境协作
• 多语言客户支持

🔒 隐私与安全：
• 您的OpenAI API密钥本地存储
• 不向我们的服务器发送数据
• GitHub开源项目

📝 使用要求：
• OpenAI API密钥（从 https://platform.openai.com 获取）
• Chrome浏览器 88+ 版本
• 麦克风权限用于语音输入

💰 价格：
• 免费7天试用
• 每月$3订阅费（插件费用）
• OpenAI API费用：约每小时$0.50-$1.00（直接支付给OpenAI）
```

**日文版**:
- **名前**: VoiceTranslate Pro - リアルタイム音声翻訳
- **概要**: OpenAI Realtime APIを使用した高精度リアルタイム音声翻訳ツール。Teams、Zoom等のオンライン会議で使用可能。

#### カテゴリ

- **Primary Category**: Productivity
- **Secondary Category**: Communication

#### 言語

- English
- 中文 (简体)
- 日本語

---

## 🖼️ 步骤4: 准备宣传素材

### 4.1 必需的图片

1. **Small Icon** (128x128 px)
   - 已有: `icons/icon128.png`

2. **Screenshots** (1280x800 px 或 640x400 px)
   - 至少需要 **1张**，建议 **3-5张**
   - 展示主要功能界面

3. **Promotional Tile** (440x280 px) - 可选
   - 用于Chrome Web Store首页推荐

### 4.2 截图建议

建议截图内容：
1. 主界面 - 显示翻译功能
2. 设置页面 - 显示语言选择
3. 订阅页面 - 显示定价信息
4. 实际使用场景 - Teams/Zoom会议中使用

---

## 🔐 步骤5: 配置权限说明

### 5.1 权限列表

在 `manifest.json` 中声明的权限：
- `storage` - 保存用户设置和API密钥
- `activeTab` - 访问当前标签页
- `scripting` - 注入脚本到网页
- `tabCapture` - 捕获音频流

### 5.2 权限说明文本

**英文**:
```
• Storage: Save your OpenAI API key and user preferences locally
• Active Tab: Access the current tab to inject translation interface
• Scripting: Inject scripts into meeting pages for audio capture
• Tab Capture: Capture audio from online meetings for translation
```

**中文**:
```
• 存储：本地保存您的OpenAI API密钥和用户偏好设置
• 活动标签页：访问当前标签页以注入翻译界面
• 脚本注入：向会议页面注入脚本以捕获音频
• 标签页捕获：从在线会议中捕获音频进行翻译
```

---

## 📋 步骤6: 隐私政策

### 6.1 创建隐私政策页面

你需要提供一个公开的隐私政策URL。可以使用：
- GitHub Pages
- 你的网站
- Google Docs（设置为公开）

### 6.2 隐私政策模板

```markdown
# Privacy Policy for VoiceTranslate Pro

Last updated: [Date]

## Data Collection

VoiceTranslate Pro does NOT collect, store, or transmit any personal data to our servers.

## Local Storage

The following data is stored locally on your device:
- OpenAI API key
- User preferences (language settings, etc.)
- Conversation history (optional, can be disabled)

## Third-Party Services

This extension uses the following third-party services:
- **OpenAI API**: For voice translation services. Please refer to OpenAI's privacy policy.
- **Stripe**: For payment processing. Please refer to Stripe's privacy policy.
- **Supabase**: For subscription management. Please refer to Supabase's privacy policy.

## Permissions

- **Microphone**: Required for voice input
- **Tab Capture**: Required to capture audio from online meetings
- **Storage**: Required to save your settings locally

## Contact

For questions about this privacy policy, please contact: [Your Email]
```

---

## ✅ 步骤7: 提交审核

### 7.1 审核前检查清单

- [ ] 所有必填字段已填写
- [ ] 至少上传1张截图
- [ ] 隐私政策URL已提供
- [ ] 权限说明已填写
- [ ] 测试账号已提供（如果需要）

### 7.2 提交审核

1. 点击 **"提交审核"** (Submit for Review)
2. 等待审核（通常 **1-3个工作日**）
3. 检查邮件通知

### 7.3 审核状态

- **Pending Review**: 等待审核
- **In Review**: 审核中
- **Published**: 已发布 ✅
- **Rejected**: 被拒绝（查看原因并修改）

---

## 🚀 步骤8: 发布后

### 8.1 更新插件

当需要更新时：
1. 修改 `manifest.json` 中的 `version`
2. 运行 `npm run pack:extension`
3. 在开发者控制台上传新的zip文件
4. 提交审核

### 8.2 监控指标

在开发者控制台可以查看：
- 安装数量
- 用户评分
- 评论反馈
- 崩溃报告

---

## 📞 支持

如有问题，请联系：
- **GitHub Issues**: https://github.com/liushuang393/apps/issues
- **Email**: [Your Email]

---

## 🔗 相关链接

- Chrome Web Store Developer Dashboard: https://chrome.google.com/webstore/devconsole
- Chrome Extension Documentation: https://developer.chrome.com/docs/extensions/
- Chrome Web Store Policies: https://developer.chrome.com/docs/webstore/program-policies/

