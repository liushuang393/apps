package jp.co.softroad.liteflow.transform;

import java.util.ArrayList;
import java.util.List;

/**
 * 生成された成果物1件と、事前に用意した正解（ゴールデン）との突き合わせ結果。
 *
 * <p><b>この比較が証明するのは「生成物が我々が書いた正解と一致すること」だけである。</b>
 * 業務的な正しさも意味等価性も証明しない。Webアプリのように生成物を実行して
 * 値を突き合わせられない領域で、それでも回帰だけは検出できるようにするための手段である。
 * COBOL側の {@link BehaviourExpectation} の方が証拠として強い。
 */
public class GoldenComparison {
    private String artifact;
    private boolean matched;
    /** 期待側にしか無い／生成側にしか無い、あるいは中身が違う行の説明。先頭20件まで。 */
    private final List<String> differences = new ArrayList<>();
    private int expectedLines;
    private int actualLines;
    /** 生成物が1行も出なかった場合に true。ルールがそのファイルを1つも認識していない兆候。 */
    private boolean missing;

    public GoldenComparison() {
    }

    public GoldenComparison(String artifact) {
        this.artifact = artifact;
    }

    public String getArtifact() {
        return artifact;
    }

    public void setArtifact(String artifact) {
        this.artifact = artifact;
    }

    public boolean isMatched() {
        return matched;
    }

    public void setMatched(boolean matched) {
        this.matched = matched;
    }

    public List<String> getDifferences() {
        return differences;
    }

    public int getExpectedLines() {
        return expectedLines;
    }

    public void setExpectedLines(int expectedLines) {
        this.expectedLines = expectedLines;
    }

    public int getActualLines() {
        return actualLines;
    }

    public void setActualLines(int actualLines) {
        this.actualLines = actualLines;
    }

    public boolean isMissing() {
        return missing;
    }

    public void setMissing(boolean missing) {
        this.missing = missing;
    }
}
