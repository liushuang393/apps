package jp.co.softroad.liteflow.transform;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 1本のCOBOLプログラムの構造。{@code AnalyzeNode} がルール表の {@code structure} 規則で組み立て、
 * {@code TransformNode} が段落ごとに文を詰め、{@link GeneratedProgramCompiler} がJavaへ落とす。
 *
 * <p>文単位のファミリ（{@code cobol-statements}）はこのモデルを一切使わない。段落見出しが
 * 1つも見つからないときは従来どおりの平坦な生成経路を通す。
 */
public final class CobolProgram {
    private final String programId;
    /** WORKING-STORAGE の項目名 → VALUE 句に対応するJavaリテラル式。順序を保つ。 */
    private final Map<String, String> workingStorage = new LinkedHashMap<>();
    /** LINKAGE SECTION の項目名。PROCEDURE DIVISION USING の順に並ぶ。 */
    private final List<String> linkage = new ArrayList<>();
    /** 段落ラベル → 元のCOBOL行。AnalyzeNode が詰める。 */
    private final Map<String, List<String>> sourceParagraphs = new LinkedHashMap<>();
    /** 段落ラベル → 生成済みJava文。TransformNode が詰める。ソース順を保つ。 */
    private final Map<String, List<String>> paragraphs = new LinkedHashMap<>();
    /** このプログラムが書かれていた入力ファイル名。カバレッジのファイル別集計に使う。 */
    private String sourceFile;

    public CobolProgram(String programId) {
        this.programId = programId;
    }

    public String getProgramId() {
        return programId;
    }

    /** Javaクラスの単純名。COBOLの命名（ハイフン等）をJava識別子へ落とす。 */
    public String getSimpleName() {
        return toJavaIdentifier(programId);
    }

    public String getClassName() {
        return GeneratedProgramCompiler.PACKAGE + "." + getSimpleName();
    }

    public Map<String, String> getWorkingStorage() {
        return workingStorage;
    }

    public List<String> getLinkage() {
        return linkage;
    }

    public Map<String, List<String>> getSourceParagraphs() {
        return sourceParagraphs;
    }

    /** 元のCOBOL行を段落へ追加する。同名段落は最初の位置を保つ。 */
    public List<String> declareSourceParagraph(String label) {
        return sourceParagraphs.computeIfAbsent(label, key -> new ArrayList<>());
    }

    public Map<String, List<String>> getParagraphs() {
        return paragraphs;
    }

    public String getSourceFile() {
        return sourceFile;
    }

    public void setSourceFile(String sourceFile) {
        this.sourceFile = sourceFile;
    }

    /** 段落を宣言する。同名を二度宣言しても最初の位置を保つ。 */
    public List<String> declareParagraph(String label) {
        return paragraphs.computeIfAbsent(label, key -> new ArrayList<>());
    }

    public boolean hasParagraphs() {
        return !paragraphs.isEmpty();
    }

    public static String toJavaIdentifier(String raw) {
        if (raw == null || raw.isBlank()) {
            return "_UNNAMED";
        }
        String identifier = raw.trim().replaceAll("[^A-Za-z0-9_]", "_");
        return Character.isDigit(identifier.charAt(0)) ? "_" + identifier : identifier;
    }
}
