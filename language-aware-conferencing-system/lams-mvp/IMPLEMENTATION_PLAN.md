## ステージ1: 会議ライフサイクル整流
**目的**: `room` と `meeting session` の責務を分離し、開始・進行・終了を確実に閉じる。
**成功条件**:
- `MeetingSession` の開始・再利用・終了が一貫して動作する
- 会議記録と議事録が `session` 単位で取得できる
**タスク分解**:
- `session` の生成/終了条件を整理する
- 記録APIに `session_id` を通す
- 退室時の `end_session()` を配線する
**進捗状況**: 完了

## ステージ2: 字幕・翻訳導線の一本化
**目的**: 字幕生成から翻訳表示までを単一路線にする。
**成功条件**:
- 字幕IDベース翻訳が動作する
- 原文キャッシュが字幕送信前に保存される
- フロントが逐次翻訳待ちで詰まらない
**タスク分解**:
- 原文キャッシュ保存の配線
- 字幕イベント形式の統一
- クライアント翻訳処理の非同期化
**進捗状況**: 完了

## ステージ3: 言語ポリシーと権限の単一化
**目的**: 言語設定と権限制御の基準を揃える。
**成功条件**:
- 有効言語の単一ソースができる
- 会議作成・参加・記録表示で同じ言語制約が効く
**タスク分解**:
- backend の言語定義共通化
- frontend の表示言語取得を設定API寄りに揃える
- 管理者画面/一般画面の権限制御を補強する
**進捗状況**: 完了

## ステージ4: リアルタイムUXと障害時縮退
**目的**: 接続断や遅延劣化を明示的に扱う。
**成功条件**:
- QoS警告がUIへ届く
- 接続失敗理由が表示される
- スピーカー選択が未対応ブラウザでも破綻しない
**タスク分解**:
- QoSイベント受信の追加
- 接続エラー状態の保持
- `setSinkId()` 対応分岐
**進捗状況**: 完了

## ステージ5: 検証基盤とリリース判定の再定義
**目的**: `mode2` の出荷基準と `mode1` の再設計扱いを明文化する。
**成功条件**:
- README とテスト観点の表現が現実に合う
- 追加した変更の回帰テストがある
**タスク分解**:
- 設計・検証文書の更新
- 追加機能のテスト整備
**進捗状況**: 完了

## ステージ6: 確定発話を保護する取り込み制御
**目的**: 通常過負荷では確定発話を捨てず、翻訳音声を先に縮退させる。
**成功条件**:
- soft limit 内で final 欠落が発生しない
- hard limit / max age の強制破棄が理由付きで観測できる
- queue depth / age と degraded 状態を確認できる
**タスク分解**:
- SegmentIngress の追加
- Agent キューと Mode Router 縮退の配線
- degraded UI と回帰テストの追加
**進捗状況**: 完了

## ステージ7: Native 持続型 Realtime Runtime
**目的**: Provider 接続を Runtime Port の背後に隠し、会議中の接続再利用を可能にする。
**成功条件**:
- 既定 per_utterance で後方互換を維持する
- native_persistent で同一 session key の接続を再利用する
- 再接続上限時に短命経路へ安全に切り戻す
**タスク分解**:
- RealtimeRuntimePort と RuntimeRegistry の追加
- NativePersistentRuntime の追加
- 接続再利用・再接続テストの追加
**進捗状況**: 完了

## ステージ8: 世代管理とイベント契約
**目的**: 旧翻訳音声の再生を防ぎ、字幕イベントを版管理する。
**成功条件**:
- 新発話で旧 generation が無効化される
- schema_version 付きイベントを後方互換で処理できる
- interim revision を更新し final で削除できる
**タスク分解**:
- GenerationTracker と Publisher gate の追加
- 共通イベント envelope の追加
- interim 字幕のバックエンド送信とフロント更新
**進捗状況**: 完了

## ステージ9: WebRTC・AI 統合 QoE
**目的**: Media / AI / Queue の品質から翻訳音声を自動縮退・回復する。
**成功条件**:
- ブラウザ RTCStats を本文・秘密情報なしで収集できる
- packet loss 5% 超で字幕優先へ縮退する
- ヒステリシスとクールダウン後に自動回復する
**タスク分解**:
- QoEStateMachine の追加
- LiveKit DataChannel による Stats 集約
- degraded / interrupted / recovered の UI 配線
**進捗状況**: 完了

