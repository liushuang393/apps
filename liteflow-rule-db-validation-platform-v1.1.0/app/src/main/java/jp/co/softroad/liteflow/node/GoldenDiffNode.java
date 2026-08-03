package jp.co.softroad.liteflow.node;

import com.yomahub.liteflow.annotation.LiteflowComponent;
import jp.co.softroad.liteflow.model.MigrationContext;
import jp.co.softroad.liteflow.transform.GoldenComparison;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 生成した成果物を、事前に用意した正解（ゴールデン）と突き合わせる。
 *
 * <p>Webアプリの変換では {@code TestNode} が使えない。{@code TestNode} は
 * {@code generated.GeneratedProgram.run(Map, List)} を反射で呼ぶ前提だが、
 * 生成された Spring Boot のコントローラにそんな入口は無い。実行して値を比べられない領域で、
 * それでも回帰だけは検出できるようにするのがこのノードである。
 *
 * <p><b>この比較で言えるのは「生成物が我々の書いた正解と一致する」ことだけである。</b>
 * 業務的な正しさは何も言えない。COBOL側の振る舞いテストの方が証拠として強い。
 *
 * <p>期待ファイルが渡されていなければ何もしない。既存のチェーンに入れても無害である。
 */
@LiteflowComponent("goldenDiff")
public class GoldenDiffNode extends AbstractTraceNode {
    /** 報告する差分の上限。全部出すとレポートが読めなくなる。 */
    private static final int MAX_DIFFERENCES = 20;

    @Override
    public void process() {
        mark("goldenDiff");

        MigrationContext context = getContextBean(MigrationContext.class);
        Map<String, String> golden = context.getGoldenArtifacts();
        if (golden.isEmpty()) {
            return;
        }
        Map<String, List<String>> generated = context.getGeneratedArtifacts();

        golden.forEach((artifact, expectedText) -> {
            GoldenComparison comparison = new GoldenComparison(artifact);
            List<String> expected = normalise(List.of(expectedText.split("\\R", -1)));
            List<String> actual = normalise(generated.getOrDefault(artifact, List.of()));
            comparison.setExpectedLines(expected.size());
            comparison.setActualLines(actual.size());

            if (actual.isEmpty()) {
                comparison.setMissing(true);
                comparison.setMatched(false);
                comparison.getDifferences().add(
                        "expected " + expected.size() + " line(s) but nothing was generated for this artifact");
                context.addGoldenResult(comparison);
                return;
            }

            int max = Math.max(expected.size(), actual.size());
            for (int i = 0; i < max && comparison.getDifferences().size() < MAX_DIFFERENCES; i++) {
                String left = i < expected.size() ? expected.get(i) : null;
                String right = i < actual.size() ? actual.get(i) : null;
                if (left == null) {
                    comparison.getDifferences().add("line " + (i + 1) + ": unexpected  + " + right);
                } else if (right == null) {
                    comparison.getDifferences().add("line " + (i + 1) + ": missing     - " + left);
                } else if (!left.equals(right)) {
                    comparison.getDifferences().add(
                            "line " + (i + 1) + ": expected \"" + left + "\" but was \"" + right + "\"");
                }
            }
            comparison.setMatched(comparison.getDifferences().isEmpty());
            context.addGoldenResult(comparison);
        });
    }

    /**
     * 比較前の正規化。行末の空白と空行だけを落とす。
     *
     * <p>インデントは落とさない。生成コードの字下げが崩れているのは実際に直すべき問題であり、
     * 比較を甘くして見逃すと「読めるコードを生成できている」という主張が根拠を失う。
     */
    private List<String> normalise(List<String> lines) {
        List<String> result = new ArrayList<>();
        for (String line : lines) {
            String stripped = line.stripTrailing();
            if (!stripped.isBlank()) {
                result.add(stripped);
            }
        }
        return result;
    }
}
