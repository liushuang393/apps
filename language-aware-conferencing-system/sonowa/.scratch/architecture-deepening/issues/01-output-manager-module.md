Status: ready-for-agent

# 01. Output Manager を独立 module として実体化

## Problem Statement

現状は HybridOrchestrator が、聞く主線・読む主線の駆動だけでなく、字幕ペイロードの構築、暫定字幕、翻訳音声、QoE イベントの収束と配信判断まで担っている。Output Manager は設計上の重要語彙として存在する一方、独立した module と interface を持たず、orchestrator 内部の複数メソッドと OutputSink 群へ分散している。

この状態では、Mode A/B の収束規則、確定発話の優先、世代管理による旧音声抑止、受聴者ごとの出力選択が一つの depth の深い境界として読めない。LiveKit 以外の adapter を追加する場合も、AI 主線の制御と配信契約を同時に理解する必要があり、変更の locality と leverage が低い。

## Solution

Output Manager を独立 module として実体化し、orchestrator は主線を駆動して型付きの収束候補を渡すところまで、Output Manager は受聴者ポリシーに従って聞く主線・読む主線を配信するところからを担当する。

Output Manager は、確定字幕、暫定字幕、翻訳音声、品質イベントを単一 interface で受け取り、世代管理、重複抑止、受聴者選択、イベント envelope 化、transport adapter 呼び出しを一貫して処理する。LiveKit 固有処理は adapter に残し、Output Manager 自体は transport 非依存とする。

## User Stories

1. 会議参加者として、読む主線の確定字幕が聞く主線の完了を待たずに届いてほしい。そうすれば翻訳音声が遅いときも発話内容を追える。
2. 翻訳音声を選んだ参加者として、自分が選択した目標言語の音声だけを聞きたい。そうすれば不要な言語トラックが再生されない。
3. 原声を選んだ参加者として、Output Manager の変更後も原声ルーティングを維持したい。そうすれば出力境界の再編で既存体験が壊れない。
4. 字幕を無効にした参加者として、自分宛ての字幕配信を受け取りたくない。そうすれば受聴者設定が一貫して守られる。
5. 発話者として、自分の翻訳音声がエコーとして返ってこないようにしたい。そうすれば会話を妨げずに話せる。
6. 会議参加者として、新しい世代が開始された後に古い翻訳音声を聞きたくない。そうすれば barge-in 後の会話文脈が混線しない。
7. 会議参加者として、暫定字幕が確定字幕で確実に置換されてほしい。そうすれば同じ発話が二重に表示されない。
8. 運用担当者として、すべてのクライアント向け出力が一つの module を通ってほしい。そうすれば配信欠落と重複の原因を一箇所で追跡できる。
9. AI パイプライン開発者として、Mode A/B の生成ロジックを transport の詳細から切り離したい。そうすれば主線の改善を LiveKit 配信に触れずに行える。
10. LiveKit adapter 開発者として、音声 capture と DataChannel 送信だけに集中したい。そうすれば adapter の責務と失敗処理が明確になる。
11. テスト担当者として、実 LiveKit Room なしで出力ポリシー全体を検証したい。そうすれば高速で決定論的な回帰テストを実行できる。
12. アーキテクトとして、Output Manager が唯一のクライアント出力境界であることを確認したい。そうすれば別経路からの無秩序な送信を防げる。
13. 障害対応者として、個別受信者への送信失敗が他の受信者や DB 記録を止めないようにしたい。そうすれば部分障害でも読む主線を継続できる。
14. 将来の transport 開発者として、Output Manager の interface を実装する adapter を追加したい。そうすれば AI 主線を変更せずに別 transport を評価できる。
15. セキュリティ担当者として、Output Manager の診断情報に会議本文や秘密情報を含めたくない。そうすれば出力観測による情報漏えいを防げる。

## Implementation Decisions

- 独立 module の公開面は、型付きの出力命令を受ける一つの Output Manager interface とする。
- 聞く主線と読む主線は Output Manager へ到達するまで独立を維持し、収束は出力命令の組み立てとして明示する。
- Output Manager は受聴者設定、話者除外、字幕購読、目標言語、世代の有効性を評価する。
- transport 固有の音声形式変換、トラック publish、DataChannel 送信は adapter の責務とする。
- イベント envelope の生成は Output Manager 側の一貫した出力規則として扱い、呼出側が任意の辞書を直接送らないようにする。
- 確定発話の読む主線は、翻訳音声の成功・失敗から独立して配信可能でなければならない。
- 個別配信の失敗は集約して観測可能にするが、別受信者への配信と正式記録を巻き戻さない。
- 既存の後方互換フィールドと LiveKit の topic は移行期間中維持する。
- orchestrator から配信補助メソッドを段階的に移し、一度に主線アルゴリズムまで再設計しない。

## Testing Decisions

- 良いテストは内部メソッドの呼出回数ではなく、入力した出力命令に対して誰へ何が配信され、何が抑止されたかを検証する。
- 優先する既存シームは注入可能な OutputSink/LiveKit adapter である。
- 最高位の提案シームは Output Manager の公開 interface 一つとし、記録型 fake adapter を差し込んで字幕、音声、イベントをまとめて検証する。
- 必須シナリオは、読む主線先行、話者本人除外、購読無効、同一言語重複抑止、旧 generation 抑止、個別送信失敗の隔離、確定による interim 終了である。
- 既存の sink 単体テストと orchestrator の収束テストを prior art とし、移行後は重複する内部テストを減らす。
- 実 LiveKit を使う統合テストは adapter の配線確認に限定し、Output Manager のポリシー網羅には使わない。

## Out of Scope

- LiveKit から別 SFU への移行。
- Mode A/B の provider 選択アルゴリズム変更。
- DB の正式会議記録の保存形式変更。
- 音声 codec、サンプルレート、Track 命名規則の全面再設計。
- UI の視覚デザイン変更。

## Further Notes

提案シームは、型付きの出力命令を受け、記録型 fake adapter へ観測可能な配信結果を出す Output Manager 公開 interface 一つである。既存 OutputSink の注入可能性を活用し、テストから orchestrator 内部や LiveKit SDK を見ない形を優先する。このシーム形状は **ユーザー確認待ち**。
