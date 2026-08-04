# 演示手順書

**前提**: 基盤は構築済み。`docker compose ps` で mariadb / executor-a / executor-b / prometheus / grafana が
`running` であること。未構築なら `scripts\install.cmd` を先に1回。

所要時間は **本編20分 + ルール追加の実演10分**。すべてリポジトリのルートから実行する。

---

## 0. 開始前の確認（2分・観客の前で流してよい）

```powershell
docker compose ps
curl.exe -s http://localhost:8081/actuator/health
curl.exe -s http://localhost:8082/actuator/health
```

| 見せる画面 | URL | ログイン |
|---|---|---|
| ルール管理 自作| http://localhost:8081/admin/ | `admin` / `admin123` | ルールを変える画面（履歴・承認・ロールバック）
| Grafana  公式OSS| http://localhost:3000 | `admin` / `admin` — **パスワード変更は必ず Skip** | 変えた結果の実行状況を見るダッシュボード
| Prometheus 公式OSS | http://localhost:9090 | 認証なし | その3000にデータを供給しているメトリクス収集基盤。

> ⚠ **Grafana でパスワードを変えないこと。** 変えると `validate.cmd` の `OBS-DASHBOARD` が
> 401 で落ち、環境変数を戻しても直りません（値が `grafana-data` ボリュームに残るため）。
> 復旧は Grafana のボリュームだけ作り直します。

---

## 1. 結論から見せる（3分）

`reports\summary.md` を開く。**総合 PASS** と、どのレポートが何を証明しているかの一覧。

次に `reports\validation-report.md` を開いて **42項目 PASS / FAIL 0** を見せる。これが正式判定。

**言うこと**: 「オーケストレーション層（実行順）はデータベースにあり、2つの Executor が同じ定義に
追従している。それを42項目で機械的に確認している」

**言ってはいけないこと**: 「移行が正しいことを証明した」。証明しているのは後述の範囲だけ。

---

## 2. 生成物が実際に動くことを見せる（5分）

`reports\corpus-report.md` を開く。19ケース、`AS_EXPECTED` 19件、未カバー率 6.07%。

**判定の強さがファミリで違う。ここを混ぜて説明しない。**

| ファミリ | 判定方法 | 言えること |
|---|---|---|
| `cobol-statements` / `cobol-programs` | 生成した Java を **javac でコンパイルし、実行して期待値と照合** | 生成物が**正しく動く** |
| `struts-springboot` | ゴールデン差分 ＋ 実コンパイル | 正解と**一致し、コンパイルは通る** |

Struts 側は Web コントローラに共通の実行入口が無いため、実行して値を突き合わせる手が使えません。
`samples-build` が起動して見せる画面（`/login`・`/search`）は**人手で書いた目標プロジェクト**であり、
**生成物ではありません**。ここを曖昧にすると説明全体の信用が落ちます。

### ゲートが生きている証拠（ここが一番効く）

同じレポートの**負例4件**を見せる。`expectedGate=FAIL` / `actualGate=FAIL` / `AS_EXPECTED`。

| 負例 | 落ちる理由 | それしか捕まえられないもの |
|---|---|---|
| `cobol-statements/11-uncovered-statements` | `PERFORM` / `EVALUATE` 未対応 → 未カバー率超過 | カバレッジ計上 |
| `cobol-statements/12-alphanumeric-if-gap` | **コンパイルは通るのに実行時に壊れる** | 振る舞いテスト |
| `cobol-programs/03-unsupported-statements` | `SORT` / `STRING` / `INSPECT` / `SEARCH` 未対応 | カバレッジ計上 |
| `struts-springboot/03-tiles-and-bean-write` | Tiles / `bean:write` / `ActionErrors` 未対応 | カバレッジ計上 |

**言うこと**: 「未対応を未対応として落とせることを、落ちるケースを常設して担保している」

---

## 3. ルール管理（履歴・差分・ロールバック・承認）（5分）

`http://localhost:8081/admin/`（`admin` / `admin123`）。

| 画面 | 見せるもの |
|---|---|
| 一覧 | chain / script の現在版 |
| 履歴 | 発行ごとの版。**LiteFlow 自身は履歴を持たないので `rm_*` テーブルで自前に保持** |
| 差分 | 版1と版3の差分行数 |
| ロールバック | 「戻す」のではなく**古い本文を前向きに再発行する**。v3→v2 は v4 になる |
| 承認 | 申請 → 承認 → 反映。**申請者本人は承認できない**（職務分離）ことを `admin` 自身で試して 403 を見せる |

利用者は `admin`/`admin123`（ADMIN+APPROVER）、`approver`/`approver123`、`viewer`/`viewer123`。
`viewer` で発行を試すと 403 になります。

