Status: ready-for-agent

# 08. 旧 QoS 系に deletion test を設ける

## Problem Statement

現在の品質制御には、HybridQoSMonitor と QoE 状態機械に加えて、旧来の QoSController、AdaptiveQoSController、関連する metrics/state/level が同じ領域に残っている。旧系が production で実際に使われているか、互換 API として必要か、完全に dead code かが module 境界から明確ではない。

根拠なく削除すると隠れた import や運用依存を壊す一方、残し続けると縮退 authority が複数あるように見え、新規実装が誤って旧 controller を再利用する可能性がある。候補は speculative であるため、先に「削除しても外部挙動が変わらない」ことを証明する deletion test と利用実態の確認が必要である。

## Solution

旧 QoS symbols の runtime reachability と public compatibility を調査し、削除可能性を自動検証する deletion test を追加する。production composition から旧系への import、生成、公開 API 利用がゼロであり、現行 QoE/HybridQoS の behavior suite が通ることを削除条件とする。

利用が見つかった場合は直ちに削除せず、現行 QoE authority または HybridQoSMonitor へ移行する adapter 計画を作る。利用がなく deletion test が成立した場合だけ、旧 controller と専用型を小さな別変更で削除する。

## User Stories

1. 会議参加者として、不要コードの削除で翻訳音声の縮退や字幕 fallback が変わらないでほしい。そうすれば保守作業が会議品質を壊さない。
2. 会議参加者として、聞く主線の縮退 authority が一つであってほしい。そうすれば同じ遅延に対する挙動が一貫する。
3. backend 開発者として、どの QoS/QoE API が現役か明確に知りたい。そうすれば新機能を旧 controller へ誤って追加しない。
4. アーキテクトとして、dead code を推測ではなく reachability と behavior で削除判断したい。そうすれば安全性と単純性を両立できる。
5. テスト担当者として、旧 symbols の削除前後で現行 QoE behavior が同じことを確認したい。そうすれば deletion refactor を独立に検証できる。
6. 運用担当者として、遅延 warning、用語命中率、数字保持率の観測を維持したい。そうすれば監視の連続性が失われない。
7. API 利用者として、もし旧 QoS API が外部公開されているなら事前に非推奨化してほしい。そうすれば突然の破壊的変更を避けられる。
8. リリース担当者として、旧系が再導入されない guard を持ちたい。そうすれば削除後の architecture drift を防げる。
9. QoE 開発者として、Media、AI、Queue、Provider の制御を現行 authority に集中させたい。そうすれば旧 latency controller と競合しない。
10. 保守担当者として、利用されない settings 参照や型も一緒に整理したい。そうすれば設定の意味が明確になる。
11. セキュリティ担当者として、使われない診断経路を残したくない。そうすれば不要な attack surface とログ経路を減らせる。
12. 将来の開発者として、deletion test が失敗したとき実際の production dependency を特定したい。そうすれば単純な symbol 名検索の false positive に悩まされない。
13. CI 管理者として、source layout の細部ではなく禁止された production dependency を検出したい。そうすれば正当な module 移動を妨げない。
14. 既存利用者として、削除候補が speculative である間は動作コードを先に消してほしくない。そうすれば調査不足による回帰を防げる。
15. プロジェクト管理者として、削除、移行、維持の判断根拠を issue に残したい。そうすれば後から同じ調査を繰り返さずに済む。

## Implementation Decisions

- 本仕様の第一成果物は deletion test と利用実態の判定であり、旧系削除そのものを前提にしない。
- production composition、runtime import、公開 API、テスト専用 import を区別して inventory する。
- 削除条件は、production reachability がゼロ、外部互換契約がない、現行 QoE/HybridQoS behavior が代替している、全品質ゲートが通ることとする。
- symbol 名の単純な全文検索だけを deletion test にせず、production module の import/dependency boundary を検証する。
- 旧系の利用が見つかった場合は、用途を測定、warning、縮退 decision のいずれかへ分類する。
- 測定は HybridQoSMonitor、縮退 decision は QoE authority へ移し、旧 controller への新規依存を禁止する。
- 外部互換が必要な場合は deprecation 期間と adapter を設け、即時削除しない。
- 削除変更は QoE 単一 authority の仕様と整合後に別の小さな変更として行う。
- deletion test は旧系が production dependency として再導入された場合に失敗する。

## Testing Decisions

- 良い deletion test は class の行番号やファイル名ではなく、production composition が旧 QoS contract に依存しないことと、現行の外部品質挙動が維持されることを検証する。
- 優先する既存シームは HybridQoSMonitor の測定 interface と QoEStateMachine の decision interface である。
- 最高位の提案シームは、production composition の品質制御を構築して現行 monitor/QoE だけが到達可能であることを検証する architecture/deletion seam 一つである。
- behavior baseline は hearing P95 warning、縮退 decision、cooldown 回復、用語命中率、数字保持率を含む。
- 旧 symbols を直接テストする既存テストがある場合、外部要件を現行 seam の behavior test へ移してから削除する。
- import boundary guard は test module や migration adapter を必要に応じて許可し、production への再導入だけを禁止する。
- 削除後は全 backend test と静的解析を実行し、設定参照の残骸も確認する。

## Out of Scope

- 本仕様だけで旧 QoS 系を即時削除すること。
- HybridQoSMonitor の用語・数字評価ロジック変更。
- QoE 閾値の調整。
- frontend の状態表示変更。
- observability 基盤の全面刷新。

## Further Notes

提案シームは、production composition から品質制御を組み立て、現行 HybridQoSMonitor と QoE authority の外部 behavior を確認しつつ旧 QoS contract が到達不能であることを示す architecture/deletion test 一つである。削除の実行はこのテストと利用 inventory の結果次第であり、現時点では speculative のまま **ユーザー確認待ち**。
