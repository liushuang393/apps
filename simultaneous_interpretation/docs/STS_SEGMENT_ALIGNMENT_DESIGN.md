# STS Segment Alignment 改善设计

## 目标

面向客户交付时，主体验继续保留低延迟 STS（speech-to-speech）路线：

```text
输入音频 -> Realtime STS -> 翻译音频播放
输入音频 -> SRA/ASR -> 左侧原文
Realtime STS transcript -> 右侧译文
```

核心目标不是把 STS 降级成“文本翻译后再 TTS”，而是在 STS 路线上建立强一致的 segment 对齐层，保证：

- 左侧 SRA/ASR 原文、右侧 STS transcript、播放的 STS audio 来自同一个音频 segment。
- 至少 1 句完整话再翻译/播放，最多 3 句必须翻译/播放。
- 尽量保留 STS 的低延迟和未来模型能力提升带来的简化空间。
- 语言判断、断句、UI 显示、播放队列都不能再依赖“当前最新 transcriptId”或 DOM 插入顺序猜测。

## 当前问题判断

当前代码里存在三类风险：

1. Path1、Path2、WebSocket mixin 各自维护一部分状态，缺少统一的 `segmentId -> responseId -> UI/audio` 映射。
2. 左侧文本可能来自二次 STT，而不是该 segment 的 live SRA/ASR 结果。
3. STS 音频播放和右侧文本显示仍可能走全局队列或旧 DOM 更新方式，没有稳定绑定到同一 segment。

因此，只做 grouped audio 或只调 VAD 参数不够。必须先建立 Segment Alignment Layer。

## 非目标

- 不把主模式改成 `STT -> Chat 文本翻译 -> TTS`。
- 不移除 STS voice-to-voice 能力。
- 不以牺牲低延迟为代价固定等待 3 句。
- 不把语言检测做成阻塞当前 segment 播放的前置步骤。
- 不重构无关支付、订阅、模型下拉框、Electron 窗口管理。

## 总体架构

新增一个轻量的对齐层，建议命名为 `SegmentAlignmentManager`，职责是维护所有用户可见翻译单元。

每个音频单元进入处理链路时创建一个稳定 `segmentId`：

```js
{
  id: 'seg_...',
  createdAt: 0,
  updatedAt: 0,
  status: 'collecting' | 'queued' | 'transcribing' | 'responding' | 'playing' | 'done' | 'error',

  audio: {
    chunks: [],
    durationMs: 0,
    sampleRate: 24000
  },

  input: {
    text: '',
    isFinal: false,
    sourceLang: null,
    confidence: null
  },

  output: {
    responseId: null,
    text: '',
    isFinal: false,
    audioChunkCount: 0,
    audioDone: false
  },

  timing: {
    firstAudioAt: 0,
    inputTextFinalAt: null,
    responseCreatedAt: null,
    firstOutputAudioAt: null,
    outputTextDoneAt: null,
    responseDoneAt: null
  },

  errors: []
}
```

UI、播放、日志、测试都围绕这个对象更新。

## 数据流设计

### 1. 音频进入

当本地 VAD 或 server/semantic VAD 得到一个可处理音频片段时：

1. 创建或更新当前 collecting segment。
2. 把音频 chunk 追加到 `segment.audio.chunks`。
3. 满足 flush 条件时，将 segment 标记为 `queued` 并送入 AudioQueue。

重要约束：

- `segmentId` 必须在进入 AudioQueue 前生成。
- Path1 和 Path2 只能处理同一个 `segment` 对象，不能各自生成 id。
- 不允许后续用 `Date.now()` 临时当 UI id。

### 2. 左侧 SRA/ASR 文本

收到 `conversation.item.input_audio_transcription.completed` 时：

1. 找到对应 segment。
2. 更新 `segment.input.text`、`segment.input.isFinal`、`segment.input.sourceLang`。
3. 通过 `alignmentManager.updateInput(segment.id, ...)` 更新左侧 UI。

如果 API 事件没有可直接使用的 segment id，需要在客户端保证同一时间只存在一个“等待 live transcription 的 collecting/queued segment”，或使用提交顺序队列映射：

```text
input_audio_buffer.commit 顺序 -> pendingInputTranscriptionSegments 队列
transcription.completed -> shift 一个 segment 绑定
```

