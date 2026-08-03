package jp.co.softroad.liteflow.node;

import com.yomahub.liteflow.annotation.LiteflowComponent;
import jp.co.softroad.liteflow.model.MigrationContext;
import jp.co.softroad.liteflow.transform.BehaviourExpectation;
import jp.co.softroad.liteflow.transform.CompileOutcome;
import jp.co.softroad.liteflow.transform.CoverageSummary;
import jp.co.softroad.liteflow.transform.GoldenComparison;

import java.util.List;
import java.util.Locale;

/**
 * 生成コードがコンパイルできない、期待どおりに動かない、入力の未カバーが多すぎる、
 * のいずれかの場合にチェーンを失敗させる。
 *
 * <p>ここで例外を投げることに意味がある。コンパイルできない、あるいは誤ったコードを生んだ
 * 移行実行を成功として報告してはならない。理由が分かるよう findings はコンテキストに残す。
 *
 * <p>オーケストレーション専用チェーン（生成コードなし）では何もせず通す。
 * Rule-DB検証のチェーンがこれに当たる。
 */
@LiteflowComponent("qualityGate")
public class QualityGateNode extends AbstractTraceNode {

    @Override
    public void process() {
        mark("qualityGate");

        MigrationContext context = getContextBean(MigrationContext.class);
        if (!context.hasGeneratedOutput()) {
            // 生成物が無いときは finding を1件も足さないこと。足すと下で例外を投げてしまい、
            // ソースを渡さないオーケストレーション専用チェーンが全滅する。
            context.setQualityGate("SKIPPED_NO_CODE");
            return;
        }

        CompileOutcome compiled = context.getCompileOutcome();
        if (compiled != null && compiled.isAttempted()) {
            if (!compiled.isCompilerAvailable()) {
                context.addQualityGateFinding("compile: " + compiled.getFailureReason());
            } else if (!compiled.isSuccess()) {
                context.addQualityGateFinding("compile: " + compiled.getErrorCount()
                        + " javac error(s): " + firstErrors(compiled));
            }
        }

        List<BehaviourExpectation.Result> results = context.getTestResults();
        long failed = results.stream().filter(result -> !result.isPassed()).count();
        if (failed > 0) {
            context.addQualityGateFinding("behaviour: " + failed + "/" + results.size()
                    + " case(s) failed: " + firstFailures(results));
        }
        if (!context.getExpectations().isEmpty() && results.isEmpty()) {
            context.addQualityGateFinding("behaviour: expectations were supplied but no case ran "
                    + "(compilation did not produce a runnable class)");
        }

        List<GoldenComparison> golden = context.getGoldenResults();
        long goldenFailed = golden.stream().filter(comparison -> !comparison.isMatched()).count();
        if (goldenFailed > 0) {
            context.addQualityGateFinding("golden: " + goldenFailed + "/" + golden.size()
                    + " artifact(s) differ from the expected output: " + firstGoldenDiffs(golden));
        }

        CoverageSummary coverage = context.getCoverage();
        Double limit = context.getMaxUncoveredRate();
        if (coverage != null && limit != null && coverage.getUncoveredRate() > limit) {
            context.addQualityGateFinding(String.format(Locale.ROOT,
                    "coverage: uncovered rate %.3f exceeds limit %.3f (%d of %d line(s) unrecognised)",
                    coverage.getUncoveredRate(), limit,
                    coverage.getUnrecognisedLines(), coverage.getTotalLines()));
        }

        List<String> findings = context.getQualityGateFindings();
        if (findings.isEmpty()) {
            context.setQualityGate("PASS");
            return;
        }
        context.setQualityGate("FAIL");
        throw new IllegalStateException("quality gate failed: " + String.join(" | ", findings));
    }

    private String firstErrors(CompileOutcome compiled) {
        return compiled.getDiagnostics().stream()
                .filter(d -> "ERROR".equals(d.getKind()))
                .limit(3)
                .map(d -> "line " + d.getLine() + ": " + d.getMessage())
                .reduce((a, b) -> a + "; " + b)
                .orElse(String.valueOf(compiled.getFailureReason()));
    }

    private String firstGoldenDiffs(List<GoldenComparison> golden) {
        return golden.stream()
                .filter(comparison -> !comparison.isMatched())
                .limit(3)
                .map(comparison -> comparison.getArtifact() + " -> "
                        + (comparison.isMissing() ? "not generated at all"
                        : String.join("; ", comparison.getDifferences().stream().limit(2).toList())))
                .reduce((a, b) -> a + " | " + b)
                .orElse("");
    }

    private String firstFailures(List<BehaviourExpectation.Result> results) {
        return results.stream()
                .filter(result -> !result.isPassed())
                .limit(3)
                .map(result -> result.getName() + " -> "
                        + (result.getError() != null ? result.getError()
                        : String.join(", ", result.getMismatches())))
                .reduce((a, b) -> a + "; " + b)
                .orElse("");
    }
}