## ステージ10: Phase A — QoE 縮退権威の単一化
**目的**: 縮退判定の権威を QoE 単一 module に統合し、producer/consumer を decision に揃え、受聴者単位ヒステリシスを集約する（tickets 01–03）。
**成功条件**:
- 型付き evaluate が状態・主要/補助理由・主線可否・partial・changed を返す
- HybridQoS monitor は測定と warning のみで hearing 停止を決めない
- orchestrator は decision の可否フラグと理由コードだけを消費する
- server / listener-local decision が分離され、個人 Media 劣化が会議全体の Mode A を止めない
- 回復ヒステリシスと cooldown が QoE に集約され、決定論的に検証できる
**タスク分解**:
- [01] QoE typed evaluate 権威の確立
- [02] 観測 producer と主線 consumer の decision 整列
- [03] 受聴者単位劣化と回復ヒステリシスの集約
**Tests**:
- `backend/tests/test_qoe.py`（観測系列→decision、優先順位、unknown、cooldown）
- `backend/tests/test_qos.py`（測定・warning 限定）
- `backend/tests/test_orchestrator.py`（decision 注入による聞く停止・読む継続）
- 受聴者単位 / UI 理由コードの回帰
**進捗状況**: 完了

## ステージ11: Phase B — 型付き契約と Output Manager
**目的**: サーバ・クライアント共有の型付きイベント契約を確立し、聞く・読む主線の配信を Output Manager 経由に移行する（tickets 04–06）。
**成功条件**:
- canonical fixture を server encoder → client decoder で往復検証できる
- Output Manager が独立 module として公開 interface を持つ
- 主線配信が Output Manager 経由に移行している
**タスク分解**:
- [04] 型付き共有イベント契約
- [05] Output Manager module 公開
- [06] 配信の Output Manager 移行
**Tests**:
- `backend/tests/test_events.py` / fixtures
- `backend/tests/test_output_manager.py`
- `backend/tests/test_output_manager_integration.py`
- `backend/tests/test_livekit_output_manager_adapter.py`
**進捗状況**: 完了

## ステージ12: Phase C — RealtimeRuntimePort seam
**目的**: RealtimeRuntimePort を本物の Port にし、orchestrator を Port／registry 公開面だけに依存させる（tickets 07–08）。
**成功条件**:
- session／turn contract suite が全 Runtime 実装を通る
- orchestrator が Port／registry 以外の Runtime 内部に依存しない
**タスク分解**:
- [07] Port contract suite
- [08] orchestrator Port-only 依存
**Tests**:
- `backend/tests/test_realtime_runtime.py`
- `backend/tests/test_realtime_runtime_contract.py`
- `backend/tests/test_orchestrator_port_only.py`
**進捗状況**: 完了

## ステージ13: Phase D — Ingress 分離と RevisionAuthority
**目的**: 取り込み主線を Ingress pipeline として切り出し、LiveKitAgent を adapter 化し、暫定字幕 revision を単一 lifecycle に集約する（tickets 09–12）。
**成功条件**:
- Ingress pipeline が frame／end／cancel を受け downstream を公開する
- LiveKitAgent が frame／end adapter に縮小されている
- RevisionAuthority が begin／advance／finalize／release の単一権威である
- Ingress／Runtime interim が RevisionAuthority 経由である
**タスク分解**:
- [09] Ingress pipeline 切り出し
- [10] LiveKitAgent adapter 縮小
- [11] RevisionAuthority lifecycle
- [12] interim を RevisionAuthority に配線
**Tests**:
- `backend/tests/test_ingress_pipeline.py`
- `backend/tests/test_agent_adapter.py`
- `backend/tests/test_agent_queue.py`
- `backend/tests/test_revision_authority.py`
- `backend/tests/test_wire_interim_revision_authority.py`
**進捗状況**: 完了

## ステージ14: Phase E — duck typing 除去と旧 QoS deletion 判定
**目的**: 本番経路から実行時ダックタイピングを除去し、旧 QoS 系の deletion test／利用 inventory を設ける（tickets 13–14）。削除実行は含まない。
**成功条件**:
- HearingOutput／generation-aware capture が必須の厳密 adapter contract になる
- 旧 QoS の production 到達可能性と品質 behavior baseline を deletion test が検証する
- 利用残存時は即時削除せず inventory／方針が残る
**タスク分解**:
- [13] 本番経路の duck typing 除去
- [14] 旧 QoS deletion test／inventory（記号削除は optional 別途）
**Tests**:
- `backend/tests/test_strict_adapter_contracts.py`
- `backend/tests/test_legacy_qos_deletion.py`
**進捗状況**: 完了

## architecture-deepening クローズメモ
**対象**: `.scratch/architecture-deepening/` tickets 01–14（Phase A–E）
**状態**: 全完了（2026-07-28 締め作業時点）
**残課題（optional）**: ticket 14 は判定材料のみ。旧 QoS 記号の実削除は本トラック外の follow-up。
**参照**: `.scratch/architecture-deepening/PHASES.md` / `README.md`
