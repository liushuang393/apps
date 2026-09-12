Status: ready-for-agent

# 02. 縮退判定の権威を QoE 単一 module にする

## Problem Statement

縮退の判断は現在、QoE 状態機械、聞く主線の P95 を持つ QoS monitor、Ingress の overload 状態、Runtime の再接続状態、フロントの packet loss によるローカル mute に分散している。特に聞く主線の可否と回復タイミングは複数の state と cooldown により決まり、同じ観測値でも経路によって異なる結果になり得る。

この分散は、確定発話を守るために Mode A を先に止めるという重要な縮退規則を読みづらくし、誰が healthy への復帰を許可するかも曖昧にする。QoE module が存在していても、判定の唯一の権威になっていないため、module の depth と leverage が十分ではない。

## Solution

Media、AI、Queue、Provider の観測値を一つの QoE module に集約し、その module が縮退状態、聞く主線の可否、読む主線の優先、暫定字幕の可否、回復可否を決定する唯一の権威となる。

既存 monitor は測定と品質警告の生成に限定し、hearing を止める最終判断を返さない。Ingress、Runtime、LiveKit client adapter は事実を QoE input として報告し、Output Manager と orchestrator は QoE decision を消費する。クライアント固有の packet loss は受聴者単位の local decision として同じ policy shape に写像し、サーバ全体の Mode A を誤って止めない。

## User Stories

1. 翻訳音声を聞く参加者として、packet loss が高い自分だけ字幕へ縮退したい。そうすれば他参加者の正常な翻訳音声を止めずに済む。
2. 会議参加者として、Queue 過負荷時に暫定字幕と Mode A が先に止まり、確定発話の読む主線が継続してほしい。そうすれば正式な内容を失わない。
3. 会議参加者として、Provider 再接続中は不完全な音声ではなく確定字幕を受け取りたい。そうすれば障害中も会話を追える。
4. 会議参加者として、品質が回復した直後に音声が頻繁に on/off されないでほしい。そうすればフラッピングによる聞きづらさを避けられる。
5. 会議参加者として、回復条件が満たされた後は翻訳音声へ自動復帰してほしい。そうすれば手動で設定し直す必要がない。
6. 運用担当者として、現在の縮退理由を一つの決定結果から確認したい。そうすれば Queue、Provider、Media のどれが原因か特定できる。
7. 運用担当者として、同時に複数の劣化が発生したときの優先理由を知りたい。そうすれば復旧順序を説明できる。
8. パイプライン開発者として、QoS monitor へ遅延を記録するだけで、直接 Mode A の停止まで起こしたくない。そうすれば測定と制御を分離できる。
9. LiveKit adapter 開発者として、RTCStats を本文なしの観測値として報告したい。そうすれば会議内容を漏らさず QoE を判断できる。
10. Runtime 開発者として、再接続状態を QoE input として通知したい。そうすれば Runtime 内に別の縮退 policy を複製せずに済む。
11. テスト担当者として、時刻を制御して縮退・ヒステリシス・回復を決定論的に検証したい。そうすれば不安定な sleep ベーステストを避けられる。
12. アーキテクトとして、聞く主線の enable/disable を決める module を一つにしたい。そうすれば新しい品質指標を局所的に追加できる。
13. UI 開発者として、degraded、interrupted、recovered を一貫した理由コードで受け取りたい。そうすれば表示ロジックをサーバ内部の条件に依存させずに済む。
14. 管理者として、品質警告と実際の縮退 decision を区別したい。そうすれば品質目標未達の観測とサービス動作を正確に把握できる。
15. セキュリティ担当者として、QoE input と decision に会議本文、Token、API Key を含めたくない。そうすれば診断経路を安全に保てる。
16. 将来の開発者として、新しい指標を追加しても既存の縮退優先順位を一箇所で確認したい。そうすれば制御規則の矛盾を防げる。

## Implementation Decisions

- QoE module を縮退と回復の唯一の authority とし、公開 input と decision を型付きにする。
- input は Media、AI、Queue、Provider の観測事実を表し、未計測値は正常値ではなく unknown として扱う。
- decision は状態、主要理由、補助理由、聞く主線可否、読む主線可否、partial 可否、changed を含む。
- 縮退優先順位は、確定発話を守る Queue overload、Provider recovering、AI hearing degraded、受聴者単位 Media degraded の順序を明示する。
- server decision と listener-local decision を区別し、個人の RTCStats で会議全体の Mode A を止めない。
- Hybrid QoS monitor は P95、用語命中率、数字保持率などの測定と warning に限定する。
- 回復のヒステリシスと cooldown は QoE authority に集約し、monitor 側で独自に履歴を破棄して復帰させない。
- Output Manager と orchestrator は decision を再計算せず、その可否フラグと理由を消費する。
- 既存イベントは加算的に理由コードを持たせ、旧クライアントの fallback フラグを維持する。

## Testing Decisions

- 良いテストは内部 state 変数ではなく、観測系列に対して返る decision と外部の主線可否を検証する。
- 優先する既存シームは時計を注入できる QoEStateMachine の evaluate である。
- 最高位の提案シームは、全観測値を一度に受ける QoE authority の evaluate interface 一つとする。
- 必須シナリオは、各単独劣化、複合劣化の優先順位、unknown stats、受聴者単位 Media 劣化、Queue 時の partial/Mode A 停止、cooldown 中の維持、回復後の changed である。
- orchestrator の既存縮退テストと QoE 状態機械テストを prior art とし、monitor のテストは測定と warning に絞る。
- 結合テストでは QoE decision を注入し、聞く主線が止まり読む主線と確定発話が継続する外部挙動だけを確認する。

## Out of Scope

- RTCStats の新しい収集方式や送信周期の全面変更。
- QoE ダッシュボードの実装。
- provider 固有の再接続アルゴリズム変更。
- 確定発話を hard limit または max age で破棄する規則の変更。
- QoS の用語命中率・数字保持率計算式の変更。

## Further Notes

提案シームは、型付き QoE input を受けて主線可否と理由を含む decision を返す既存 QoEStateMachine 相当の公開 evaluate interface 一つである。時計注入を維持し、Ingress、monitor、Runtime、LiveKit adapter は観測値の producer、Output Manager と orchestrator は decision の consumer に限定する。このシーム形状は **ユーザー確認待ち**。
