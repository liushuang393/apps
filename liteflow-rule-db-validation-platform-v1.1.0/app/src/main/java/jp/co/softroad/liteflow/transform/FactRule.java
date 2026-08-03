package jp.co.softroad.liteflow.transform;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * ファイルをまたいで使う変数を集める規則。{@code AnalyzeNode} が全入力ファイルを
 * 事前に1周して評価する。
 *
 * <p>これが要るのは、1つの成果物が複数の入力ファイルから組み立てられるからである。
 * 例えば {@code LoginController.java} は、クラス名を {@code LoginAction.java} から、
 * URLパスを {@code struts-config.xml} から、項目名を {@code LoginForm.java} から取る。
 * 名前付きグループは1行1ファイルの中でしか見えないので、
 * 「ファイルAで分かったことをファイルBの描画で使う」場所がどこにも無かった。
 *
 * <p>集めた値は、以降すべてのルール・成果物名・preamble / epilogue の描画で
 * 通常のテンプレート変数として参照できる。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class FactRule {
    private String id;
    /** 入力ファイル名の正規表現。省略時は全ファイル。大小は区別する。 */
    private String appliesToFile;
    private String pattern;
    /** 変数名 → テンプレート。名前付きグループとその派生形が使える。 */
    private Map<String, String> set = new LinkedHashMap<>();
    private String notes;

    @JsonIgnore
    private volatile Pattern compiled;
    @JsonIgnore
    private volatile Pattern compiledFileFilter;

    @JsonIgnore
    public Pattern compiledPattern() {
        Pattern current = compiled;
        if (current == null) {
            current = Pattern.compile(pattern);
            compiled = current;
        }
        return current;
    }

    @JsonIgnore
    public boolean appliesToFileName(String fileName) {
        if (appliesToFile == null || appliesToFile.isBlank() || fileName == null) {
            return true;
        }
        Pattern current = compiledFileFilter;
        if (current == null) {
            current = Pattern.compile(appliesToFile);
            compiledFileFilter = current;
        }
        return current.matcher(fileName).matches();
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getAppliesToFile() {
        return appliesToFile;
    }

    public void setAppliesToFile(String appliesToFile) {
        this.appliesToFile = appliesToFile;
        this.compiledFileFilter = null;
    }

    public String getPattern() {
        return pattern;
    }

    public void setPattern(String pattern) {
        this.pattern = pattern;
        this.compiled = null;
    }

    public Map<String, String> getSet() {
        return set;
    }

    public void setSet(Map<String, String> set) {
        this.set = set == null ? new LinkedHashMap<>() : set;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }
}
