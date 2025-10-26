# VoiceTranslate Pro - 状態管理リファクタリング ガイド

## Phase 1: 統一状態管理器の導入 ✅ 完了

### 什么是 AppStateManager？

新的 `AppStateManager` 类将分散的状态统一管理，包括：

- **appState** - UI/通信相关状态
- **audioState** - 音声处理相关状态  
- **responseState** - 响应管理相关状态
- **modeState** - 多模式协调状态
- **audioSourceTracking** - 音源跟踪状态
- **speechTimingState** - 音声时序状态

### 向后兼容性

```javascript
// ✅ 旧方式仍然可用（v3.0兼容）
this.state.sourceLang = 'ja'

// ✅ 新方式（推荐）
this.stateManager.setState('sourceLang', 'ja')
```

由于在构造函数中设置了 `this.state = this.stateManager.appState`，现有代码无需修改即可正常工作。

### 迁移路线图

#### 第1阶段（当前） - 添加新的状态管理器
- [x] 创建 AppStateManager 类
- [x] 集成到 VoiceTranslateApp 构造函数
- [x] 保持向后兼容性

#### 第2阶段 - 逐步迁移现有代码
**优先级**:
1. 新增功能使用 stateManager
2. 重要的状态修改迁移到 stateManager
3. UI 更新逻辑迁移到 watch() 监听器

**示例迁移**:

```javascript
// 旧代码
this.state.sourceLang = 'ja'

// 新代码
this.stateManager.setState('sourceLang', 'ja')
```

#### 第3阶段 - 监听器集成
```javascript
// 监听 sourceLang 变化
this.stateManager.watch('sourceLang', (newLang, oldLang) => {
    console.log(`Language changed: ${oldLang} → ${newLang}`)
    this.updateUILanguageDisplay(newLang)
})
```

#### 第4阶段 - 完全迁移（v3.1）
- 移除 `this.state` 引用
- 所有状态访问通过 stateManager
- 添加状态验证和约束

### 使用方法

#### 读取状态
```javascript
// 新方式
const lang = this.stateManager.getState('sourceLang')
const isRecording = this.stateManager.getState('isRecording')

// 旧方式（仍支持）
const lang = this.state.sourceLang
```

#### 修改状态
```javascript
// 新方式（推荐）
this.stateManager.setState('sourceLang', 'en')

// 旧方式（仍支持但不推荐）
this.state.sourceLang = 'en'
```

#### 监听状态变化
```javascript
// 监听单个状态
const unwatch = this.stateManager.watch('isRecording', (newValue, oldValue) => {
    console.log(`Recording: ${oldValue} → ${newValue}`)
})

// 取消监听
unwatch()
```

#### 获取所有状态（调试）
```javascript
const allStates = this.stateManager.getAllStates()
console.log('Current states:', allStates)
```

### 可用的状态键

#### appState 对象
```
apiKey, isConnected, isRecording, sourceLang, targetLang, 
voiceType, sessionStartTime, charCount, ws, outputVolume
```

#### audioState 对象
```
audioContext, outputAudioContext, mediaStream, processor, 
audioSource, inputGainNode, audioSourceType, systemAudioSourceId,
isPlayingAudio, inputAudioOutputEnabled, workletNode
```

#### responseState 对象
```
activeResponseId, pendingResponseId, lastCommitTime, isNewResponse
```

#### modeState 对象
```
currentMode, modeStartTime, lastModeChange, modeChangeTimeout, globalLockKey
```

#### audioSourceTracking 对象
```
outputStartTime, outputEndTime, bufferWindow, playbackTokens
```

#### speechTimingState 对象
```
speechStartTime, silenceConfirmTimer, minSpeechDuration, silenceConfirmDelay
```

### 代码示例

#### 检查连接状态
```javascript
// 新方式
if (this.stateManager.getState('isConnected')) {
    // 已连接
}

// 旧方式
if (this.state.isConnected) {
    // 已连接
}
```

#### 设置 API 密钥
```javascript
// 新方式（推荐）
const success = this.stateManager.setState('apiKey', 'sk-...')
if (success) {
    console.log('API key updated')
}

// 旧方式
this.state.apiKey = 'sk-...'
```

#### 获取音频上下文
```javascript
// 新方式
const ctx = this.stateManager.getState('audioContext')

// 旧方式
const ctx = this.state.audioContext
```

### 注意事项

1. **状态验证**
   - setState() 会检查状态是否存在
   - 不存在的键会被记录为错误
   - 值未改变时返回 false

2. **性能考虑**
   - watch() 监听器异常会被捕获，不阻塞其他监听器
   - getAllStates() 返回深拷贝，用于调试

3. **向后兼容性**
   - 直接修改 this.state 仍然可用
   - 但改变不会触发 watch() 监听器
   - 推荐逐步迁移到 setState()

### 常见问题

**Q: 是否需要同时使用新旧两种方式？**  
A: 是的，在迁移期间。新代码应该使用 stateManager，但现有代码可以继续使用 this.state。

**Q: setState() 返回 false 是什么意思？**  
A: 表示状态值没有改变，或者键不存在。你可以检查返回值来决定是否需要进一步处理。

**Q: 监听器什么时候被触发？**  
A: 只有通过 setState() 修改的状态才会触发监听器。直接修改 this.state 不会触发。

**Q: 如何调试状态问题？**  
A: 使用 `this.stateManager.getAllStates()` 获取当前所有状态，或者添加 watch() 监听器跟踪特定状态的变化。

---

## Phase 2: 后续计划（待实施）

- [ ] 方法拆解 (setupAudioProcessingInternal)
- [ ] 错误处理标准化
- [ ] JSDoc 类型注解
- [ ] 集成测试

---

## 快速参考

```javascript
// 创建实例（已在 VoiceTranslateApp 构造函数中完成）
this.stateManager = new AppStateManager()

// 设置状态
this.stateManager.setState('sourceLang', 'ja')

// 获取状态
const lang = this.stateManager.getState('sourceLang')

// 监听变化
this.stateManager.watch('sourceLang', (newVal, oldVal) => {
    console.log(`Language: ${oldVal} → ${newVal}`)
})

// 获取所有状态（调试）
console.log(this.stateManager.getAllStates())
```

