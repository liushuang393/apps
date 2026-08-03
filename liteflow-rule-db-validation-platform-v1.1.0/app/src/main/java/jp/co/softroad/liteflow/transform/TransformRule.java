package jp.co.softroad.liteflow.transform;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.regex.Pattern;

/**
 * 文の認識ルール1件。COBOL文形式にマッチする正規表現と、それを描画するテンプレートの組。
 * どちらも設定側にあるため、新しい文形式への対応はコード変更ではなく設定変更で済む。
 *
 * <p>正規表現の名前付きグループがテンプレート変数になる。派生形
 * （{@code ${gJava}}、{@code ${gExpr}}、{@code ${gMapped}}、{@code ${gList}}）は
 * {@link TemplateRenderer} を参照。
 *
 * <p>以下の任意フィールドは、宣言しなければ一切効かない。既存プロファイルの挙動は変わらない。
 *
 * <table border="1">
 *   <caption>ブロック構造と成果物振り分けのための任意フィールド</caption>
 *   <tr><th>フィールド</th><th>効果</th></tr>
 *   <tr><td>{@code opens}</td><td>描画後にこの種別のブロック枠を積む。{@code ${_depth}} が使える</td></tr>
 *   <tr><td>{@code closes}</td><td>この種別が枠の一番上にあるときだけマッチし、描画後に枠を降ろす</td></tr>
 *   <tr><td>{@code requires}</td><td>この種別が枠の一番上にあるときだけマッチする。
 *       「最初にマッチしたものが勝つ」を文脈依存にする仕掛け</td></tr>
 *   <tr><td>{@code binds}</td><td>{@code opens} と併用。枠に変数を束縛し、その枠の中の
 *       ルールから参照できるようにする（EVALUATE の被検査値など）</td></tr>
 *   <tr><td>{@code continueWith}</td><td>描画後、指定した名前付きグループの中身を
 *       改めて1行としてルール表へ通す。{@code WHEN 1 MOVE A TO B} のような同一行の複合を扱う</td></tr>
 *   <tr><td>{@code appliesToFile}</td><td>入力ファイル名の正規表現。省略時は全ファイルに適用</td></tr>
 *   <tr><td>{@code emitTo}</td><td>出力先の成果物名。テンプレート展開される。省略時は既定の出力</td></tr>
 *   <tr><td>{@code section}</td><td>成果物内の区画名。{@code artifacts[].sections} の順に連結される</td></tr>
 * </table>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class TransformRule {
    private String id;
    private String statement;
    private String appliesTo;
    private String pattern;
    private String template;
    private String notes;
    private String opens;
    private String closes;
    private String requires;
    private java.util.Map<String, String> binds;
    private String continueWith;
    private String appliesToFile;
    private String emitTo;
    private String section;

    @JsonIgnore
    private volatile Pattern compiled;
    @JsonIgnore
    private volatile Pattern compiledFileFilter;

    @JsonIgnore
    public Pattern compiledPattern() {
        Pattern current = compiled;
        if (current == null) {
            current = Pattern.compile(pattern, Pattern.CASE_INSENSITIVE);
            compiled = current;
        }
        return current;
    }

    /**
     * 入力ファイル名フィルタ。未指定なら null を返し、呼び出し側は「全ファイルに適用」と解釈する。
     *
     * <p>空文字を {@code Pattern.compile("")} にしてはいけない。空文字にしかマッチせず、
     * 既存の全ルールが黙って無効になる。また文字名の大小は区別する
     * （{@code .jsp} と {@code .JSP} を取り違えるとファイルシステムと挙動がずれる）。
     */
    @JsonIgnore
    public Pattern compiledFileFilter() {
        if (appliesToFile == null || appliesToFile.isBlank()) {
            return null;
        }
        Pattern current = compiledFileFilter;
        if (current == null) {
            current = Pattern.compile(appliesToFile);
            compiledFileFilter = current;
        }
        return current;
    }

    /** このルールが対象ファイルに適用されるか。ファイル名 null（単一ファイル方式）は常に true。 */
    @JsonIgnore
    public boolean appliesToFileName(String fileName) {
        Pattern filter = compiledFileFilter();
        if (filter == null || fileName == null) {
            return true;
        }
        return filter.matcher(fileName).matches();
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getStatement() {
        return statement;
    }

    public void setStatement(String statement) {
        this.statement = statement;
    }

    public String getAppliesTo() {
        return appliesTo;
    }

    public void setAppliesTo(String appliesTo) {
        this.appliesTo = appliesTo;
    }

    public String getPattern() {
        return pattern;
    }

    public void setPattern(String pattern) {
        this.pattern = pattern;
        this.compiled = null;
    }

    public String getTemplate() {
        return template;
    }

    public void setTemplate(String template) {
        this.template = template;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }

    public String getOpens() {
        return opens;
    }

    public void setOpens(String opens) {
        this.opens = opens;
    }

    public String getCloses() {
        return closes;
    }

    public void setCloses(String closes) {
        this.closes = closes;
    }

    public String getRequires() {
        return requires;
    }

    public void setRequires(String requires) {
        this.requires = requires;
    }

    public java.util.Map<String, String> getBinds() {
        return binds;
    }

    public void setBinds(java.util.Map<String, String> binds) {
        this.binds = binds;
    }

    public String getContinueWith() {
        return continueWith;
    }

    public void setContinueWith(String continueWith) {
        this.continueWith = continueWith;
    }

    public String getAppliesToFile() {
        return appliesToFile;
    }

    public void setAppliesToFile(String appliesToFile) {
        this.appliesToFile = appliesToFile;
        this.compiledFileFilter = null;
    }

    public String getEmitTo() {
        return emitTo;
    }

    public void setEmitTo(String emitTo) {
        this.emitTo = emitTo;
    }

    public String getSection() {
        return section;
    }

    public void setSection(String section) {
        this.section = section;
    }
}