スクリプトで一気に見せる場合は `scripts\rule-admin-demo.cmd`（8段・断言21件、証跡は
`reports\rule-admin-demo.json`）。

---

## 4. 【本題】自分のルールを導入する（10分・実演）

**主張は「新しい構文への対応で Java を書かない。JSON に1件足す」。** これをその場で示します。
`rules/` は両 Executor の `/work/rules`（読み取り専用）に載っていて、
`TRANSFORM_TEMPLATEDIR` が既にそこを指しています。**触るファイルは JSON 1本だけです。**

### 4-1. 変換用の chain を1本用意（初回のみ）

```powershell
$auth = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("admin:admin123")) }
Invoke-RestMethod -Method POST -Uri "http://localhost:8081/api/rules/chains" -Headers $auth `
  -ContentType "application/json" `
  -Body (@{ chainId = "demorules"; el = "THEN(validate,transform,compile,test,qualityGate,report)"; expectedVersion = 0 } | ConvertTo-Json -Compress)
```

既にある場合は `expectedVersion` の不一致で **409** になります。それが楽観ロックが効いている証拠なので、
409 が出たらそのまま次へ進んでください（chain は既に存在します）。

### 4-2. 「まだ対応していない」状態を見せる

```powershell
$body = [ordered]@{
    payload          = "demo"
    templateProfile  = "demo-v1"
    sourceLines      = [string[]]@("MOVE 'HELLO' TO WS-MSG", "DISPLAY WS-MSG", "ADD 1 TO WS-CNT")
    expectations     = @([ordered]@{ name = "greeting"; given = @{}; expect = [ordered]@{ "WS-MSG" = "HELLO" } })
    maxUncoveredRate = 0.0
}
$r = Invoke-RestMethod -Method POST -Uri "http://localhost:8081/api/flows/demorules/execute" `
     -ContentType "application/json; charset=utf-8" -Body ($body | ConvertTo-Json -Depth 12 -Compress)
"gate=$($r.qualityGate)"; $r.coverage | ConvertTo-Json -Compress; $r.generatedCode
```

**出るもの**（`ADD` のルールが無いので落ちる）:

```
gate=FAIL
{"byRule":{"move-literal":1,"display":1},"recognisedLines":2,"totalLines":3,
 "uncoveredRate":0.333,"unrecognisedLines":1,"unrecognisedSamples":["ADD 1 TO WS-CNT"]}
```

**言うこと**: 「未対応の行を黙って捨てず、数えて、閾値を超えたら品質ゲートで落としている」

### 4-3. ルールを1件足す（**動かすファイルはここだけ**）

`rules\demo-v1.json` の `rules` 配列の末尾に追加する。

```json
    {
      "id": "add-literal",
      "statement": "ADD",
      "appliesTo": "ADD <値> TO <変数>",
      "pattern": "^ADD\\s+(?<amount>[0-9.]+|[A-Za-z0-9_-]+)\\s+TO\\s+(?<to>[A-Za-z0-9_-]+)\\s*\\.?\\s*$",
      "template": "${_indent}vars.put(\"${to}\", num(${toExpr}) + num(${amountExpr}));",
      "notes": "演示で足したルール"
    }
```

直前のエントリの `}` の後ろに `,` を足すのを忘れないこと（JSON にコメントは書けません）。

**正規表現の名前付きグループが、そのままテンプレート変数になります。**

| 変数 | 内容 |
|---|---|
| `${g}` | マッチした文字列そのまま |
| `${g}Java` | Java 安全形式（`WS-A` → `WS_A`、`'ABC'` → `"ABC"`） |
| `${g}Expr` | **値を返す Java 式**（識別子 → `vars.get("WS-A")`、リテラル → そのまま） |
| `${g}Mapped` | プロファイルの `maps.g` で変換（`=` → `==` など） |
| `${g}List` / `${g}ExprList` | 空白区切りトークン → `"A", "B", "C"`（可変長オペランド用） |
| `${_indent}` / `${_depth}` | いまのブロック深さの字下げ／深さの数値 |

### 4-4. 反映（**再ビルドなし・再起動あり**）

```powershell
docker compose restart executor-a executor-b
```

読み込みは**起動時の1回だけ**なので、ファイルを置くだけでは反映されません。リロードAPIはありません。

反映確認:

```powershell
(Invoke-RestMethod "http://localhost:8081/api/templates").profiles |
  Where-Object { $_.profile -eq "demo-v1" }
