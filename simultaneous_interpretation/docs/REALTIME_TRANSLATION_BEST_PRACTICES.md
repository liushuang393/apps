# 实时同传：防回译 / 不漏译 / 实时性 最佳实践

本文固化"自己的声音/译音不被重复翻译，又不漏翻译，还保证实时性"的方案，并记录
对该方案的漏洞评审结论。配套文档：`STS_SEGMENT_ALIGNMENT_DESIGN.md`（负责 1:1 对齐）。

## 目标与优先级

1. 翻译质量最优先。
2. 实时性其次。
3. 原文与译文文本 1:1 对应（由 Segment Alignment 层保证）。

在以上前提下，本文只解决三个互相冲突的约束：

- 防回译：译音/本人声音不被当作新输入再次翻译。
- 不漏译：对方说话期间不丢音频。
- 实时：不引入大于人耳可感的额外等待。

## 业界结论（先于实现）

回译不靠 VAD 解决，靠**音频路径隔离**：

```text
会议/对方声音 ──▶ 翻译输入
翻译输入 ──▶ Realtime Translation ──▶ 译音 ──▶ 用户耳机/独立输出
                                          └─（绝不回到翻译输入）
```

优先级：

1. 路径隔离（虚拟声卡 / 远端 track / 系统音频）— 物理上断回路。
2. AEC（回声消除）— 仅麦克风模式的辅助。
3. VAD — 只做断句与省成本，不做防回译主手段。
4. Realtime Translation 期间连续送音频，避免漏译。

## 方案漏洞评审（对照现行代码）

评审基于 `voicetranslate-websocket-mixin.js`、`voicetranslate-audio-capture-strategy.js`。

### 漏洞 1（最严重）：系统音频模式在播放期间会漏译

`sendAudioData` 在**所有模式**下只要 `isPlayingAudio` 为真就 `return false`
（mixin 行 ~1337）；同时 `playAudio` 把 `inputGainNode.gain` 设为 0
（行 ~1649），且行 ~1417 注释表明该增益**长期保持 0、不恢复**。

后果：系统音频/虚拟声卡模式下，路径已物理隔离、本不会回译，但只要我方正在
播放上一句译音，对方此刻说的话会被**双重丢弃**（既 mute 又 skip）。这直接违反
"不漏译"。

结论：**系统音频/虚拟声卡/远端 track 模式，播放期间必须继续采集与送音频**。
再生中静音/跳过只应保留给麦克风模式。

### 漏洞 2：未实现 Realtime Translation 连续送音频

方案要求 STS 会话期间连续送 PCM16；现状仍由 VAD + 播放态闸门控制
（同上 `sendAudioData`）。VAD OFF 或播放期间存在静默窗口，会漏掉句首。

结论：`isRealtimeTranslationSession()` 为真时，采集回调应**始终送帧**（含静音），
仅在麦克风模式遇到自身回声时才抑制。

### 漏洞 3：无输出设备分离能力（`setSinkId` 缺失）

代码库**没有任何 `setSinkId`/输出设备选择**。浏览器端译音只能走默认输出设备；
若默认输出又被系统音频采集，则形成回路，路径隔离落空。Firefox/Safari 不支持
`setSinkId`，需有降级说明。

结论：浏览器端提供输出设备选择（支持时 `audioElement.setSinkId(deviceId)`）；
不支持时在 UI 明确要求用户用 OS 路由把译音导向独立耳机。

### 漏洞 4：Electron 系统音频无法用 AEC

`ElectronAudioCaptureStrategy` 注释明确 `echoCancellation` 不可用（strategy 行 ~90）。
故 Electron 系统音频模式**只能靠路径隔离**，AEC 不是兜底。

结论：Electron 系统音频默认走路径隔离；不依赖 AEC。

### 漏洞 5：麦克风模式"再生中守卫"会与不漏译冲突

麦克风模式播放期间 + bufferWindow 内跳过是**正确且必要**的（防扬声器回灌），
但这等于接受"我方播放时对方话可能丢"。此为麦克风单设备下的物理必然，
不能用关守卫来"修复"，否则触发回译。

结论：麦克风模式保留守卫，并在文档/UI 告知这是单设备固有取舍；要不漏译请改用
虚拟声卡/系统音频模式。

## 固化决策（落地规则）

按音频源类型分流，避免"一刀切"：

```text
isRealtimeTranslationSession() 为真时：
  source = system / virtual-cable / remote-track：
    - 连续送帧（含静音），不因 isPlayingAudio 跳过
    - 不把 inputGainNode 在播放时强制 0
  source = microphone：
    - 播放中跳过；播放结束后 bufferWindow 内跳过
    - 播放中 inputGainNode.gain = 0
    - 开启 echoCancellation（浏览器）
非 Realtime（Chat 文本翻译用分段）：
  - 沿用 VAD 断句
```

输出侧：

- 浏览器：支持时用 `setSinkId` 把译音导向独立输出；不支持时 UI 提示 OS 路由。
- Electron：默认路径隔离，不依赖 AEC。

1:1 文本：

- 右侧正式译文由 Chat API 按 `segmentId` 生成；Realtime transcript 作辅助字幕。
- 详见 `STS_SEGMENT_ALIGNMENT_DESIGN.md`。

## 验收

1. 系统音频/虚拟声卡模式：我方播放译音期间，对方持续说话不丢句首、不漏整句。
2. 麦克风模式：播放期间不发生回译（不出现"翻译自己译音"）。
3. Realtime 会话期间网络抓包可见连续 append 帧（含静音段）。
4. 浏览器支持 `setSinkId` 时，译音不出现在被采集的默认设备上。
5. 原文条数 == 译文条数，`data-segment-id` 一一对应。

## 非目标

- 不把主模式改成 STT→文本翻译→TTS。
- 不移除麦克风模式守卫（单设备物理取舍）。
- 不改动支付/订阅/模型下拉/Electron 窗口管理。
- 本文只定决策与验收；实现改动在 `sendAudioData` 分流时另行提交并补测试。
