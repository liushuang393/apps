# 05 — Output Manager を独立 module として公開 interface 化する

**What to build:** 型付きの出力命令を一つ渡すと、受聴者ポリシーに従って字幕・暫定字幕・翻訳音声・品質イベントの誰へ何が届き何が抑止されるかが、実 LiveKit なしの記録型 adapter で観測できる。AI 主線は transport 詳細を知らなくてよい。

**Blocked by:** 01 — QoE 縮退 evaluate 権威を型付きで確立する; 04 — サーバ・クライアント共有の型付きイベント契約を往復検証する

**Status:** done

- [x] 型付き出力命令を受ける単一の Output Manager 公開 interface がある
- [x] 記録型 fake adapter で、読む主線先行・話者除外・購読無効・同一言語重複抑止・旧 generation 抑止・個別失敗隔離・確定による interim 終了が検証できる
- [x] QoE decision の可否フラグを再計算せず消費する
- [x] イベントは型付き command／encoder 経由で発行され、任意辞書を transport へ直接渡さない
- [x] Output Manager 本体は transport 非依存で、LiveKit 固有は adapter 側に残る
- [x] 既存後方互換フィールドと topic は移行期間中維持する

**Phase:** B  
**Spec:** issues/01-output-manager-module.md  
**Candidate:** 1
