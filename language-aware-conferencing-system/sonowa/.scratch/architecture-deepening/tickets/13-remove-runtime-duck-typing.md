# 13 — 本番経路から実行時ダックタイピングを除去する

**What to build:** Hearing 戻り値と音声 capture callback が厳密な型契約になり、誤 adapter は起動時または構築時に fail fast する。正しい production／test fake は同じ契約で旧世代抑止付き配信が続き、getattr／signature introspection に依存しない。

**Blocked by:** 05 — Output Manager を独立 module として公開 interface 化する; 07 — RealtimeRuntimePort の session/turn contract suite を本物にする

**Status:** completed

- [ ] Hearing callable は HearingOutput を返し、本番主線で任意 object の属性探索を行わない
- [ ] audio capture は generation_id を含む固定 signature で、発話ごとの introspection がない
- [ ] 不正戻り値／不正 callback は空値や generation 0 への暗黙 fallback せず fail fast する
- [ ] 旧三引数等が必要な場合は名前付き legacy adapter に限定し、削除条件が見える
- [ ] production と test fake が同じ厳密 contract suite を通る
- [ ] 静的型チェックが必須検証に含まれ、外部挙動（形式・topic・世代抑止）は変わらない

**Phase:** E  
**Spec:** issues/07-remove-runtime-duck-typing.md  
**Candidate:** 7
