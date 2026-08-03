package jp.co.softroad.liteflow.transform;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.regex.Pattern;

/**
 * COBOLソースの構造を認識する規則。{@code AnalyzeNode} が使う。
 *
 * <p>「どの行がプログラム名か」「どこからが PROCEDURE DIVISION か」「どの行が段落見出しか」を
 * <b>Javaにハードコードせずルール表で決める</b>ためのもの。これが無いと、COBOLの方言差に
 * 対応するたびにJavaを触ることになり、本PoCの主張が崩れる。
 *
 * <p>{@code kind} が動作を決める。
 * <table border="1">
 *   <caption>構造規則の種類</caption>
 *   <tr><th>kind</th><th>意味</th><th>使う名前付きグループ</th></tr>
 *   <tr><td>{@code program}</td><td>プログラムの始まり（PROGRAM-ID）</td><td>{@code name}</td></tr>
 *   <tr><td>{@code section}</td><td>DIVISION / SECTION の切り替え</td><td>{@code name}（{@code to} で指定も可）</td></tr>
 *   <tr><td>{@code dataItem}</td><td>WORKING-STORAGE のデータ項目</td><td>{@code name}、任意で {@code value}</td></tr>
 *   <tr><td>{@code linkageItem}</td><td>LINKAGE SECTION のデータ項目</td><td>{@code name}</td></tr>
 *   <tr><td>{@code using}</td><td>PROCEDURE DIVISION USING の引数並び</td><td>{@code args}</td></tr>
 *   <tr><td>{@code paragraph}</td><td>段落見出し</td><td>{@code name}</td></tr>
 *   <tr><td>{@code statement}</td><td>段落見出しと紛らわしいが実は文である行。段落本文へ残す</td><td>—</td></tr>
 *   <tr><td>{@code ignore}</td><td>認識するが構造にも生成にも寄与しない行</td><td>—</td></tr>
 * </table>
 *
 * <p>{@code inSection} を書くと、その区画にいるときだけ規則が効く。段落見出しの正規表現は
 * どうしても緩くなる（{@code ^名前\.$}）ので、{@code inSection: "procedure"} で
 * PROCEDURE DIVISION に限定しないと {@code GOBACK.} まで段落名として拾ってしまう。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class StructureRule {
    private String id;
    private String kind;
    private String pattern;
    /** この区画にいるときだけ適用する。省略時はどこでも適用。 */
    private String inSection;
    /** {@code kind=section} のとき、切り替え先の区画名を明示する。省略時はグループ {@code name}。 */
    private String to;
    /** {@code kind=dataItem} のとき、VALUE 句が無い場合の既定Javaリテラル。 */
    private String defaultValue;
    private String notes;

    @JsonIgnore
    private volatile Pattern compiled;

    @JsonIgnore
    public Pattern compiledPattern() {
        Pattern current = compiled;
        if (current == null) {
            current = Pattern.compile(pattern, Pattern.CASE_INSENSITIVE);
            compiled = current;
        }
        return current;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getKind() {
        return kind;
    }

    public void setKind(String kind) {
        this.kind = kind;
    }

    public String getPattern() {
        return pattern;
    }

    public void setPattern(String pattern) {
        this.pattern = pattern;
        this.compiled = null;
    }

    public String getInSection() {
        return inSection;
    }

    public void setInSection(String inSection) {
        this.inSection = inSection;
    }

    public String getTo() {
        return to;
    }

    public void setTo(String to) {
        this.to = to;
    }

    public String getDefaultValue() {
        return defaultValue;
    }

    public void setDefaultValue(String defaultValue) {
        this.defaultValue = defaultValue;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }
}
