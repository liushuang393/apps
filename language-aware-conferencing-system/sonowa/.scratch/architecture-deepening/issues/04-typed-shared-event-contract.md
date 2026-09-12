Status: ready-for-agent

# 04. イベント契約を型付きにしサーバ・クライアントで共有

## Problem Statement

LiveKit DataChannel のイベントは schema version を持つが、サーバ側では辞書、クライアント側では unknown record からの cast として扱われる箇所が多い。イベント type ごとの必須フィールド、revision、generation、QoE reason、互換性規則がコンパイル時に結び付かず、producer と consumer が別々の理解で変更できてしまう。

字幕、暫定字幕、QoE、割込みのイベント契約が一つの識別可能な型 union になっていないため、未知 type、未知 schema version、欠損値、不正値に対する adapter の挙動が一貫しない。これにより server/client 間の変更 locality が低く、型の leverage が得られていない。

## Solution

サーバ・クライアントで共有される canonical event contract を定義し、各 event を識別可能な型として表現する。サーバは型付き builder/encoder だけからイベントを発行し、クライアントは境界 decoder で検証してから型付き event を store と UI へ渡す。

schema version の互換性方針は、既存 version の加算的拡張、未知 version の安全な無視、旧イベントの限定的受理として明示する。共有方法は一つの canonical schema から両言語の型または validator を得る形とし、手書きの二重定義を避ける。

## User Stories

1. 会議参加者として、字幕イベントの一部が不正でも画面全体がクラッシュしないでほしい。そうすれば通信異常時も会議を継続できる。
2. 会議参加者として、未知 schema version を安全に無視してほしい。そうすれば段階ロールアウト中の互換性が保たれる。
3. 会議参加者として、確定字幕と暫定字幕が event type に応じて正しく処理されてほしい。そうすれば二重表示や取り違えを防げる。
4. 会議参加者として、割込みと QoE 劣化が別の意味として表示されてほしい。そうすれば現在の状態を誤解しない。
5. backend 開発者として、必須フィールドを欠いたイベントを構築時に検出したい。そうすれば不正 payload を DataChannel へ送らずに済む。
6. frontend 開発者として、decoder 後の event を安全な discriminated union として扱いたい。そうすれば各画面で unknown cast を繰り返さずに済む。
7. テスト担当者として、同じ fixture を server encoder と client decoder の両方へ通したい。そうすれば契約のドリフトを検出できる。
8. 運用担当者として、event_id、utterance_id、generation_id、sequence_id、trace_id を一貫して追跡したい。そうすれば障害時に一つの発話を端から端まで追える。
9. Output Manager 開発者として、任意辞書ではなく型付き command からイベントを発行したい。そうすれば event ごとの invariant を守れる。
10. Runtime 開発者として、Runtime 内部 event とクライアント公開 event を adapter で明示変換したい。そうすれば内部契約を直接公開せずに済む。
11. セキュリティ担当者として、イベント型に会議本文が不要な診断 event へ本文フィールドを追加したくない。そうすれば情報最小化を強制できる。
12. 将来の mobile client 開発者として、canonical schema から同じ契約を利用したい。そうすれば Web 実装の暗黙仕様を解析せずに済む。
13. リリース担当者として、加算的変更と破壊的変更を schema version 規則で判断したい。そうすれば互換性レビューを自動化しやすい。
14. アーキテクトとして、イベント契約を server と client の共有 module として扱いたい。そうすれば境界の depth と変更 locality が高まる。
15. 既存クライアント利用者として、旧フィールドだけでも確定字幕を表示し続けたい。そうすれば段階移行でサービスが停止しない。
16. QA 担当者として、欠損、余剰、型不正、順序逆転を fixture で網羅したい。そうすれば本番でのみ起きる契約不一致を減らせる。

## Implementation Decisions

- canonical contract は event type を discriminator とする versioned union とする。
- 共通 envelope と、字幕、暫定字幕、QoE、回復、割込みなどの event-specific payload を分離する。
- server producer は型付き builder/encoder を通し、任意辞書を transport adapter へ直接渡さない。
- client は DataChannel 境界で一度だけ decode/validate し、以降は型付き event を扱う。
- 未知 schema version と未知 event type はクラッシュせず無視し、診断用の非機密カウンタだけを増やせる。
- version 1 の既存フィールドは維持し、新規 optional フィールドは加算的に追加する。
- canonical schema から Python/TypeScript の型または validator を得て、同じ列挙を二重管理しない。
- snake_case の wire format と client 内部命名の変換は decoder adapter に閉じ込める。
- event_id と timestamp は producer が発行し、revision と generation の authority から渡された値を上書きしない。
- 診断 event には本文、Token、API Key を含めない。

## Testing Decisions

- 良いテストは内部型定義の文字列比較ではなく、wire payload が server で encode され client で期待する event に decode されることを検証する。
- 優先する既存シームは event envelope builder と DataChannel 受信境界である。
- 最高位の提案シームは、共有 fixture を server encoder から client decoder まで往復させる contract seam 一つである。
- fixture は全 event variant、最小必須フィールド、optional 拡張、未知 version、未知 type、欠損、不正型を含む。
- revision 逆転や final による interim 終了は event decoder ではなく store/reducer の外部挙動として別 assertion にする。
- 既存 event テスト、orchestrator event テスト、room store の revision 挙動を prior art とする。
- 実 LiveKit 統合テストは topic と byte transport の確認に限定し、型契約の網羅は fixture contract test で行う。

## Out of Scope

- LiveKit DataChannel 以外の transport への移行。
- schema version 2 の設計。
- DB schema とイベント schema の完全統一。
- UI 文言や表示デザインの変更。
- 会議本文を診断イベントへ追加すること。

## Further Notes

提案シームは、同じ canonical fixture を server の型付き encoder と client の境界 decoder に通す往復 contract test 一つである。wire format の互換性と event variant の完全性を最高位で検証し、個々の builder や cast の実装詳細には固定しない。このシーム形状は **ユーザー確認待ち**。
