# Cursor Rules - 同時通訳システム

## 📋 概要

このディレクトリには、同時通訳システム開発のための Cursor AI ルールが含まれています。これらのルールは、コードベースの一貫性、品質、保守性を確保するために使用されます。

## 📁 ルール一覧

### 1. system-architecture.mdc
**適用範囲**: すべてのリクエスト（`alwaysApply: true`）

**目的**: システム全体のアーキテクチャ、実行モード、モジュール構成を定義

**主要内容**:
- ✅ システム概要と主要機能
- ✅ 3つの実行モード（スタンドアロン、Electron、ブラウザ拡張）
- ✅ 3層アーキテクチャ（Main Process、Renderer Process、OpenAI API）
- ✅ コアモジュールの責務と依存関係
- ✅ 音声処理パイプライン
- ✅ 非同期処理パターン
- ✅ 設定管理とビルド構成

### 2. coding-standards.mdc
**適用範囲**: すべてのリクエスト（`alwaysApply: true`）

**目的**: コーディング規範と品質基準の定義

**主要内容**:
- ✅ 日本語コメント規則
- ✅ TypeScript 型安全性ルール
- ✅ 静的解析（ESLint + tsc）
- ✅ 禁止事項（console.log、ハードコード、マジックナンバー）
- ✅ 非同期処理パターン（async/await、Promise）
- ✅ エラーハンドリング
- ✅ メモリ管理
- ✅ テスト規則

### 3. audio-processing.mdc
**適用範囲**: 音声処理関連ファイル

**Glob パターン**: `src/audio/**`, `src/core/AudioManager.ts`, `electron/audioCapture.ts`, `electron/VoiceActivityDetector.ts`

**目的**: 音声処理パイプライン、VAD、音声入出力のベストプラクティス

**主要内容**:
- ✅ 音声処理パイプライン構造
- ✅ VAD（音声活性検出）実装
- ✅ 音声入力管理（マイク、システム音声、ブラウザ音声）
- ✅ 音声出力管理（再生キュー、音量調整）
- ✅ Electron 音声キャプチャ
- ✅ パフォーマンス最適化（循環バッファ、AudioWorklet）
- ✅ エラーハンドリング

### 4. websocket-api.mdc
**適用範囲**: WebSocket 通信関連ファイル

**Glob パターン**: `src/core/WebSocketManager.ts`, `electron/realtimeWebSocket.ts`, `src/adapters/**`

**目的**: OpenAI Realtime API との WebSocket 通信ルール

**主要内容**:
- ✅ OpenAI Realtime API 概要
- ✅ 認証方式（Electron vs ブラウザ）
- ✅ WebSocketManager 実装
- ✅ イベント処理（セッション、会話、レスポンス）
- ✅ メッセージ送受信
- ✅ エラーハンドリング
- ✅ 再接続戦略（エクスポネンシャルバックオフ）
- ✅ 音声データフォーマット（PCM16、Base64）

### 5. async-patterns.mdc
**適用範囲**: すべての TypeScript ファイル

**Glob パターン**: `src/**/*.ts`, `electron/**/*.ts`

**目的**: 非同期処理のパターンとベストプラクティス

**主要内容**:
- ✅ async/await 優先原則
- ✅ Promise アンチパターン回避
- ✅ Promise パターン（all、race、allSettled）
- ✅ 非同期キュー管理（ResponseQueue）
- ✅ イベント駆動非同期処理
- ✅ タイマー管理（setTimeout、debounce、throttle）
- ✅ メモリリーク防止
- ✅ 非同期テスト

### 6. known-issues.mdc
**適用範囲**: すべてのリクエスト（`alwaysApply: true`）

**目的**: 既知の問題、エラーパターン、改善方向の明示

**主要内容**:
- 🔴 Critical: 響応競合エラー（`conversation_already_has_active_response`）
- ✅ 推奨解決策: ステートマシン導入
- ✅ 推奨解決策: ResponseQueue 改善
- 🟡 VAD バッファリング戦略の改善
- 🟡 会話コンテキスト管理の追加
- 📋 コーディング制約と優先順位