```

`ruleCount` が 3 に増え、`source` が `/work/rules/demo-v1.json`（**classpath ではない**）であること。

### 4-5. 同じ入力をもう一度流す

4-2 のコマンドを再実行（`expect` に `"WS-CNT" = 1` を足すと振る舞いも確認できます）。

```
gate=PASS
{"byRule":{"move-literal":1,"display":1,"add-literal":1},"recognisedLines":3,"totalLines":3,
 "uncoveredRate":0.0,"unrecognisedLines":0,"unrecognisedSamples":[]}
vars.put("WS-CNT", num(vars.get("WS-CNT")) + num(1));
```

**言うこと**: 「jar は作り直していません。Java は1行も書いていません。JSON に1件足して再起動しただけです。
生成コードはコンパイルされ、実行され、期待値と一致しました」

### 4-6. 書き間違いは黙って通らないことも見せる（任意・1分）

`pattern` の `appliesToFile` を `appliesToFiles` のように綴り間違えて再起動し、

```powershell
curl.exe -s http://localhost:8081/api/templates/demo-v1/diagnostics
```

`unknown-field` として名指しされることを見せます。`bad-regex` / `unresolved-variable` /
`shadowed-rule`（前のルールに食われて一度も発火しない）/ `unclosed-frame` も同じ経路で出ます。

---

## 5. 実プロジェクトに入れるときの手順（説明のみ・3分）

演示用の `rules/demo-v1.json` は**使い捨て**です。実際の資産では:

| やること | 触るファイル | 確認コマンド |
|---|---|---|
| ルールを足す | `rules\<自分の>.json`（本番運用は `app\src\main\resources\templates\` に入れて再ビルド） | `mvn -f app/pom.xml test -Dtest='RuleEngine*Test,ProfileDiagnosticsTest,RuleUsageTest'`（**1秒未満**） |
| 正しさの根拠を足す | `corpus\families\<ファミリ>\cases\<ID>\` に `meta.json` / `input/` / `output/` の3点 | `scripts\corpus-run.cmd` |
| 全体確認 | — | `scripts\local-verify.cmd`（81テスト・約40秒）→ `scripts\validate.cmd`（42項目） |

`corpus` のケースは3点セットです。

```text
corpus/families/cobol-statements/cases/13-自分のケース/
  meta.json               {"title":"…","maxUncoveredRate":0.0,"expectQualityGate":"PASS"}
  input/source.cbl        変換元
  output/behaviour.json   [{"name":"…","given":{"WS-A":1},"expect":{"WS-B":1}}]  ← 期待する正解
```

**`output/` に実結果を書かないこと。** あそこは「期待する正解」の置き場で、実結果は `reports/` にしか出しません。

---

## 注意事項（演示前に必ず読む）

**触ってはいけないもの**

- **`compilable-v1` は凍結**。あのプロファイルの未対応範囲そのものが品質ゲートの試験体です。
  新しい構文は別プロファイルへ足す。`rules/` に `compilable-v1.json` を置くと**外部ファイルが同梱を上書きし**、
  負例 `11` / `12` が壊れます
- **負例4件を PASS にしない**。ゲートが生きている証拠です
- **Grafana のパスワードを変えない**（前述）
- **`corpus/**/output/` に実結果を書かない**

**言葉づかい**

- COBOL 側（実行して照合）と Struts 側（テキスト差分＋コンパイル）を**同じ言葉で言わない**
- 「意味同値性は検証していない」「Struts 側はテキスト差分にとどまる」は毎回明示する
- 19ケースは**手書きの合成 fixture であり実資産ではない**。機構が動くことしか示しません
- 画面出力だけで「動きました」と言わない。**判定はファイルに残ったものだけ**

**事故ったときの復旧**

| 症状 | 対処 |
|---|---|
| 外部ルールが反映されない | 再起動を忘れている。`docker compose restart executor-a executor-b` |
| `409` が返る | `expectedVersion` の不一致。楽観ロックが効いている（想定通り） |
| 生成コードが `${xxx}` のまま | 変数名の綴り間違い。`/api/templates/<名前>/diagnostics` の `unresolved-variable` |
| ルールが一度も発火しない | 前の同型ルールに食われている。`shadowed-rule`。**より限定的なルールを配列の前に置く** |
| Executor が起動しない | `docker compose logs executor-a --tail 50`。壊れたルール表では**例外を投げず警告だけ**なので、まず診断APIを見る |
| 全部おかしくなった | `powershell -File scripts\stop.ps1`（`down -v` で完全初期化）→ `scripts\install.cmd` → `scripts\validate.cmd`。**Rule-DB の履歴も消えます** |

---

## 演示後

```powershell
scripts\summary.cmd     # reports\summary.md を最新化して締める
```

`rules\demo-v1.json` を演示で書き換えた場合は `git checkout -- rules/` で戻せます。
`demorules` chain は Rule-DB に残ります（`stop.ps1` の `down -v` で消えます）。
