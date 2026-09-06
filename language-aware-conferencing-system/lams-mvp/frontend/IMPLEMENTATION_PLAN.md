# Frontend CSS 利用方別分割

## ステージ1: ベースラインと帰属表
**目的**: 分割前後で比較できる基準を固定する
**成功条件**:
- 対象 CSS/TSX が UTF-8 であること
- 12ページ・5コンポーネントの root class / 現行 CSS import が記録されている
**タスク分解**:
- エンコーディング確認
- 利用方とセレクタ帰属の確定
**Tests**: `file -bi` / `rg className=`
**進捗状況**: 完了

## ステージ2: 主層抽出
**目的**: tokens / base / shared を切り出し、`main.css` を薄い入口にする
**成功条件**:
- `App.tsx` は `main.css` のみ（ページ CSS を全量 import しない）
- 主層各ファイルが目的どおりに分離されている
**タスク分解**:
- `_tokens.css` / `_base.css` / `_shared.css` 作成
- `main.css` を `@import` 入口へ縮小
**Tests**: セレクタ欠落比較
**進捗状況**: 完了

## ステージ3: ページ子層と import
**目的**: 利用ページ別に CSS を移設し、各 TSX から import する
**成功条件**:
- 各利用 TSX の CSS import ≤ 3
- ページ私有スタイルは当該 page のみが import
**タスク分解**:
- `pages/*.css` 作成と既存 `ai-pipeline-settings.css` の移設
- 各 page TSX の import 更新
- `App.tsx` で `main.css` をページ import より先に読み込む
**Tests**: `rg "\\.css"` で import 数確認
**進捗状況**: 完了

## ステージ4: 整合性・品質ゲート
**目的**: 視覚同等性と静的チェックを通す
**成功条件**:
- type-check / lint / build 緑
- CSS import 上限と宣言欠落なし
**タスク分解**:
- 宣言比較・import 上限確認
- `npm run type-check && npm run lint && npm run build`
**Tests**: frontend 品質ゲート
**進捗状況**: 完了

## 結果サマリ（2026-09-06）
### 構成
```
frontend/src/styles/
  main.css                 # tokens/base/shared の薄い入口
  _tokens.css
  _base.css
  _shared.css
  pages/
    auth.css
    menu.css
    room-list.css
    room.css               # Room 専用コンポーネント + meeting-mode-panel 含む（916行）
    transcript.css
    admin.css
    language-settings.css
    ai-pipeline-settings.css
```

### import 数
| TSX | CSS imports |
|-----|-------------|
| App.tsx | 1 (`main.css`) |
| 認証4ページ | 1 (`auth.css`) |
| 各通常ページ | 1 |
| AiPipelineSettingsPage | 2 |
| components/* | 0 |

### 検証
- baseline クラス集合の欠落: なし
- `npm run type-check` / `lint` / `build`: 成功
- 本番バンドル CSS に主要セレクタ含有を確認
- 画面の目視比較: 本環境でフロント未起動のため未実施（起動後にログイン・部屋一覧・会議室・admin・ai-pipeline を確認すること）

### 意図的にやらなかったこと
- `.warning` / `.experiment-*` / `@keyframes blink` の新設
- 死セレクタ削除
- root class 変更・見た目の美化
