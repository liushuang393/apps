# 12 — Ingress／Runtime interim を RevisionAuthority 経由にする

**What to build:** partial ASR と Mode A transcript delta が同じ権威から token を受け取り、Output Manager は再採番せず wire に載せる。参加者には暫定が巻き戻らず、確定後に遅延 interim が復活せず、複数言語 stream が互いに抑止し合わない体験が届く。

**Blocked by:** 11 — 暫定字幕 RevisionAuthority を単一 lifecycle にする; 05 — Output Manager を独立 module として公開 interface 化する; 09 — 取り込み主線を Ingress pipeline として切り出す

**Status:** done

- [x] Ingress と Runtime（hearing delta）の双方が同一 authority から advance token を取得する
- [x] Output Manager／event builder は revision を生成せず、authority の値を保持する
- [x] 確定済み token の interim は配信前に拒否できる
- [x] producer 交互更新・finalize・遅延 token 拒否が end-to-end で検証できる
- [x] 退室／room close で release が呼ばれ、二つの state owner 前提の assertion が統合されている
- [x] client store の逆転／final 後 interim 防御は維持される

**Phase:** D  
**Spec:** issues/06-interim-revision-authority.md  
**Candidate:** 6
