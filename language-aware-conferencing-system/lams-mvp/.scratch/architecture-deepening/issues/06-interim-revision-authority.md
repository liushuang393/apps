Status: ready-for-agent

# 06. 暫定字幕 revision の権威を一つにする

## Problem Statement

暫定字幕の revision は、LiveKit 取り込み側で話者単位に採番される経路と、orchestrator 内で utterance と目標言語単位に採番される経路がある。確定字幕による終了処理や退室時の掃除も複数の state owner に分散している。このため、同じ「revision」が何を単位に単調増加するかが経路によって異なる。

partial ASR と聞く主線 transcript delta が同じ表示領域へ到達する場合、別々の authority が同じ発話の revision を発行すると、逆転、再入室後の残留、final 後の遅延 interim 復活が起き得る。フロントの逆転 guard だけでは producer 側の不整合を隠すに留まり、責務の locality が低い。

## Solution

暫定字幕 revision を発行・比較・終了する単一 module を導入し、すべての interim producer はその authority から revision token を取得する。authority の key は room、speaker、utterance、subtitle stream を明示し、発話確定、取消、退室、room 終了で状態を解放する。

Output Manager は authority が発行した token をイベントへ載せ、勝手に再採番しない。クライアント store は引き続き防御的に逆転を無視するが、最終的な正しさの責任は server の revision authority に置く。

## User Stories

1. 会議参加者として、暫定字幕が新しい内容へだけ更新されてほしい。そうすれば古い認識結果へ巻き戻らない。
2. 会議参加者として、確定字幕到着後に遅延した暫定字幕が復活しないでほしい。そうすれば表示が不安定にならない。
3. 会議参加者として、partial ASR と Mode A transcript delta が同じ発話として整合してほしい。そうすれば二つの暫定行が競合しない。
4. 再入室した参加者として、前回接続の revision 状態を引き継ぎたくない。そうすれば新しい発話が正常に表示される。
5. 複数言語の字幕を読む参加者として、各 subtitle stream の更新順が独立してほしい。そうすれば一言語の遅延が別言語の更新を抑止しない。
6. backend 開発者として、revision を辞書で個別管理したくない。そうすれば採番と cleanup の規則を一箇所で変更できる。
7. Output Manager 開発者として、確定済み token の interim を配信前に拒否したい。そうすれば transport 到達前に遅延更新を止められる。
8. frontend 開発者として、server が単調な revision を保証してほしい。そうすれば client guard を防御策として単純に保てる。
9. テスト担当者として、一つの authority へ begin、advance、finalize、release を入力して状態遷移を検証したい。そうすれば複数 class の private map を調べずに済む。
10. 運用担当者として、revision stream の残留数を本文なしで観測したい。そうすれば cleanup 漏れを検出できる。
11. Runtime 開発者として、transcript delta を発行するとき同じ utterance の revision token を使いたい。そうすれば Runtime 内部の sequence を wire 契約へ直接露出せずに済む。
12. Ingress 開発者として、partial segment ごとに独自 counter を持ちたくない。そうすれば発話境界の変更で二重 state が生じない。
13. アーキテクトとして、revision の authority と event encoder を分離したい。そうすれば採番 policy と wire format の責務が明確になる。
14. 障害対応者として、out-of-order event が来ても確定字幕が権威を持ってほしい。そうすればネットワーク遅延で表示が逆行しない。
15. 既存利用者として、現在の client 側 revision guard を維持したい。そうすれば段階移行中も安全性が保たれる。

## Implementation Decisions

- revision authority は room、speaker、utterance、stream key ごとの単調増加を所有する。
- interim producer は authority の advance を呼び、返された token を Output Manager へ渡す。
- final は対象 stream を finalize し、それ以後の古い token を無効にする。
- cancel、participant leave、room close は明示的な release を呼び、state を残さない。
- partial ASR と hearing transcript delta が同じ表示 stream を共有するか別 stream とするかを key の種別で明示する。暗黙に counter を共有しない。
- Output Manager と event builder は revision 値を生成せず、authority の値を保持する。
- client は revision 逆転と final 後 interim を防御的に無視する。
- revision は一つの utterance stream 内で単調増加し、別 utterance との大小比較に意味を持たせない。
- 空の temporary subtitle id を恒久 key として使わず、発話開始時に安定した utterance identity を割り当てる。
- authority の state 数を本文なしで snapshot 可能にし、cleanup を観測できるようにする。

## Testing Decisions

- 良いテストは private counter ではなく、発行 token の単調性、finalize 後の拒否、release 後の新 stream を検証する。
- 優先する既存シームは client store の revision guard と現在の interim message builder である。
- 最高位の提案シームは RevisionAuthority の公開 lifecycle interface 一つとし、producer 種別をまたぐ同一 utterance の更新を通す。
- 必須シナリオは、単調増加、複数 stream 独立、producer 交互更新、finalize、遅延 token 拒否、退室 cleanup、room cleanup、再入室で新 stream である。
- server authority の contract test を主とし、client store テストは不正 event に対する防御を確認する。
- 既存 orchestrator interim revision と agent leave cleanup のテストを prior art とし、二つの state owner を前提とする assertion は統合する。

## Out of Scope

- ASR 精度や partial 発行頻度の変更。
- 確定字幕の sequence_id 採番変更。
- DB への interim 永続化。
- schema version 2 の導入。
- UI の字幕レイアウト変更。

## Further Notes

提案シームは、begin/advance/finalize/release を持つ RevisionAuthority lifecycle interface 一つである。Ingress と Runtime の双方が同じ authority から token を受け、Output Manager はその token をそのまま wire event へ反映する。このシーム形状は **ユーザー確認待ち**。
