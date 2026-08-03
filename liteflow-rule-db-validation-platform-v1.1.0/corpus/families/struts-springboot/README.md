# family: struts-springboot（Struts 1.3.10 → Spring Boot 4.1）

旧Web資産の刷新。**Action / ActionForm / struts-config.xml / JSP** という4種類の入力から、
**@Controller / フォームBean / Thymeleaf テンプレート** という3種類の成果物を組み立てる。

## ⚠ 判定方法が COBOL 側と違う（弱い）

| ファミリ | 判定 | 何が言えるか |
|---|---|---|
| `cobol-*` | 生成物を**実行して**期待値と突き合わせる | 生成物が**正しく動く** |
| `struts-springboot` | ①事前に用意した正解との**テキスト差分** ②生成Javaの**実コンパイル** | 生成物が**我々の書いた正解と一致し、コンパイルは通る** |

Webコントローラには「これを呼べば結果が出る」という共通の入口が無いので、実行して値を
突き合わせる手が使えない。**業務的な正しさも意味等価性も、このファミリでは何も示していない。**

`scripts\samples-build.cmd` が起動して見せる画面は**人手で書いた目標プロジェクト**のものであり、
生成物を起動しているのではない。この区別を曖昧にしないこと。

## ディレクトリ

```text
corpus/families/struts-springboot/
  family.json
  README.md                     ← このファイル
  apps/
    legacy-struts1/             変換元プロジェクトの骨組み（pom.xml / web.xml）
    target-springboot41/        変換先プロジェクトの骨組み（pom.xml / 起動クラス / 設定）
                                lib/ には Boot 4.1 の依存jar（生成コードのjavac用）
  cases/<ケースID>/
    meta.json
    input/                      ★変換元。Action.java / Form.java / struts-config.xml / *.jsp
    output/                     ★期待する正解。Controller.java / Form.java / *.html
```

**ケースの `input/` と `output/` が唯一の真実。** `apps/` には骨組みしか置いていない。
`scripts\samples-build.cmd` がケースのファイルを両プロジェクトへ配置してビルドするので、
副本が二重管理になることがない。

## ルール表の3つの表

行単位のルールだけでは、**1つの成果物を3つの入力ファイルから組み立てる**ことができない。
そこで `struts-to-boot-v1` には3種類の表がある。

| 表 | 役割 | 例 |
|---|---|---|
| `facts` | 全入力ファイルを事前走査してファイル横断の変数を作る | `LoginAction.java` → `base=Login` / `struts-config.xml` → `path=/login`, `successView=menu` / `login.jsp` → `title=ログイン` |
| `artifacts` | 成果物ごとの骨組み（名前・区画順・前導・後尾） | `${base}Controller.java` の package 宣言・import 群・クラス宣言・閉じ括弧 |
| `rules` | 行を変換して `emitTo` と `section` で振り分ける | `<html:text property="userId"/>` → `<input type="text" th:field="*{userId}"/>` |

さらに `opens` / `closes` / `requires` を使ったブロック枠で、
**同じ `}` がメソッドの閉じ括弧なのかクラスの閉じ括弧なのかを見分けている**
（クラスの `}` は成果物の後尾が出すので捨てる）。字下げは `${_indent}` が枠の深さから決める。

Thymeleaf も `${...}` を使うため、テンプレート側では **`$\{` と書くとリテラルの `${`** になる
エスケープを用意してある（`th:object="$\{form}"` → `th:object="${form}"`）。

## 変換の実例（`01-login`）

入力4ファイル → 出力3ファイル。

```java
// 入力: LoginAction.java（一部）              →  出力: LoginController.java（一部）
public ActionForward execute(...) {              @PostMapping
LoginForm loginForm = (LoginForm) form;          public String submit(@ModelAttribute("form") LoginForm form, Model model) {
if (loginForm.getUserId() == null) {                 if (form.getUserId() == null) {
    return mapping.findForward("failure");               return "login";
}                                                    }
request.setAttribute("userId", ...);                 model.addAttribute("userId", form.getUserId());
return mapping.findForward("success");               return "menu";
```

`@RequestMapping("/login")` の `/login` は `struts-config.xml` から、
`return "menu"` の `menu` は `<forward name="success" path="/menu.jsp"/>` から来ている。
どちらも `LoginAction.java` には書かれていない。

## ケース一覧

| ケース | 何を見ているか | 期待 |
|---|---|---|
| `01-login` | ログイン画面。3ファイルから1コントローラを組み立てる | PASS |
| `02-search-list` | 検索一覧画面。繰り返し（`logic:iterate`→`th:each`）とリンク。**ルールを1件も足さずに2画面目が通るか** | PASS |
| `03-tiles-and-bean-write` | **負例。** Tiles / `bean:write` / `ActionErrors` / セッション操作は未対応 → 未カバー率で落ちる | **FAIL** |

## 既知の穴

- **Tiles**（レイアウト合成）は未対応。Thymeleaf の `th:fragment` と1対1で対応しない
- **`bean:write` / `bean:message`** は未対応。i18n リソースバンドルを持っていない
- **`validate()` / `ActionErrors` / `html:errors`** は未対応。Spring の `BindingResult` へ写すには検証定義そのものの移行が要る
- **DynaActionForm**、カスタムタグ、`HttpSession` の直接操作、`ActionServlet` の拡張は未対応
- 生成された Thymeleaf の `th:each` は Model の属性名をそのまま使う。型情報を持っていない

## 実行

```powershell
scripts\corpus-run.cmd -Family struts-springboot        # 変換とゴールデン差分
scripts\samples-build.cmd                               # 両プロジェクトの実ビルドと画面確認
powershell -File scripts\samples-build.ps1 -SkipRun     # 起動確認を省く
```

**前提**: 生成Javaの実コンパイルには Spring Boot 4.1 の依存jarが要る。
先に `scripts\samples-build.cmd` を一度回して `apps/target-springboot41/lib/` を作ること
（Docker版のイメージには `/app/boot41-libs` として最初から入っている）。

**合格基準**
- `corpus-run`: 3/3 as expected、ゴールデン一致 6/6、正例コンパイル 2/2、負例1件が FAIL のまま
- `samples-build`: 両プロジェクトのビルド成功、`/login` と `/search` が HTTP 200
