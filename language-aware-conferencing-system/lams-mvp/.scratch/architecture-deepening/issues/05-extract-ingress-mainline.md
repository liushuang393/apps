Status: ready-for-agent

# 05. 取り込み主線を LiveKitAgent から切り出す

## Problem Statement

LiveKitAgent は LiveKit room の接続とイベント登録に加え、AudioStream の生成、VAD/segmenter 構成、partial/final の enqueue、話者別 Queue、Ingress 観測、worker、QoE 状態、参加者同期、sink factory、会議終了処理を担っている。取り込み主線の制御が transport gateway と同居し、class の depth が過剰に広い。

この配置では、確定発話保護、tail flush、partial の使い捨て、Queue overload、worker 順序を検証するために LiveKitAgent の private method と private state を直接操作するテストが必要になる。LiveKit 固有イベントと純粋な取り込み policy の locality が低く、別入力 adapter や負荷試験 harness で主線だけを再利用しにくい。

## Solution

音声フレームから partial/final segment の処理要求へ至る取り込み主線を独立 module として切り出す。LiveKitAgent は room/track lifecycle と adapter 変換に限定し、トラックごとに Ingress pipeline を生成して frame、end、cancel を渡す。

取り込み module は VAD/segmenter、話者別 Queue、soft/hard/max-age decision、worker lifecycle、tail flush、overload observation を所有する。確定発話を処理する downstream interface と暫定字幕を処理する downstream interface を注入し、LiveKit や DB を知らない構造にする。

## User Stories

1. 会議参加者として、通常過負荷でも確定発話を失いたくない。そうすれば読む主線と正式記録が欠落しない。
2. 会議参加者として、過負荷時は暫定字幕と翻訳音声が先に縮退してほしい。そうすれば確定発話を優先できる。
3. 会議参加者として、トラックが異常終了しても末尾の発話が可能な限り flush されてほしい。そうすれば切断直前の発言が消えにくい。
4. 会議参加者として、話者ごとの発話順が維持されてほしい。そうすれば字幕と記録の順序が入れ替わらない。
5. 複数話者の会議参加者として、一人の遅い処理が他話者の取り込みを止めないでほしい。そうすれば同時発話でも会議を継続できる。
6. LiveKit adapter 開発者として、受信 frame を取り込み interface へ渡すだけにしたい。そうすれば rtc event の責務が明確になる。
7. パイプライン開発者として、実 LiveKit track なしで frame から segment 処理までを検証したい。そうすれば高速な負荷・境界テストを作れる。
8. 運用担当者として、Queue depth、age、drop、overload を取り込み module の snapshot から確認したい。そうすればデータ欠落の兆候を追跡できる。
9. QoE 開発者として、取り込み module から事実として overload を受け取りたい。そうすれば縮退 policy を LiveKitAgent 内へ複製せずに済む。
10. テスト担当者として、private Queue や private worker を直接呼びたくない。そうすれば refactor に強い外部挙動テストになる。
11. 将来の file replay 開発者として、同じ取り込み主線へ音声 frame を投入したい。そうすれば LiveKit 固有ロジックを複製せずに済む。
12. 障害対応者として、downstream が一発話で失敗しても worker が次の確定発話を処理してほしい。そうすれば局所的な Provider 障害で話者主線が停止しない。
13. リソース管理者として、track 終了時に Queue と worker が確実に閉じてほしい。そうすれば zombie task とメモリリークを防げる。
14. アーキテクトとして、transport adapter と取り込み policy の interface を明示したい。そうすれば module の depth と locality が改善する。
15. 既存利用者として、LiveKit を Media Plane として維持したい。そうすれば境界整理が transport 移行へ拡大しない。

## Implementation Decisions

- 独立 Ingress pipeline は frame 入力、終了、cancel、snapshot の公開 interface を持つ。
- pipeline は VAD/segmenter、partial/final lane、Queue、worker、tail flush を所有する。
- LiveKitAgent は track を PCM frame へ変換し pipeline へ渡す adapter に限定する。
- downstream は確定発話処理と暫定字幕処理の型付き callback/interface とし、LiveKit 型を受け取らない。
- 話者ごとに pipeline instance を分離し、順序と状態の locality を保つ。
- soft limit では確定発話を受理して overload を報告し、hard/max-age のみ理由付き破棄を許可する。
- partial は確定発話の容量を奪わない最新優先 policy とする。
- downstream 例外は観測して次 item の処理を継続するが、cancel は速やかに伝播させる。
- end は tail flush、終端 signal、worker 回収を順に行い、冪等にする。
- QoE decision 自体は pipeline で行わず、Queue 観測値を QoE authority へ報告する。

## Testing Decisions

- 良いテストは private Queue の内容ではなく、frame/segment 入力に対して downstream へ届く確定発話、順序、drop reason、snapshot を検証する。
- 優先する既存シームは SegmentIngress の純ロジックと注入可能な segment downstream である。
- 最高位の提案シームは独立 Ingress pipeline の公開 interface 一つで、fake downstream と制御時計を注入する。
- 必須シナリオは、順序維持、話者分離、soft no-drop、hard/max-age 明示 drop、partial 優先度、downstream 例外後の継続、異常終了 tail flush、end/cancel の資源回収である。
- 既存 agent queue、segment ingress、segmenter partial のテストを prior art とし、private method を直接呼ぶテストは公開 seam へ移行する。
- LiveKit 統合テストは track event が pipeline へ frame と end を渡す配線だけを確認する。

## Out of Scope

- SpeechSegmenter の VAD アルゴリズム変更。
- Queue の外部 broker 化。
- LiveKit から別 Media Plane への変更。
- SegmentProcessor の ASR、翻訳、DB 永続化の再設計。
- QoE の縮退優先順位変更。

## Further Notes

提案シームは、frame/end/cancel を受けて確定・暫定 downstream と観測 snapshot を公開する Ingress pipeline interface 一つである。既存 SegmentIngress と worker の振る舞いを内包し、テストは LiveKitAgent の private method ではなくこの高位 seam を通す。このシーム形状は **ユーザー確認待ち**。
