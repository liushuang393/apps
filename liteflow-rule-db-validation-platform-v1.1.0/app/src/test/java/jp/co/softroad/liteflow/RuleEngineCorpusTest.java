package jp.co.softroad.liteflow;

import jp.co.softroad.liteflow.corpus.CorpusCases;
import jp.co.softroad.liteflow.corpus.TransformSnapshot;
import jp.co.softroad.liteflow.transform.RuleEngine;
import jp.co.softroad.liteflow.transform.SourceAnalyzer;
import jp.co.softroad.liteflow.transform.TemplateLibrary;
import jp.co.softroad.liteflow.transform.TemplateProfile;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * コーパス19ケース全部を<b>Spring も LiteFlow も起動せずに</b>変換し、
 * {@code CorpusSnapshotTest} と<b>同じスナップショットファイル</b>と突き合わせる。
 *
 * <p>この2つが同じ答えを出すことが、{@code TransformNode} が本当に薄い adapter に
 * なっていることの証明である。片方だけ緑になったら、ノードの側に変換の意味が
 * 残っている（＝また Spring 起動なしでは確かめられない状態に戻っている）。
 *
 * <p>こちらは起動が無いので<b>ケース19件でおよそ0.1秒</b>。ルール表を触ったときの
 * 実際の作業ループはこれになる。
 */
class RuleEngineCorpusTest {
    private static final TemplateLibrary LIBRARY = new TemplateLibrary("");

    /**
     * コーパスが読めないときは前提が満たされていないものとして飛ばす。
     *
     * <p>Dockerイメージのビルドコンテキストには {@code app/} しか入らないため、
     * コンテナ内の {@code mvn clean verify} からはコーパスが見えない。
     * <b>同じ検査はホストの local-verify と手順F/J/K の corpus-run が行う。</b>
     */
    @org.junit.jupiter.api.BeforeEach
    void requireCorpus() {
        org.junit.jupiter.api.Assumptions.assumeTrue(CorpusCases.isAvailable(),
                "コーパスがビルドコンテキストに無い（Dockerイメージ内のビルド）。"
                        + "ホストの local-verify と corpus-run が同じ検査を行う");
    }


    @Test
    void everyCorpusCaseProducesTheRecordedTransformOutput() {
        List<CorpusCases.Case> cases = CorpusCases.all();
        Assertions.assertFalse(cases.isEmpty(), "コーパスのケースが見つからない");

        List<String> problems = new ArrayList<>();
        for (CorpusCases.Case target : cases) {
            RuleEngine.Result result = run(target);
            String actual = TransformSnapshot.render(target, result.generatedLines(),
                    result.artifacts(), result.coverage(),
                    result.coverageByFile(), result.findings());
            String problem = TransformSnapshot.compare(target, actual);
            if (problem != null) {
                problems.add(problem);
            }
        }
        Assertions.assertTrue(problems.isEmpty(),
                () -> problems.size() + " 件のケースで変換結果が変わっている:\n"
                        + String.join("\n\n", problems));
    }

    /**
     * 各ファミリに「未カバー率で落ちる負例」が1件以上あること。
     *
     * <p>負例には2種類ある。ここで守るのはカバレッジゲートの試験体であり、
     * ルールを足してこれが PASS に変わったらゲートの退行である。
     */
    @Test
    void everyFamilyHasANegativeCaseThatCoverageAloneCatches() {
        Map<String, Boolean> caught = new java.util.TreeMap<>();
        for (CorpusCases.Case target : CorpusCases.all()) {
            caught.putIfAbsent(target.family(), false);
            if (target.isNegative() && run(target).coverage().getUnrecognisedLines() > 0) {
                caught.put(target.family(), true);
            }
        }
        caught.forEach((family, found) -> Assertions.assertTrue(found,
                () -> family + " に「未カバー率で落ちる負例」が無い。"
                        + "ルールを足してゲートの試験体を潰していないか確認すること"));
    }

    /**
     * もう1種類の負例 — <b>カバレッジには見えない</b>もの。
     *
     * <p>{@code 12-alphanumeric-if-gap} は全行が認識され、生成コードもコンパイルできる。
     * それでも実行すると壊れる（英数字を {@code num()} に通すため）。
     * ここで未カバー率が 0 であることを固定しておくのは、
     * <b>振る舞いテストという別のゲートが要る理由そのもの</b>を記録するためである。
     * ここが 0 でなくなったら、この負例は種類が変わってしまっている。
     */
    @Test
    void theAlphanumericGapIsInvisibleToCoverage() {
        CorpusCases.Case target = CorpusCases.family("cobol-statements").stream()
                .filter(entry -> entry.id().equals("12-alphanumeric-if-gap"))
                .findFirst().orElseThrow();
        Assertions.assertEquals(0, run(target).coverage().getUnrecognisedLines(),
                "この負例はカバレッジでは捕まらないことが要点である");
    }

    static RuleEngine.Result run(CorpusCases.Case target) {
        TemplateProfile profile = LIBRARY.require(target.profile());
        boolean single = "single".equals(target.inputMode());
        List<String> lines = single ? target.singleInputLines() : List.of();
        Map<String, List<String>> files = single ? Map.of() : target.inputFiles();
        SourceAnalyzer.Analysis analysis = SourceAnalyzer.analyse(profile, lines, files);
        return RuleEngine.apply(new RuleEngine.Request(profile, Map.of(), analysis.facts(),
                lines, files, analysis.programs()));
    }
}