禁止：

- 在 AudioQueue 模式下直接丢弃 live transcription。
- 等 Path1 二次送音频 STT 后才显示左侧原文。
- 用全局 `currentTranscriptId` 绑定左侧和右侧。

### 3. STS response 绑定

Path2 发送 `response.create` 前：

1. 当前 segment 进入 `responding`。
2. 注册 `pendingResponseSegment = segment.id`，或在 response queue item 中保存 segment id。

收到 `response.created` 时：

1. 将 `message.response.id` 绑定到 `segment.output.responseId`。
2. 建立 `responseIdToSegmentId` Map。

收到以下事件时必须按 `response_id` 查 segment：

- `response.output_audio_transcript.delta`
- `response.output_audio_transcript.done`
- `response.output_audio.delta`
- `response.output_audio.done`
- `response.done`

禁止：

- 不检查 `response_id` 就播放任何 audio delta。
- 不检查 `response_id` 就把 transcript delta 追加到“当前 segment”。
- 在 `response.created` 里清空全局播放队列。

### 4. 右侧 STS transcript

右侧文本只显示 STS 输出 transcript：

```text
response.output_audio_transcript.delta/done -> segment.output.text -> 右侧 UI
```

如果 `output_audio_transcript` 不可用或为空：

- 可以显示“翻译音频已生成，文本不可用”的降级状态。
- 不自动用 Chat 文本翻译替代右侧，因为那会造成“听到的译文”和“看到的译文”不一致。

### 5. STS audio 播放

播放队列的元素必须带 segment 信息：

```js
{
  segmentId,
  responseId,
  audioBase64,
  sequence
}
```

播放前校验：

- `responseIdToSegmentId.get(responseId) === segmentId`
- segment 未取消、未过期、未 error

播放中更新：

- 第一个音频 chunk 播放时记录 `firstOutputAudioAt`。
- `response.output_audio.done` 后标记 `audioDone`。
- `response.done` 且 audio/text 都完成后标记 `done`。

## 断句与 flush 策略

目标是“不切半句，同时不等太久”。

### 推荐规则

满足任一条件就 flush 当前 segment：

1. 已有 1 个完整语义句，并且短等待窗口结束。
   - 短等待建议 `300-700ms`。
   - 如果窗口内继续来音频，则继续累计。
2. 已累计 3 个完整语义句，立即 flush。
3. 当前 segment 累计时长超过 `4-6s`，强制 flush。
4. 音频长度/字符长度超过上限，强制 flush。
5. 用户停止录音或连接断开前，flush 剩余非空 segment。

### 完整句判定

完整句来源按优先级：

1. semantic/server VAD 给出的 turn end。
2. SRA/ASR final text 的标点：`。！？.!?`
3. 静音结束且文本长度达到最小阈值。
4. 最大等待时间兜底。

注意：

- 无标点短片段只有在 Realtime/VAD 已给出 completed turn 时才按 1 个完整发话处理。
- `MAX_SENTENCES=3` 是最大值，不是默认等待 3 句。
- 默认 `MAX_BUFFER_MS=6000`，避免客户侧等待过长。

## 语言判断策略

语言判断只辅助后续提示词和 UI，不阻塞当前 STS 播放。

### 分段级语言

每个 segment 存自己的 `sourceLang`。

禁止：

- 短句低置信度时直接修改全局 `sourceLang`。
- 因为当前 segment 是中文就让未完成的其他 segment 也按中文处理。

### 判断来源

1. 字符规则快速判断：
   - 假名 -> `ja`
   - 韩文 -> `ko`
   - 拉丁字符为主 -> `en` 或对应语言候选
   - 纯汉字 -> `zh/ja` 待确认
2. Realtime/SRA 返回的语言信息，如果可用。
3. 最近 N 个 final segment 的稳定语言状态。
4. 必要时用 Chat 做低频 fallback 检测，但不能阻塞当前播放。

### STS instructions

每次 response.create 应包含稳定规则：

- 自动判断输入语言。
- 只输出目标语言。
- 不解释、不复述原文、不说“我将翻译”。
- 保留数字、日期、金额、人名、专有名词。
- 使用术语表和最近上下文，但只翻译当前 segment。

## 实现范围

### 必改文件