## 🎯 使用方法

### 自動適用ルール
以下のルールは常に適用されます：
- `system-architecture.mdc` - システム全体のアーキテクチャ
- `coding-standards.mdc` - コーディング規範と品質基準
- `known-issues.mdc` - 既知の問題と解決策

### ファイル別適用ルール
以下のルールは特定のファイルを編集する際に自動的に適用されます：
- `audio-processing.mdc`: 音声処理関連ファイル
- `websocket-api.mdc`: WebSocket 通信関連ファイル
- `async-patterns.mdc`: すべての TypeScript ファイル

### 手動適用
必要に応じて、以下のようにルールを参照できます：
```
@rules/audio-processing.mdc
```

## 📚 関連ドキュメント

### プロジェクト文書
- [README.md](mdc:../../README.md) - プロジェクト概要
- [docs/ARCHITECTURE.md](mdc:../../docs/ARCHITECTURE.md) - アーキテクチャ詳細
- [docs/SETUP_GUIDE.md](mdc:../../docs/SETUP_GUIDE.md) - セットアップガイド
- [docs/ENGINEERING_RULES.md](mdc:../../docs/ENGINEERING_RULES.md) - エンジニアリング規則

### 設計文書
- [design/DETAILED_DESIGN.md](mdc:../../design/DETAILED_DESIGN.md) - 詳細設計書
- [design/PROJECT_PLAN.md](mdc:../../design/PROJECT_PLAN.md) - プロジェクト計画書
- [design/TEST_PLAN.md](mdc:../../design/TEST_PLAN.md) - テスト計画書

## 🔄 更新履歴

### 2025-10-24 (v1.1)
- ✅ 既知問題ルールを追加（known-issues.mdc）
- ✅ アーキテクチャ改善提案書を作成
- ✅ 響応競合エラーの根本原因と解決策を文書化

### 2025-10-24 (v1.0)
- ✅ 初回生成: 5つの Cursor ルールを作成
- ✅ システムアーキテクチャルールを追加
- ✅ コーディング規範ルールを追加
- ✅ 音声処理ルールを追加
- ✅ WebSocket API ルールを追加
- ✅ 非同期パターンルールを追加

## 💡 ベストプラクティス

### ルール作成時
1. **alwaysApply**: 常に適用すべきルールのみに使用
2. **globs**: ファイルパターンを使って適用範囲を限定
3. **description**: 手動参照用の説明を記載
4. **mdc リンク**: `[filename.ext](mdc:filename.ext)` で関連ファイルを参照

### ルール更新時
1. 変更内容を README.md の更新履歴に記録
2. 関連するルール間の整合性を確認
3. 実際のコードベースとの齟齬がないか確認

## 🚀 今後の拡張

### 追加予定のルール
- ❌ `electron-ipc.mdc`: Electron IPC 通信のルール
- ❌ `ui-management.mdc`: UI 管理とユーザーインタラクション
- ❌ `testing-patterns.mdc`: テストパターンとモック
- ❌ `security-practices.mdc`: セキュリティベストプラクティス
- ❌ `performance-optimization.mdc`: パフォーマンス最適化

## 📝 注意事項

1. **ルールの優先順位**: `alwaysApply` ルールが最優先
2. **Glob パターン**: ワイルドカードは使用可能（例: `*.ts`, `**/*.ts`）
3. **MDC フォーマット**: Markdown + Cursor 拡張構文を使用
4. **日本語優先**: コメントとドキュメントは日本語で記述

## 🤝 貢献

ルールの改善提案や新規ルールの追加は、以下の手順で行ってください：

1. `.cursor/rules/` に新しい `.mdc` ファイルを作成
2. フロントマターでメタデータを定義
3. Markdown でルール内容を記述
4. このREADME.mdを更新
5. プルリクエストを作成

---

**作成者**: VoiceTranslate Pro Team  
**最終更新**: 2025-10-24  
**バージョン**: 1.1.0

