Status: ready-for-agent

# 03. RealtimeRuntimePort の seam を本物にする

## Problem Statement

RealtimeRuntimePort は存在し、短命 Runtime と持続 Runtime がその形状を実装している。しかし呼出側は Runtime の generation tracker、原文 setter、commit 後の events 取得順序、registry の具体的な mode 選択などライフサイクル詳細を知っている。これにより interface は Provider SDK を隠していても、完全な module 境界にはなっていない。

また、複数メソッドを正しい順序で呼ばなければならず、turn の atomic な意味が呼出側へ漏れている。実装ごとの契約差を同じテストで保証する仕組みも弱く、TEN adapter や別 Provider Runtime を追加した際に、世代管理、再接続、close、イベント終端の意味がずれる恐れがある。

## Solution

RealtimeRuntimePort を、会議セッションのライフサイクルと一つの発話 turn を明確に表す本物の seam にする。呼出側は型付き session context と turn input を渡し、Runtime は型付き event stream または turn result を返す。generation の発行・interrupt・終端イベント・再接続 fallback は Port 契約内で一貫させる。

registry は Port の factory/owner として session key ごとの再利用と release を担うが、orchestrator は具体 mode、実装 class、内部 tracker を直接扱わない。短命実装と持続実装は同一の contract suite を通過し、実装差は接続再利用など明示された capability に限定する。

## User Stories

1. 翻訳音声を聞く参加者として、Runtime 実装が短命でも持続型でも同じ会議動作を得たい。そうすれば設定変更で機能差が生じない。
2. 会議参加者として、barge-in 後に旧 generation の音声や delta を受け取りたくない。そうすれば会話ターンが混線しない。
3. 会議参加者として、Provider 切断中も読む主線へ安全に縮退してほしい。そうすれば聞く主線の障害で確定字幕を失わない。
4. 会議参加者として、Provider が回復したら定義された規則で聞く主線へ戻ってほしい。そうすれば復旧挙動が実装ごとに変わらない。
5. Runtime 開発者として、一つの turn を開始するための必須入力と返るイベントを interface だけで理解したい。そうすれば呼出順序の暗黙知に頼らず実装できる。
6. orchestrator 開発者として、append、commit、events の細かな手順や tracker を管理したくない。そうすれば主線制御に集中できる。
7. registry 開発者として、session key ごとの所有権、再利用、解放を一箇所で管理したい。そうすれば orphan connection を防げる。
8. テスト担当者として、同じ contract suite を全 Runtime 実装へ適用したい。そうすれば adapter 追加時の契約逸脱を早期に検出できる。
9. 運用担当者として、session open、reconnect、fallback、close を共通イベントで追跡したい。そうすれば実装を問わず障害を比較できる。
10. 将来の TEN adapter 開発者として、LAMS の room、RBAC、Output Manager を TEN 内部へ移したくない。そうすれば TEN を Port 背後の交換可能な adapter に保てる。
11. セキュリティ担当者として、Runtime context に必要最小限の識別情報だけを渡したい。そうすれば Token や秘密情報が共通イベントへ漏れない。
12. 負荷試験担当者として、会議終了時に全 session が close されたことを確認したい。そうすれば接続とメモリのリークを検出できる。
13. Provider adapter 開発者として、capability の違いを明示的に宣言したい。そうすれば unsupported な interrupt や streaming を暗黙に模倣せずに済む。
14. アーキテクトとして、Runtime interface の depth を高め、呼出側に Provider ライフサイクルを漏らしたくない。そうすれば実装交換の leverage が上がる。
15. 既存利用者として、既定の per-utterance 動作を維持したい。そうすれば段階移行中の後方互換性が保たれる。

## Implementation Decisions

- Port の公開契約は session lifecycle と turn execution を中心に再定義し、正しい呼出順序を interface の形状で表す。
- turn input は utterance、音声、原文、言語、世代文脈を型付きでまとめる。
- Runtime event は自由文字列と任意辞書だけに依存せず、既知の event variant と終端規則を持つ。
- generation の発行と active 判定の owner を Port/registry 側で一貫させ、orchestrator は内部 tracker を操作しない。
- registry は session key ごとの instance 所有、上限、release speaker、release room を担う。
- mode 選択と実装 factory は composition root で解決し、orchestrator が設定値や具体 Runtime を import しない。
- 短命実装と持続実装は同じ functional contract を満たす。接続回数などの performance characteristic は capability 別テストとする。
- reconnect 上限後の fallback は contract 上の状態遷移とし、呼出側へ一貫した degraded event を返す。
- session close は冪等とし、途中失敗後にも資源解放を試みる。
- 既定動作は段階移行のため per-utterance を維持する。

## Testing Decisions

- 良いテストは内部 WebSocket や private buffer ではなく、Port を通した turn の event 順序、世代抑止、fallback、close を検証する。
- 優先する既存シームは RealtimeRuntimePort と注入可能な runtime registry である。
- 最高位の提案シームは RealtimeRuntimePort の共通 contract suite 一つであり、短命・持続・将来 adapter の factory を同じ suite に渡す。
- 共通必須シナリオは、open の冪等性、一 turn の完了、終端 event、interrupt 後の旧出力抑止、close の冪等性、失敗の型付き通知である。
- 持続実装固有シナリオは同一 session key の接続再利用、再接続、上限 fallback、room release とする。
- 既存 Runtime 単体テストを prior art とし、orchestrator 側の runtime 内部に依存する assertion は contract suite へ移す。

## Out of Scope

- TEN Framework adapter の実装。
- Provider モデルや prompt の変更。
- LiveKit transport の置換。
- 音声 codec の再設計。
- Runtime の性能優位を保証すること。性能は別途同一条件で測定する。

## Further Notes

提案シームは、Runtime factory を差し替えて同じライフサイクル・turn・event 契約を検証する RealtimeRuntimePort 共通 contract suite 一つである。orchestrator から内部 tracker、具体 mode、設定参照を外し、Port/registry の公開動作だけを観測する。このシーム形状は **ユーザー確認待ち**。
