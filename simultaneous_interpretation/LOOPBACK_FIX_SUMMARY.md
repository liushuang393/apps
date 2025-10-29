# ループバック防止機能の修正 - 実装サマリー

## 問題

**対話モード（マイク監視）** で、翻訳音声がスピーカーから出力され、それがマイクに戻ってきて再度翻訳されるという問題が発生していました。

```
ユーザー音声 → 翻訳 → スピーカー出力
                          ↓
                      マイク入力 ← 再度翻訳される（ループ）
```

## 解決方法

### 修正ファイル

#### 1. `voicetranslate-websocket-mixin.js` (行 643-694)

**変更内容**: `sendAudioData()` 関数にループバック防止ロジックを追加

```javascript
// 再生中またはバッファウィンドウ内の場合はスキップ
const now = Date.now();
const isPlayingAudio = this.state.isPlayingAudio;
const timeSincePlaybackEnd = this.audioSourceTracker.outputEndTime 
    ? now - this.audioSourceTracker.outputEndTime 
    : Infinity;
const isWithinBufferWindow = timeSincePlaybackEnd < this.audioSourceTracker.bufferWindow;

if (isPlayingAudio || isWithinBufferWindow) {
    console.debug('[Audio] ループバック防止: 音声をスキップ', {
        isPlayingAudio,
        isWithinBufferWindow,
        timeSincePlaybackEnd,
        bufferWindow: this.audioSourceTracker.bufferWindow
    });
    return;
}
```

**効果**:
- 再生中は音声送信をスキップ
- 再生終了後もバッファウィンドウ内は音声送信をスキップ
- マイクモードとシステム音声モード両方に対応

#### 2. `voicetranslate-pro.js` (行 104-116)

**変更内容**: バッファウィンドウを 2000ms → 3000ms に拡大

```javascript
this.audioSourceTracker = {
    outputStartTime: null,
    outputEndTime: null,
    bufferWindow: 3000, // 3秒に拡大
    // 考慮される遅延:
    //   - スピーカー→マイク伝播: 100-500ms
    //   - マイク処理: 100-200ms
    //   - ネットワーク遅延: 100-300ms
    //   - 安全マージン: 1000ms
    playbackTokens: new Set()
};
```

**効果**:
- スピーカー→マイク間の伝播遅延を十分に考慮
- 安全マージンを確保

### 新規ファイル

#### 1. `tests/core/LoopbackPrevention.test.ts`

ループバック防止機能のユニットテスト

**テストケース**:
- 再生中のスキップ
- バッファウィンドウ内のスキップ
- バッファウィンドウ外での送信
- エッジケース（未接続、録音停止など）

#### 2. `LOOPBACK_PREVENTION_FIX.md`

詳細な実装ドキュメント

## 動作フロー

### 再生中
```
1. playAudio() が呼ばれる
2. isPlayingAudio = true に設定
3. inputGainNode.gain.value = 0 でミュート
4. 音声再生開始
5. sendAudioData() が呼ばれても isPlayingAudio = true なのでスキップ
```

### 再生終了後
```
1. source.onended コールバック実行
2. outputEndTime = Date.now() を記録
3. isPlayingAudio = false に設定
4. handleAudioPlaybackEnded() で入力音声を復元
5. sendAudioData() が呼ばれても timeSincePlaybackEnd < 3000 なのでスキップ
6. 3秒後に初めて音声送信が再開される
```

## テスト方法

### 1. ユニットテスト

```bash
# PowerShell の実行ポリシーを一時的に変更
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process

# テスト実行
npm test -- LoopbackPrevention.test.ts
```

### 2. 手動テスト

1. アプリを起動
2. マイクを選択
3. 「開始」ボタンをクリック
4. 何か話す
5. 翻訳音声が再生される
6. **重要**: 翻訳音声が再度翻訳されないことを確認
   - コンソールで `[Audio] ループバック防止: 音声をスキップ` が表示される
   - 3秒間は新しい音声が送信されない

## 互換性

- ✅ マイクモード
- ✅ システム音声モード
- ✅ ブラウザ環境
- ✅ Electron環境
- ✅ ブラウザ拡張機能

## パフォーマンスへの影響

- **CPU**: なし（単純な時間比較）
- **メモリ**: なし（既存の変数を使用）
- **遅延**: 最大3秒の追加遅延（ユーザーが話した直後の翻訳開始が3秒遅れる可能性）

## 設定のカスタマイズ

バッファウィンドウを調整する場合は、`voicetranslate-pro.js` の以下の行を変更:

```javascript
bufferWindow: 3000, // ← この値を変更（ミリ秒単位）
```

推奨値:
- **2000ms**: 低遅延環境（有線LAN、高性能マイク）
- **3000ms**: 標準環境（推奨）
- **4000ms**: 高遅延環境（WiFi、低性能マイク）

## 今後の改善案

1. **適応的バッファウィンドウ**: ネットワーク遅延に基づいて自動調整
2. **スペクトラム分析**: 音声の周波数特性から再生音を検出
3. **機械学習**: 再生音と入力音の特性を学習して判別

