package jp.co.softroad.liteflow.transform;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.ArrayList;
import java.util.List;

/**
 * 生成する成果物1件の骨組み。
 *
 * <p>行ルールだけでは表現できないもの — package宣言・import群・クラス宣言・閉じ括弧 — を
 * ここに置く。どの入力行も「package文である」わけではないので、preamble を
 * 無関係なルールに紛れ込ませると、そのルールが複数ファイルでマッチしたときに二重出力になる。
 *
 * <p>{@code name} / {@code className} / {@code preamble} / {@code epilogue} は
 * {@code facts} で集めた変数で描画される（例: {@code ${base}Controller.java}）。
 *
 * <p>{@code sections} は成果物内の連結順である。ルールが {@code section} を指定して
 * 出力すると、入力ファイルの処理順に関係なくこの順で並ぶ。指定が無い出力は最後の区画へ入る。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class ArtifactSpec {
    /** 成果物のファイル名テンプレート。 */
    private String name;
    /** {@code java} なら実コンパイルの対象にする。 */
    private String kind = "text";
    /** Javaのときのクラス完全名テンプレート。 */
    private String className;
    private List<String> sections = new ArrayList<>();
    private List<String> preamble = new ArrayList<>();
    private List<String> epilogue = new ArrayList<>();
    private String notes;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getKind() {
        return kind;
    }

    public void setKind(String kind) {
        this.kind = kind == null ? "text" : kind;
    }

    public String getClassName() {
        return className;
    }

    public void setClassName(String className) {
        this.className = className;
    }

    public List<String> getSections() {
        return sections;
    }

    public void setSections(List<String> sections) {
        this.sections = sections == null ? new ArrayList<>() : sections;
    }

    public List<String> getPreamble() {
        return preamble;
    }

    public void setPreamble(List<String> preamble) {
        this.preamble = preamble == null ? new ArrayList<>() : preamble;
    }

    public List<String> getEpilogue() {
        return epilogue;
    }

    public void setEpilogue(List<String> epilogue) {
        this.epilogue = epilogue == null ? new ArrayList<>() : epilogue;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }
}
