# アーキテクチャ深化仕様一覧

Status: completed（実行チケット 01–14 すべて完了。Phase A–E クローズ）

アーキテクチャレビュー候補 1〜8 を、独立して実装判断できる仕様へ分割した。各仕様は元レポートや設計書の内容を重複転記せず、現行実装で確認できた責務分散、module 境界、interface、depth、seam、adapter、leverage、locality に焦点を当てる。

シーム形状は承認済み（「承认」）。実行チケットは [PHASES.md](PHASES.md) と [tickets/](tickets/) を参照。

## 仕様一覧

1. [Output Manager を独立 module として実体化](issues/01-output-manager-module.md) — Strong
2. [縮退判定の権威を QoE 単一 module にする](issues/02-qoe-single-authority.md) — Strong・推奨
3. [RealtimeRuntimePort の seam を本物にする](issues/03-realtime-runtime-port-seam.md) — Strong
4. [イベント契約を型付きにしサーバ・クライアントで共有](issues/04-typed-shared-event-contract.md) — Strong
5. [取り込み主線を LiveKitAgent から切り出す](issues/05-extract-ingress-mainline.md) — Worth exploring
6. [暫定字幕 revision の権威を一つにする](issues/06-interim-revision-authority.md) — Worth exploring
7. [テスト都合の実行時ダックタイピングを本番から外す](issues/07-remove-runtime-duck-typing.md) — Worth exploring
8. [旧 QoS 系に deletion test を設ける](issues/08-legacy-qos-deletion-test.md) — Speculative

## 実行チケット

フェーズ分け・依存グラフ・frontier: **[PHASES.md](PHASES.md)**

| Ticket | Title | Phase | Spec |
|--------|-------|-------|------|
| [01](tickets/01-qoe-typed-evaluate-authority.md) | QoE 縮退 evaluate 権威を型付きで確立する | A | issues/02 |
| [02](tickets/02-qoe-producers-consumers-align.md) | 観測 producer と主線 consumer を QoE decision に揃える | A | issues/02 |
| [03](tickets/03-qoe-listener-local-hysteresis.md) | 受聴者単位劣化と回復ヒステリシスを QoE に集約する | A | issues/02 |
| [04](tickets/04-typed-shared-event-contract.md) | サーバ・クライアント共有の型付きイベント契約を往復検証する | B | issues/04 |
| [05](tickets/05-output-manager-module.md) | Output Manager を独立 module として公開 interface 化する | B | issues/01 |
| [06](tickets/06-migrate-delivery-to-output-manager.md) | 聞く・読む主線の配信を Output Manager 経由に移行する | B | issues/01 |
| [07](tickets/07-realtime-runtime-port-contract.md) | RealtimeRuntimePort の session/turn contract suite を本物にする | C | issues/03 |
| [08](tickets/08-orchestrator-port-only.md) | orchestrator を Port／registry 公開面だけに依存させる | C | issues/03 |
| [09](tickets/09-ingress-pipeline-extract.md) | 取り込み主線を Ingress pipeline として切り出す | D | issues/05 |
| [10](tickets/10-livekit-agent-as-adapter.md) | LiveKitAgent を frame／end adapter に縮小する | D | issues/05 |
| [11](tickets/11-revision-authority-lifecycle.md) | 暫定字幕 RevisionAuthority を単一 lifecycle にする | D | issues/06 |
| [12](tickets/12-wire-interim-to-revision-authority.md) | Ingress／Runtime interim を RevisionAuthority 経由にする | D | issues/06 |
| [13](tickets/13-remove-runtime-duck-typing.md) | 本番経路から実行時ダックタイピングを除去する | E | issues/07 |
| [14](tickets/14-legacy-qos-deletion-test.md) | 旧 QoS 系の deletion test と利用 inventory を設ける | E | issues/08 |

**進捗:** tickets **01–14** すべて done／completed。Phase A–E 完了。  
**Frontier（すぐ着手可）:** なし。  
**残作業（optional）:** 旧 QoS 記号の実削除は ticket 14 の対象外。deletion test／inventory が許可した場合のみ、別途小さな削除変更として実施可。

## 依存関係（仕様レベル）

- 候補 2 は縮退 decision の権威を定めるため、候補 1 の Output Manager が消費する policy と候補 6 の overload 時 partial 制御の前提になり得る。
- 候補 1 と 4 は相互に leverage が高い。先に候補 4 の型付き event command を定めると Output Manager の公開面が安定するが、候補 1 の責務境界を先に確定してもよい。
- 候補 3 は独立着手可能だが、候補 7 の Runtime 戻り値ダックタイピング除去に先行すると厳密な adapter contract を決めやすい。
- 候補 5 は候補 6 に安定した utterance lifecycle を提供できるため、両方を実施する場合は 5 を先行する。
- 候補 6 は候補 1 の Output Manager と候補 4 の event contract の双方へ revision token を渡す。1・4 の interface 決定と整合させる。
- 候補 7 の capture callback 厳格化は候補 1 の adapter interface と重なるため、Output Manager 境界確定後の実施が安全である。
- 候補 8 は候補 2 で QoE authority と monitor の役割を確定した後に評価する。deletion test が成立するまでは旧 QoS 系を削除しない。

推奨順序（仕様）:

1. 候補 2（QoE authority）
2. 候補 4（共有 event contract）
3. 候補 3（Runtime Port）
4. 候補 5（Ingress mainline）
5. 候補 1（Output Manager）
6. 候補 6（revision authority）
7. 候補 7（duck typing 除去）
8. 候補 8（deletion 判定）

候補 1 と 5 は並行探索できる。候補 3 と 4 も互いの実装を待たずに contract を設計できる。  
実行時の厳密な Blocked by は [PHASES.md](PHASES.md) のチケット依存を優先する。

## シーム要約

1. **Output Manager**: 型付き出力命令を受け、記録型 fake adapter へ配信結果を出す公開 interface 一つ。
2. **QoE 単一 authority**: Media・AI・Queue・Provider の型付き input を受け、主線可否と理由を返す evaluate interface 一つ。
3. **RealtimeRuntimePort**: 全 Runtime 実装を同じ lifecycle・turn・event contract suite に通す Port seam 一つ。
4. **共有イベント契約**: canonical fixture を server encoder から client decoder へ往復させる contract seam 一つ。
5. **Ingress mainline**: frame/end/cancel を受け、確定・暫定 downstream と snapshot を公開する pipeline interface 一つ。
6. **Revision authority**: begin/advance/finalize/release を持ち、全 interim producer が共有する lifecycle interface 一つ。
7. **厳密 adapter**: HearingOutput と generation-aware capture を必須にし、production と fake が共有する contract 一つ。
8. **QoS deletion**: production composition の到達可能性と現行品質 behavior を同時に検証する architecture/deletion seam 一つ。

## 参照状況

- リアルタイム基盤改善の設計書、MiniCPM-V・TEN Framework の調査記録、引継ぎ、実装コミット、現行 hotspot と関連テストを参照した。
- 指定された一時 HTML レポートは仕様作成時点で存在しなかったため、残りの一次資料と現行コードからレビュー候補の現状を確認した。
- チケット発行は `issues/01`〜`08` を一次ソースとし、本番コード・`.env`・既存 issues は変更していない。
