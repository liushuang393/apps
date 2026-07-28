Status: ready-for-agent

# 07. テスト都合の実行時ダックタイピングを本番から外す

## Problem Statement

本番経路には、テスト stub や旧 callback を許容するため、戻り値の属性を実行時に探索して HearingOutput へ変換する処理や、callback の signature を introspection して generation_id を渡すか決める処理がある。これらは移行互換に役立った一方、型で保証できる不一致を本番実行時まで遅らせる。

テスト都合の柔軟性が production module の分岐、fallback、inspect 依存を増やし、interface の意図を弱めている。誤った adapter が空音声や generation 0 として静かに受理される可能性があり、fail fast と明確なエラーという品質基準にも反する。

## Solution

本番の公開 interface を厳密に型付けし、production composition では正しい型の adapter だけを注入する。旧 callback や簡易 stub が必要な場合はテスト fixture または明示的な legacy adapter で変換し、本番の主線から属性探索と signature introspection を除く。

Hearing 関数は型付き HearingOutput を返し、音声 capture callback は generation_id を含む固定 signature を実装する。移行期間の adapter は composition root で一度だけ構築し、各発話や配信時に能力判定を行わない。

## User Stories

1. 会議参加者として、誤った adapter が静かに空結果へ変換されるのではなく、導入時に検出されてほしい。そうすれば本番で字幕や音声が黙って欠落しない。
2. 会議参加者として、generation_id が常に音声 capture へ渡ってほしい。そうすれば古い翻訳音声の抑止が callback 形状に左右されない。
3. backend 開発者として、Hearing 関数の戻り値を interface だけで理解したい。そうすれば getattr fallback の挙動を覚えずに済む。
4. adapter 開発者として、実装すべき callback signature を静的型検査で確認したい。そうすれば本番実行前に不一致を修正できる。
5. テスト担当者として、production code を柔軟にするのではなく、正しい fake を共有したい。そうすればテストと本番の契約が一致する。
6. アーキテクトとして、runtime duck typing を明示 adapter に置き換えたい。そうすれば module interface の depth が高まる。
7. 運用担当者として、adapter 構築失敗を起動時の明確なエラーとして確認したい。そうすれば会議中の曖昧な配信欠落を減らせる。
8. Runtime 開発者として、RuntimeEvent と HearingOutput の型変換を一箇所に限定したい。そうすれば event variant の追加が局所化する。
9. LiveKit adapter 開発者として、capture capability を毎回 introspection したくない。そうすれば hot path を単純化できる。
10. 既存テストの保守担当者として、旧三引数 callback が必要なテストだけ明示 adapter を使いたい。そうすれば互換性の期限と利用箇所が見える。
11. セキュリティ担当者として、任意 object の予期しない属性を本番経路で読みたくない。そうすれば入力面を必要な契約へ限定できる。
12. リファクタ担当者として、型エラーを無視する directive に頼らず fake を実 interface に合わせたい。そうすれば strict typing の価値を保てる。
13. QA 担当者として、不正 adapter が fail fast するシナリオをテストしたい。そうすれば fallback による不具合隠蔽を防げる。
14. 将来の開発者として、互換 adapter を削除する条件を明示したい。そうすれば暫定コードが恒久化しない。
15. 既存利用者として、正しい production adapter の外部挙動は維持したい。そうすれば型厳格化が機能変更にならない。

## Implementation Decisions

- Hearing callable の戻り値は HearingOutput に固定し、本番主線で任意 object を属性探索しない。
- audio capture callback は generation_id を含む固定の型付き signature にする。
- production adapter は composition 時に契約を満たし、発話ごとの signature introspection を行わない。
- 旧 callback を一時的に支える場合は名前付き legacy adapter とし、利用箇所と削除条件を限定する。
- テスト fake は production interface を実装する共有 fixture に揃える。
- RuntimeEvent から HearingOutput への変換は Runtime adapter の責務として明示し、orchestrator へ任意 object を返さない。
- 型不一致は起動時またはテスト時に fail fast し、空値や generation 0 への暗黙 fallback を行わない。
- strict typing を維持し、ignore directive で互換を作らない。
- 外部挙動、音声形式、topic、世代抑止 policy は変更しない。

## Testing Decisions

- 良いテストは inspect や getattr の分岐ではなく、型付き fake から期待する音声・字幕が配信され、不正 adapter が構築時に拒否されることを検証する。
- 優先する既存シームは注入可能な hearing callable と LiveKitOutputSink の capture callback である。
- 最高位の提案シームは厳密な Output/Runtime adapter contract 一つとし、production と test fake の双方に同じ型・behavior suite を適用する。
- 必須シナリオは、HearingOutput 正常処理、generation 付き capture、旧世代抑止、不正戻り値の fail fast、不正 callback の fail fast、legacy adapter の限定互換である。
- 既存 orchestrator fake と LiveKit sink テストを prior art とし、動的 dataclass や旧 signature の fake を共有 typed fake へ置き換える。
- 静的型チェックを必須検証に含め、runtime test だけで完了としない。

## Out of Scope

- 外部 Provider SDK 自体が返す動的 response object の全面排除。
- plugin SDK の構造的 typing の再設計。
- unrelated な音声・DB module の getattr/hasattr 除去。
- Output Manager 全体の実体化。
- Runtime Port のライフサイクル再設計。

## Further Notes

提案シームは、HearingOutput と generation-aware capture を必須とする厳密な adapter contract 一つである。production と test fake を同じ contract に合わせ、旧形状は必要箇所だけ明示 legacy adapter で包む。このシーム形状は **ユーザー確認待ち**。