- `voicetranslate-audio-queue.js`
  - 在 `AudioSegment` 中增加 alignment fields，或接受外部创建好的 segment id。
  - 确保 id 在 enqueue 前稳定存在。

- `voicetranslate-websocket-mixin.js`
  - 建立 responseId 到 segmentId 的绑定。
  - audio/text delta 必须按 response id 更新 segment。
  - live transcription 不能在 AudioQueue 模式下直接丢弃。
  - 播放队列元素带 segmentId/responseId。

- `voicetranslate-path-processors.js`
  - Path1 只更新同一 segment 的 input，不再生成临时 transcriptId。
  - Path2 只更新同一 segment 的 output/audio，不再调用旧 `transcriptOutput` DOM。
  - 去除或隔离旧 `displayTranslatedText` 的 DOM 直写。

- `voicetranslate-ui-mixin.js`
  - 新增按 segmentId upsert 输入/输出的方法。
  - 允许右侧先显示“翻译中...”占位，后续由 STS transcript 更新。
  - 保持现有双栏 UI，但数据源改为 segment。

- `voicetranslate-pro.js`
  - 初始化 alignment manager。
  - start/stop/clear 时清理 alignment 状态。
  - instructions 接入 segment/context/terminology，但不阻塞 STS。

### 可能需要改

- `teams-realtime-translator.html`
  - 如果继续双栏，不一定需要大改 HTML。
  - 如果要显示配对状态，可增加 data attribute 或轻量状态样式。

- tests
  - 新增 alignment 单元测试和 WebSocket event sequence 测试。

## 明确边界

- 暂不做完整 UI 重排成单列表卡片；可以先保留左右两栏。
- 暂不引入外部状态库。
- 暂不改变付款、订阅、模型选择逻辑。
- 暂不要求浏览器插件和 Electron 的音频采集实现完全一致；但 alignment 层必须共享。
- Chat 文本翻译仍可保留为“文本翻译模式”，但不能混入 STS 主模式的右侧文本。

## 实施步骤

### Phase 1: Alignment 数据层

1. 新增 `SegmentAlignmentManager`。
2. 实现：
   - `createSegment(audioMetadata)`
   - `appendInputText(segmentId, text, meta)`
   - `bindResponse(segmentId, responseId)`
   - `appendOutputText(responseId, delta)`
   - `appendOutputAudio(responseId, chunk)`
   - `markInputDone(segmentId)`
   - `markOutputDone(responseId)`
   - `getSegment(id)`
   - `clear()`
3. 先不改 UI，只打日志和测试映射正确性。

### Phase 2: UI upsert

1. `addTranscript` 保留兼容。
2. 新增：
   - `upsertSegmentInput(segmentId, text, status)`
   - `upsertSegmentOutput(segmentId, text, status)`
3. 输出先占位：
   - 左侧有 input 后，右侧创建同 id 占位。
   - STS transcript delta 到达后更新占位。

### Phase 3: WebSocket response 绑定

1. Path2 `response.create` 前把 segmentId 放入 pending queue item。
2. `response.created` 绑定 responseId。
3. 所有 output audio/text 事件按 responseId 找 segment。
4. 播放队列带 responseId/segmentId。

### Phase 4: SRA live transcription 绑定

1. `input_audio_buffer.commit` 时记录 pending transcription segment。
2. `conversation.item.input_audio_transcription.completed` 到达时绑定到 pending segment。
3. Path1 不再二次 STT 作为主显示来源。
4. 如果 live transcription 丢失，Path1 二次 STT 只作为 fallback，并标记来源。

### Phase 5: 断句策略

1. 在 WebSocket grouped turn path 中实现 segment flush 控制。
2. 支持：
   - 1 完整句短等待 flush
   - 3 句立即 flush
   - max duration flush
   - stop flush
3. 默认参数：
   - `MIN_COMPLETE_SENTENCES=1`
   - `MAX_SENTENCES=3`
   - `POST_SENTENCE_HOLD_MS=500`
   - `MAX_BUFFER_MS=6000`

### Phase 6: 清理旧路径

1. 移除 STS 模式下对 `currentTranscriptId` 的依赖。
2. 移除 STS 模式下直接写 `transcriptOutput` 的旧 DOM 方法。
3. 保留文本翻译模式的独立路径，但和 STS alignment 明确隔离。

## 验收条件

### 功能验收

