# 06 — 聞く・読む主線の配信を Output Manager 経由に移行する

**What to build:** 会議参加者の実体験として、確定字幕が翻訳音声完了を待たずに届き、選択言語の音声だけが再生され、原声選択・字幕オフ・自己エコー抑止・barge-in 後の旧音声抑止が Output Manager 経由でも崩れない。クライアント向け出力の追跡点が一つになる。

**Blocked by:** 05 — Output Manager を独立 module として公開 interface 化する

**Status:** done

- [x] orchestrator は主線駆動と収束候補の引き渡しまでに縮小され、配信補助が Output Manager へ移っている
  - 確定字幕・翻訳音声・Mode A interim・partial ASR・QoE・interrupted・§9 `qos_warning` はすべて Output Manager 経由。
- [x] 確定発話の読む主線は翻訳音声の成否から独立して配信される
- [x] 個別受信者への送信失敗が他受信者や正式記録を巻き戻さない
- [x] 暫定字幕が確定字幕で置換され、二重表示が起きない
- [x] 別経路からの無秩序なクライアント送信が残っていない（または禁止が検証できる）
  - partial ASR・QoE・interrupted・`qos_warning` の Sink 直送禁止を architecture test で検出。
  - `_deliver_event_group` は削除済み。
- [x] 一度に主線アルゴリズム全体を再設計せず、段階移行である

**Phase:** B  
**Spec:** issues/01-output-manager-module.md  
**Candidate:** 1
