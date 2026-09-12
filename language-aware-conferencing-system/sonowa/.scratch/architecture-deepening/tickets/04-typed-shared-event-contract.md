# 04 — サーバ・クライアント共有の型付きイベント契約を往復検証する

**What to build:** 字幕・暫定字幕・QoE・割込みなどのイベントが、同じ canonical 契約としてサーバで encode・クライアントで decode される。不正・未知 version／type でも会議 UI はクラッシュせず、契約ドリフトは共有 fixture の往復テストで検出される。

**Blocked by:** None — can start immediately（Phase A と並行可）

**Status:** done

- [x] event type を discriminator とする versioned union と共通 envelope／payload 分離が定義されている
- [x] 同一 canonical fixture が server encoder → client decoder を往復し、全主要 variant と最小必須フィールドをカバーする
- [x] 未知 schema version・未知 type・欠損・型不正はクラッシュせず無視（または診断カウンタのみ）できる
- [x] version 1 既存フィールドは維持され、新規は optional の加算的拡張に限る
- [x] 手書き二重定義を避け、canonical schema から両言語の型または validator を得る方針が実装されている
- [x] 診断 event に会議本文・Token・API Key が含まれない

**Phase:** B  
**Spec:** issues/04-typed-shared-event-contract.md  
**Candidate:** 4
