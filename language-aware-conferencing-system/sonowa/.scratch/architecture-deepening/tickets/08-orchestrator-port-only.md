# 08 — orchestrator を Port／registry 公開面だけに依存させる

**What to build:** 主線制御側が具体 Runtime class・mode・設定参照・generation tracker を直接触らず、registry が session 所有・再利用・解放を担う。会議終了時に全 session が close され、実装差は宣言された capability に限定される。

**Blocked by:** 07 — RealtimeRuntimePort の session/turn contract suite を本物にする

**Status:** done

- [x] orchestrator が具体 mode・実装 class・内部 tracker を import／操作しない
- [x] mode 選択と factory は composition root で解決される
- [x] registry が session key ごとの所有・上限・release speaker／room を一箇所で管理する
- [x] 持続実装固有の接続再利用・再接続・上限 fallback・room release が capability 別テストで明示される
- [x] orchestrator 側の runtime 内部依存 assertion が contract suite へ移されている
- [x] session close は冪等で、途中失敗後も資源解放を試みる

**Phase:** C  
**Spec:** issues/03-realtime-runtime-port-seam.md  
**Candidate:** 3
