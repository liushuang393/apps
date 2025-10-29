# キューオーバーフロー問題の修正

## 問題の説明

**音声ソースモード（システム音声・会議・ブラウザ）** で、15句翻訳すると3句が失われる（ドロップされる）という問題が発生していました。

```
音声入力 → セグメント化 → キュー追加
                              ↓
                          キュー満杯 → ❌ ドロップ（3/15句）
```

## 根本原因

### 1. **AudioQueue のサイズ制限**

<augment_code_snippet path="simultaneous_interpretation/voicetranslate-audio-queue.js" mode="EXCERPT">
```javascript
this.config = {
    maxQueueSize: options.maxQueueSize || 20,  // ← デフォルト20個
    cleanupDelay: options.cleanupDelay || 1000 // ← 1秒の遅延
};
```
</augment_code_snippet>

**問題点**:
- キューサイズが **20個** に制限されている
- 処理完了後も **1秒間** キューに残る（クリーンアップ遅延）
- 順次処理（1つずつ）のため、処理速度が遅い

### 2. **キュー満杯時の動作**

<augment_code_snippet path="simultaneous_interpretation/voicetranslate-audio-queue.js" mode="EXCERPT">
```javascript
// キュー容量チェック
if (this.queue.size >= this.config.maxQueueSize) {
    console.error('[AudioQueue] キューが満杯:', {
        currentSize: this.queue.size,
        maxSize: this.config.maxQueueSize
    });
    
    this.stats.droppedSegments++;  // ← ここでドロップ
    return null;  // ← 新しいセグメントを拒否
}
```
</augment_code_snippet>

**問題点**:
- キューが満杯の場合、新しいセグメントは **即座にドロップ** される
- ドロップされたセグメントは **翻訳されない**
- 結果: 15句中3句が失われる

### 3. **処理フロー**

```
1. 音声セグメント作成 → キューに追加
2. 処理開始（Path1 + Path2 並列）
3. 処理完了
4. ⏰ 1秒待機（cleanupDelay）
5. キューから削除
```

**問題点**:
- ステップ4の1秒待機中、キューは満杯のまま
- 新しいセグメントが来ても追加できない
- 連続音声の場合、キューがすぐに満杯になる

## 解決策

### 修正1: AudioQueue のサイズを拡大

**変更前**:
```javascript
this.audioQueue = new AudioQueue({
    maxConcurrent: 1 // ← 無効なパラメータ
});
```

**変更後**:
```javascript
this.audioQueue = new AudioQueue({
    maxQueueSize: 50, // キューサイズを拡大（20 → 50）
    cleanupDelay: 100 // クリーンアップ遅延を短縮（1000ms → 100ms）
});
```

**効果**:
- ✅ キュー容量が **2.5倍** に増加（20 → 50）
- ✅ クリーンアップが **10倍速く** なる（1000ms → 100ms）
- ✅ より多くのセグメントを同時に処理可能

### 修正2: ResponseQueue のサイズを拡大

**変更前**:
```javascript
this.responseQueue = new ResponseQueue(..., {
    maxQueueSize: 10, // 最大キュー長
    ...
});
```

**変更後**:
```javascript
this.responseQueue = new ResponseQueue(..., {
    maxQueueSize: 30, // 最大キュー長を拡大（10 → 30）
    ...
});
```

**効果**:
- ✅ レスポンスキュー容量が **3倍** に増加（10 → 30）
- ✅ より多くのレスポンスを同時に処理可能
- ✅ レスポンスのドロップを防止

## 動作フロー（修正後）

```
1. 音声セグメント作成 → キューに追加（最大50個）
2. 処理開始（Path1 + Path2 並列）
3. 処理完了
4. ⏰ 0.1秒待機（cleanupDelay）← 10倍速く
5. キューから削除
```

**改善点**:
- ✅ キュー容量が大きいため、満杯になりにくい
- ✅ クリーンアップが速いため、空きがすぐにできる
- ✅ セグメントのドロップが大幅に減少

