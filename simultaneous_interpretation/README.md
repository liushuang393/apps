# VoiceTranslate Pro

<div align="center">

![Version](https://img.shields.io/badge/version-3.0.1-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4.svg)
![Node](https://img.shields.io/badge/Node.js-18+-339933.svg)

**AI-Powered Real-Time Voice Translation System**

Real-time voice translation for meetings and calls using OpenAI Realtime API

[English](./README.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

</div>

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Architecture](#architecture)
- [Subscription](#subscription)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Overview

**VoiceTranslate Pro** is a real-time voice translation system powered by OpenAI's latest Realtime API. It enables simultaneous interpretation for online meetings (Microsoft Teams, Zoom, Google Meet) and system audio.

### Features

- 🎯 **Real-Time Translation**: Low latency (200-500ms) voice-to-voice translation
- 🌐 **Multi-Language Support**: Auto-detection and translation for 100+ languages
- 🎤 **Flexible Audio Input**: Microphone, system audio, meeting app audio capture
- 🔒 **Secure**: Encrypted API key storage, local processing
- ⚡ **High Performance**: Optimized with TypeScript + Chrome Extension
- 🎨 **Intuitive UI**: Simple and user-friendly interface
- 💳 **Subscription Model**: 550円/month with 7-day free trial

---

## Key Features

### 1. Real-Time Voice Translation

- **Voice-to-Voice Translation**: High-quality translation via OpenAI Realtime API
- **Speech Recognition**: Automatic speech recognition (Whisper-1 integration)
- **Auto Language Detection**: Automatic identification of 100+ languages
- **Low Latency**: 200-500ms response time

### 2. Audio Input Sources

- **Microphone Input**: Translate personal speech
- **System Audio**: Translate browser and app audio
- **Meeting Apps**: Audio capture from Teams, Zoom, Google Meet

### 3. Voice Activity Detection (VAD)

- **Client VAD**: Local voice detection (low network load)
- **Server VAD**: High-precision detection on OpenAI servers
- **Customizable**: Adjustable sensitivity and debounce time

### 4. Translation Modes

- **Voice-to-Voice**: Real-time voice translation
- **Voice-to-Text**: Speech recognition + text display
- **Text-to-Text**: Text translation (Chat Completions API)

---

## 🎯 Use Cases

### 1️⃣ Simultaneous Interpretation for International Meetings
```
Speak in Japanese → Real-time translation to English → Participants understand
```

### 2️⃣ Multilingual Team Collaboration
```
Each member speaks in their native language → Auto-translation → Everyone understands
```

### 3️⃣ Online Training & Seminars
```
Instructor's explanation → Simultaneous translation to multiple languages → Global audience support
```

### 4️⃣ Customer Support
```
Customer's language → Support staff's language → Smooth communication
```

---

## 🔄 Processing Flow

VoiceTranslate Pro achieves fast and accurate translation through **3 parallel processes**.

### Processing Flow

```
User's Voice Input
    ↓
┌───────────────────────────────────────────────────────┐
│  OpenAI Realtime API (VOICE_TO_VOICE_MODEL)          │
│  - Low-latency communication via WebSocket            │
│  - Real-time speech recognition + voice translation   │
└───────────────────────────────────────────────────────┘
    ↓                               ↓
Process 1-1: Display immediately   Process 1-2: Play voice only
📥 Input voice transcription       🔊 Voice output from input
    ↓                               ↓
Display input text                 Play translated voice
(Left column)                      (Voice only, no text)
    ↓
    │
    └─────────────────────────────────┐
                                      ↓
                            ┌─────────────────────┐
                            │  Process 2: Text    │
                            │  📤🔊 Translation   │
                            └─────────────────────┘
                                      ↓
                            OpenAI Chat API
                            (TRANSLATION_MODEL)
                            Higher precision text translation
                                      ↓
                            Display translated text
                            (Right column)
```

### Process Details

#### Process 1: Voice Processing via Realtime API (Concurrent)

**Process 1-1: 📥 Input Voice Transcription**
- **Processing**: Speech recognition via Realtime API
- **Model**: `gpt-4o-realtime-preview-2024-12-17`
- **Display**: Immediately displayed in left column
- **Purpose**: Confirm what the user said

**Process 1-2: 🔊 Voice-to-Voice Translation**
- **Processing**: Direct voice translation via Realtime API
- **Model**: `gpt-4o-realtime-preview-2024-12-17`
- **Output**: Play translated voice only (no text display)
- **Purpose**: Provide immediate audio feedback

#### Process 2: 📤 Text Translation via Chat API

- **Processing**: High-precision text translation
- **Model**: `gpt-4o` or `gpt-4o-mini`
- **Display**: Displayed in right column
- **Purpose**: Provide accurate written translation

---

## System Requirements

### Chrome Extension

- **Browser**: Google Chrome 88+ or Microsoft Edge 88+
- **OS**: Windows 10/11, macOS 10.15+, Linux
- **Network**: Stable internet connection (recommended: 5 Mbps+)
- **Microphone**: Required for voice input
- **OpenAI API Key**: Required (obtain from [OpenAI Platform](https://platform.openai.com/api-keys))

### API Requirements

- **OpenAI API Key**: Required
- **Realtime API Access**: Required (gpt-4o-realtime-preview-2024-12-17)
- **Estimated Cost**: $0.50-1.00 per hour of usage

---

## Installation

### Chrome Extension Installation

1. **Download the Extension**
   ```bash
   git clone https://github.com/liushuang393/apps.git
   cd apps/simultaneous_interpretation
   ```

2. **Load Extension in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `simultaneous_interpretation` folder

3. **Verify Installation**
   - The VoiceTranslate Pro icon should appear in the Chrome toolbar
   - Click the icon to open the subscription page

---

## Configuration

### 1. Subscribe to VoiceTranslate Pro

1. Click the extension icon
2. Click "Start Subscription"
3. Sign in with Google
4. Complete payment via Stripe Checkout
5. Enjoy 7-day free trial

### 2. Configure OpenAI API Key

1. Obtain API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Open the extension settings
3. Enter your API key
4. Click "Save"

### 3. Configure Audio Settings

- **Input Source**: Select microphone or system audio
- **Output Device**: Select audio output device
- **VAD Mode**: Choose client or server VAD
- **Translation Mode**: Select voice-to-voice, voice-to-text, or text-to-text

---

## Usage

### Basic Usage

1. **Open Extension**
   - Click the VoiceTranslate Pro icon in Chrome toolbar

2. **Start Translation**
   - Click "Start" button
   - Speak into microphone or play audio
   - Translation appears in real-time

3. **Stop Translation**
   - Click "Stop" button

### Advanced Features

- **Language Selection**: Auto-detect or manually select input/output languages
- **VAD Adjustment**: Adjust sensitivity for better voice detection
- **Translation History**: View past translations (Electron app only)

---

## Architecture

### Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Vercel Serverless Functions
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth (Google OAuth)
- **Payment**: Stripe Checkout
- **API**: OpenAI Realtime API, OpenAI Chat API

### System Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Chrome Extension (Frontend)                            │
│  - User Interface                                       │
│  - Audio Capture                                        │
│  - WebSocket Connection to OpenAI                       │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Vercel Serverless Functions (Backend)                  │
│  - /api/create-checkout-session                         │
│  - /api/check-subscription                              │
│  - /api/stripe-webhook                                  │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Supabase (Database + Auth)                             │
│  - User Authentication (Google OAuth)                   │
│  - Subscription Data Storage                            │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Stripe (Payment Processing)                            │
│  - Checkout Session                                     │
│  - Subscription Management                              │
│  - Webhook Events                                       │
└─────────────────────────────────────────────────────────┘
```

---

## Subscription

### Pricing

- **Monthly Subscription**: 550円/month
- **Free Trial**: 7 days
- **Payment Method**: Credit card via Stripe

### What's Included

- ✅ Unlimited translation sessions
- ✅ All translation modes (voice-to-voice, voice-to-text, text-to-text)
- ✅ Priority support
- ✅ Regular updates and new features

### OpenAI API Costs (Separate)

- **Realtime API**: ~$0.06/minute input, ~$0.24/minute output
- **Chat API**: ~$0.005/1K tokens
- **Estimated Total**: $0.50-1.00 per hour of usage

---

## Development

### Setup Development Environment

1. **Clone Repository**
   ```bash
   git clone https://github.com/liushuang393/apps.git
   cd apps/simultaneous_interpretation
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Run Development Server**
   ```bash
   npm run dev
   ```

---

## Troubleshooting

### Common Issues

**Issue**: Extension not loading
- **Solution**: Enable Developer mode in `chrome://extensions/`

**Issue**: No audio output
- **Solution**: Check audio output device settings

**Issue**: Translation not working
- **Solution**: Verify OpenAI API key and subscription status

**Issue**: High latency
- **Solution**: Check network connection, try server VAD instead of client VAD

---

## Acknowledgments

This project uses the following open-source libraries:

- **[@supabase/supabase-js](https://github.com/supabase/supabase-js)** - Supabase client library
- **[Stripe Node.js](https://github.com/stripe/stripe-node)** - Payment processing SDK
- **[Vercel](https://vercel.com)** - Serverless deployment platform
- **[OpenAI API](https://platform.openai.com)** - AI-powered translation and speech recognition

Special thanks to all contributors and the open-source community!

---

## License

MIT License - see [LICENSE](./LICENSE) file for details

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## Support

For issues and questions:
- **GitHub Issues**: [https://github.com/liushuang393/apps/issues](https://github.com/liushuang393/apps/issues)
- **Email**: liushuang393@sina.com

---

<div align="center">

Made with ❤️ by VoiceTranslate Pro Team

[⬆ Back to Top](#voicetranslate-pro)

</div>
