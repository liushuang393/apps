# gpt-realtime-2025-08-28 升级指南

## 📋 概述

本文档说明如何将系统从 `gpt-4o-realtime-preview-2024-12-17` 升级到最新的 `gpt-realtime-2025-08-28` 模型。

---

## 🆕 新功能和改进

### 1. 音频质量提升
- ✅ **更自然的语音**: 新的 Cedar 和 Marin 语音
- ✅ **改进的语调**: 更好的情感表达和语调控制
- ✅ **更高的清晰度**: 改进的音频生成质量

### 2. 智能和理解能力提升
- ✅ **Big Bench Audio 评分**: 82.8% (vs 65.6%)
- ✅ **更好的非语言线索捕捉**: 笑声、停顿等
- ✅ **多语言切换**: 可以在句子中间切换语言
- ✅ **更准确的字母数字检测**: 电话号码、VIN 等

### 3. 指令遵循改进
- ✅ **MultiChallenge 评分**: 30.5% (vs 20.6%)
- ✅ **更好的提示词遵循**: 即使是细微的指令也能准确执行
- ✅ **更精确的语气控制**: "快速专业" vs "温暖共情"

### 4. 函数调用改进
- ✅ **ComplexFuncBench 评分**: 66.5% (vs 49.7%)
- ✅ **异步函数调用**: 长时间运行的函数不会中断对话
- ✅ **更准确的参数**: 更高的函数调用准确率

### 5. 新功能
- ✅ **图像输入支持**: 可以在会话中添加图像
- ✅ **远程 MCP 服务器支持**: 轻松扩展工具能力
- ✅ **SIP 支持**: 连接到公共电话网络
- ✅ **可重用提示词**: 跨会话保存和重用提示词

---

## 🔧 升级步骤

### 步骤 1: 更新环境变量

编辑 `.env` 文件:

```bash
# 更新 Realtime 模型
OPENAI_REALTIME_MODEL=gpt-realtime-2025-08-28

# Chat 模型保持不变
OPENAI_CHAT_MODEL=gpt-5-2025-08-07
```

### 步骤 2: 更新代码中的默认配置

编辑 `voicetranslate-pro.js`:

```javascript
const CONFIG = {
    API: {
        REALTIME_URL: 'wss://api.openai.com/v1/realtime',
        REALTIME_MODEL: 'gpt-realtime-2025-08-28',  // 更新这里
        CHAT_MODEL: 'gpt-4o',
        TIMEOUT: 30000
    },
    // ... 其他配置
};
```

### 步骤 3: 使用新的音声 (可选)

更新音声配置以使用新的 Cedar 或 Marin 音声:

```javascript
// 在 session.update 中
const session = {
    type: 'session.update',
    session: {
        model: 'gpt-realtime-2025-08-28',
        voice: 'cedar',  // 或 'marin'
        // ... 其他配置
    }
};
```

### 步骤 4: 优化提示词

使用新的 `RealtimeOptimizer` 服务生成优化的提示词:

```typescript
import { RealtimeOptimizer } from './src/services/RealtimeOptimizer';

// 生成优化的提示词
const instructions = RealtimeOptimizer.generateOptimizedPrompt(
    { code: 'ja', name: 'Japanese', nativeName: '日本語' },
    { code: 'en', name: 'English', nativeName: 'English' },
    {
        tone: 'professional',
        pacing: 'normal',
        preserveEmotion: true
    }
);

// 使用在 session 配置中
const session = {
    type: 'session.update',
    session: {
        model: 'gpt-realtime-2025-08-28',
        instructions: instructions,
        // ... 其他配置
    }
};
```

### 步骤 5: 启用 Server VAD (推荐)

```javascript
const session = {
    type: 'session.update',
    session: {
        model: 'gpt-realtime-2025-08-28',
        turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
        },
        // ... 其他配置
    }
};
```

### 步骤 6: 更新音频配置

```javascript
const OPTIMIZED_AUDIO_CONFIG = {
    sampleRate: 24000,      // 24kHz (OpenAI 推奨)
    bufferSize: 4800,       // 200ms @ 24kHz (低延迟)
    format: 'pcm16',        // PCM16 (最佳兼容性)
    channels: 1             // 单声道
};
```

---

## 📊 性能对比

| 指标 | gpt-4o-realtime-preview-2024-12-17 | gpt-realtime-2025-08-28 | 改进 |
|------|-----------------------------------|------------------------|------|
| Big Bench Audio | 65.6% | 82.8% | +26% |
| MultiChallenge | 20.6% | 30.5% | +48% |
| ComplexFuncBench | 49.7% | 66.5% | +34% |
| 音频质量 | 良好 | 优秀 | ⬆️ |
| 指令遵循 | 良好 | 优秀 | ⬆️ |
| 函数调用 | 良好 | 优秀 | ⬆️ |

