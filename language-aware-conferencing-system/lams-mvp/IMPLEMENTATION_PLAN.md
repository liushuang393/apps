## ステージ1: Contract — legacy OutputSink delivery 削除
**目的**: TransportAdapter（publish_audio / send_data）を唯一の配信境界にする。
**成功条件**:
- `deliver_*` / OutputSinkTransportAdapter の本番・テスト呼び出しがゼロ
- LiveKitOutputSink は publish_audio / send_data のみ
- resolve_transport_adapter は TransportAdapter 必須（fail-fast）
- 指定 pytest が緑
**タスク分解**:
- 在庫確認と factory / sink_adapter 削除
- LiveKitOutputSink から deliver_* 削除
- テストを RecordingTransportAdapter / publish_audio+send_data へ移行
- orchestrator OutputSink Protocol を TransportAdapter に置換
**進捗状況**: 完了

## ステージ2: `_subtitle_message` テスト移行と削除
**目的**: 死んだ helper を消し、字幕イベント断言を生きている経路へ移す。
**成功条件**:
- `_subtitle_message` 削除
- partial/final 断言が DefaultOutputManager 経由
- `_deliver_*_group` を再導入しない
**タスク分解**:
- test_partial_subtitle / test_orchestrator を OM 経路へ移行
- HybridOrchestrator._subtitle_message 削除
**進捗状況**: 完了

## ステージ3: 検証
**目的**: 指定 pytest + ruff が緑。
**成功条件**: ユーザー指定コマンドが成功
**タスク分解**:
- pytest 実行
- ruff check/format
**進捗状況**: 完了