1. 连续 5 段语音输入后，左侧和右侧数量一致。
2. 每个右侧译文的 `data-segment-id` 与左侧原文一致。
3. STS audio chunk 的 `responseId` 能查回同一个 segmentId。
4. 右侧文本来自 `response.output_audio_transcript.*`，不是 Chat 文本翻译。
5. 左侧文本来自 live SRA/ASR；二次 STT fallback 必须可在日志中识别。
6. 一句完整话后可在短等待窗口内触发翻译，不固定等 3 句。
7. 连续说 3 句话时，第三句结束后必须立即 flush。
8. 停止录音时，剩余非空 segment 必须 flush 或明确丢弃并提示。
9. 文本翻译模式仍可工作，且不影响 STS 主模式。

### 质量验收

1. 中文长句不被切成半句播放。
2. 日文、中文、英文切换时，不因单个短句低置信度误改全局语言。
3. 数字、日期、金额、人名在 STS instructions 下保持稳定。
4. 右侧显示文本与播放语音语义一致。

### 延迟验收

建议本地记录以下指标：

- `firstAudioAt -> inputTextFinalAt`
- `segmentFlushAt -> responseCreatedAt`
- `responseCreatedAt -> firstOutputAudioAt`
- `segmentFlushAt -> firstOutputAudioAt`
- `segmentFlushAt -> outputTextDoneAt`

目标：

- 1 句完整话后的 flush 等待一般不超过 `700ms`。
- 正常网络下 `flush -> first output audio` 保持在可接受范围。
- 不出现默认等待 3 句或 8 秒才开始翻译的体验。

## 测试计划

### 单元测试

新增测试覆盖：

1. `SegmentAlignmentManager`
   - 创建 segment 后 id 稳定。
   - responseId 绑定后 audio/text delta 能正确回写。
   - 未知 responseId 被拒绝或记录 warning。

2. `SegmentFlushController`
   - 1 完整句 + hold 到期 -> flush。
   - 3 完整句 -> 立即 flush。
   - 无标点短文本不直接算完整句。
   - max buffer 到期 -> flush。

3. UI upsert
   - 同 segmentId 多次更新不新增重复 DOM。
   - 左右两栏按同 segmentId 排序一致。
   - 右侧占位能被 transcript delta 替换。

### WebSocket 事件序列测试

模拟：

```text
input_audio_buffer.committed
conversation.item.input_audio_transcription.completed
response.created
response.output_audio_transcript.delta
response.output_audio.delta
response.output_audio_transcript.done
response.output_audio.done
response.done
```

断言：

- input/output/audio 都归到同一 segment。
- 乱序 delta 不会写到最新 segment。
- response.done 后 segment 状态为 done。

### 回归测试

执行：

```bash
node --check voicetranslate-pro.js
node --check voicetranslate-websocket-mixin.js
node --check voicetranslate-path-processors.js
node --check voicetranslate-ui-mixin.js
npm run type-check
npm run build:extension
npm run check:extension
git diff --check
```

### 手动验收场景

1. 单句中文：
   - “你和我会永远一起走下去。”
   - 左侧显示原文，右侧显示同一句 STS 译文，播放同一句译音。

2. 三句中文：
   - “别忘了。所以采耳。你和我会永远一起走下去。”
   - 不能把第 2 句译文显示到第 1 句旁边。

3. 无标点自然发言：
   - 靠 semantic/server VAD 和 max wait flush。
   - 不无限等待。

4. 中日英混合短句：
   - 不因一个短词误切全局语言。

5. 快速连续发言：
   - 多个 response 事件交错时，UI 和播放仍按 responseId 对齐。

## 完成定义

只有同时满足以下条件，才算完成：

- STS 主模式下不再依赖全局 `currentTranscriptId` 绑定左右栏。
- STS audio/text 都通过 `responseIdToSegmentId` 更新同一 segment。
- 左侧 live SRA/ASR 和右侧 STS transcript 使用同一 `segmentId`。
- 默认断句策略是“1 句可出，最多 3 句”，而不是默认等满 3 句。
- 本地 app、浏览器页、插件通过统一 Realtime message listener 进入同一套 Path1/Path2。
- 所有验收命令通过。
- 至少有一个自动测试覆盖乱序 WebSocket 事件仍能正确对齐。