---

## 🎯 最佳实践

### 1. 提示词优化

**推荐结构** (基于 OpenAI Realtime Prompting Guide):

```
# Role & Objective        — 角色和目标
# Personality & Tone      — 个性和语气
# Instructions / Rules    — 指令和规则
# Language                — 语言设置
# Conversation Flow       — 对话流程
# Sample Phrases          — 示例短语
# Example Translation     — 翻译示例
# Critical Reminders      — 关键提醒
```

### 2. 音声选择

- **Cedar**: 自然、表现力强、专业 (推荐用于商务翻译)
- **Marin**: 清晰、友好、温暖 (推荐用于日常对话)
- **Alloy**: 中性、平衡 (通用)

### 3. 延迟优化

```typescript
// 1. 使用异步函数调用
async handleFunctionCall(call: FunctionCall) {
    // 不等待函数执行完成,继续对话
    this.executeFunctionAsync(call);
    return { status: 'processing' };
}

// 2. 音频流式传输
streamAudio(audioData: Float32Array) {
    const chunkSize = 4800;  // 200ms
    for (let i = 0; i < audioData.length; i += chunkSize) {
        const chunk = audioData.slice(i, i + chunkSize);
        this.sendAudioChunk(chunk);
    }
}

// 3. 预连接 WebSocket
async preConnect() {
    await this.websocket.connect();
    await this.initializeSession();
}
```

### 4. 错误处理

```typescript
class RobustWebSocketManager {
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    
    async handleError(error: Error) {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            // 指数退避重连
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            await this.sleep(delay);
            await this.reconnect();
            this.reconnectAttempts++;
        } else {
            this.notifyConnectionFailure();
        }
    }
}
```

---

## ⚠️ 注意事项

### 1. 价格变化
- **gpt-realtime-2025-08-28**: $32/1M 音频输入 tokens, $64/1M 音频输出 tokens
- **缓存输入**: $0.40/1M tokens (节省 98.75%)
- 比 gpt-4o-realtime-preview 便宜 20%

### 2. 兼容性
- ✅ 完全向后兼容
- ✅ 所有现有功能都支持
- ✅ 新功能是可选的

### 3. 弃用通知
- ⚠️ `gpt-4o-realtime-preview` 系列将在 6 个月后弃用
- 建议尽快迁移到 `gpt-realtime-2025-08-28`

---

## 🧪 测试清单

升级后,请测试以下功能:

- [ ] WebSocket 连接成功
- [ ] 音频输入正常工作
- [ ] 音频输出正常工作
- [ ] 翻译质量符合预期
- [ ] 延迟在可接受范围内 (< 500ms)
- [ ] 错误处理正常工作
- [ ] 长时间运行稳定 (> 1 小时)
- [ ] 不同语言对测试
- [ ] 不同音声测试
- [ ] Server VAD 工作正常

---

## 📚 参考资料

- [OpenAI Realtime API 文档](https://platform.openai.com/docs/models/gpt-4o-realtime-preview)
- [Realtime Prompting Guide](https://cookbook.openai.com/examples/realtime_prompting_guide)
- [gpt-realtime 发布公告](https://openai.com/index/introducing-gpt-realtime/)
- [Azure Realtime API 快速入门](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-quickstart)

---

## 🆘 故障排除

### 问题 1: 连接失败

**症状**: WebSocket 连接失败,错误 401

**解决方案**:
1. 检查 API Key 是否正确
2. 确认 API Key 有 Realtime API 访问权限
3. 检查 `OpenAI-Beta: realtime=v1` 头是否设置

### 问题 2: 音频质量差

**症状**: 音频有杂音或不清晰

**解决方案**:
1. 确认采样率为 24kHz
2. 使用 PCM16 格式
3. 检查 VAD 配置
4. 尝试不同的音声 (cedar, marin)

### 问题 3: 延迟高

**症状**: 翻译响应慢

**解决方案**:
1. 减小缓冲大小 (4800 samples = 200ms)
2. 启用 Server VAD
3. 使用异步函数调用
4. 检查网络连接

### 问题 4: 翻译不完整

**症状**: 部分内容未翻译

**解决方案**:
1. 优化提示词,强调完整性
2. 增加 `max_response_output_tokens`
3. 检查 VAD 设置,避免过早截断

---

**文档版本**: 1.0  
**创建日期**: 2025-10-20  
**最后更新**: 2025-10-20