## テスト方法

### 1. 統計情報の確認

ブラウザの DevTools コンソールで以下のコマンドを実行:

```javascript
// AudioQueue の統計情報を確認
console.log(app.audioQueue.getStats());
```

**出力例**:
```javascript
{
    totalSegments: 15,      // 総セグメント数
    processedSegments: 15,  // 処理済みセグメント数
    droppedSegments: 0,     // ドロップされたセグメント数 ← 0であるべき
    currentQueueSize: 3,    // 現在のキューサイズ
    successRate: "100%"     // 成功率 ← 100%であるべき
}
```

### 2. 手動テスト

1. アプリを起動: `npm run dev`
2. **システム音声**を選択
3. 会議アプリまたはブラウザを検出
4. 「開始」ボタンをクリック
5. 連続して15句以上話す
6. **重要**: すべての句が翻訳されることを確認
   - コンソールで `[AudioQueue] キューが満杯` が表示されないこと
   - `droppedSegments` が 0 であること

### 3. デバッグログの確認

ブラウザの DevTools コンソールで以下のログを確認:

```
[AudioQueue] セグメント追加: { id: "seg_...", queueSize: 5, duration: "3000ms" }
[AudioQueue] パス完了通知: { segmentId: "seg_...", pathName: "path1", progress: "50%" }
[AudioQueue] セグメント完全処理完了: { id: "seg_...", duration: "3000ms" }
[AudioQueue] セグメント削除: { id: "seg_...", remainingInQueue: 4 }
```

**確認ポイント**:
- ✅ `queueSize` が 50 を超えないこと
- ✅ `[AudioQueue] キューが満杯` が表示されないこと
- ✅ すべてのセグメントが処理完了すること

## パフォーマンスへの影響

### メモリ使用量

- **AudioQueue**: 20個 → 50個（+150%）
  - 1セグメント ≈ 100KB（3秒の音声）
  - 増加量: 30個 × 100KB = **3MB**
- **ResponseQueue**: 10個 → 30個（+200%）
  - 1レスポンス ≈ 10KB
  - 増加量: 20個 × 10KB = **200KB**

**合計**: 約 **3.2MB** のメモリ増加（許容範囲内）

### CPU 使用量

- **変化なし**: 処理ロジックは変更していない
- **クリーンアップ頻度**: 1秒 → 0.1秒（10倍）
  - 影響: 微小（クリーンアップは軽量な操作）

## 設定のカスタマイズ

### AudioQueue のカスタマイズ

`voicetranslate-pro.js` の以下の行を変更:

```javascript
this.audioQueue = new AudioQueue({
    maxQueueSize: 50,  // ← この値を変更
    cleanupDelay: 100  // ← この値を変更（ミリ秒単位）
});
```

**推奨値**:
- **maxQueueSize**:
  - 30: 低負荷環境（短い会議）
  - 50: 標準環境（推奨）
  - 100: 高負荷環境（長時間の連続音声）
- **cleanupDelay**:
  - 50ms: 最速クリーンアップ（CPU使用率やや高）
  - 100ms: 標準（推奨）
  - 500ms: 低CPU使用率（キュー満杯のリスクやや高）

### ResponseQueue のカスタマイズ

`voicetranslate-pro.js` の以下の行を変更:

```javascript
this.responseQueue = new ResponseQueue(..., {
    maxQueueSize: 30,  // ← この値を変更
    ...
});
```

**推奨値**:
- 20: 低負荷環境
- 30: 標準環境（推奨）
- 50: 高負荷環境

## 今後の改善案

1. **適応的キューサイズ**: 負荷に応じて自動調整
2. **優先度キュー**: 重要なセグメントを優先処理
3. **並列処理**: 複数セグメントを同時処理（現在は順次処理）
4. **圧縮**: 古いセグメントを圧縮してメモリ節約

