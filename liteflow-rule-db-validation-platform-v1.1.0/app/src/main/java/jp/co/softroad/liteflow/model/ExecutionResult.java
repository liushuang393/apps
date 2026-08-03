package jp.co.softroad.liteflow.model;

import jp.co.softroad.liteflow.transform.BehaviourExpectation;
import jp.co.softroad.liteflow.transform.CompileOutcome;
import jp.co.softroad.liteflow.transform.CoverageSummary;
import jp.co.softroad.liteflow.transform.GoldenComparison;

import java.util.List;
import java.util.Map;

public class ExecutionResult {
    private final boolean success;
    private final String requestId;
    private final List<String> trace;
    private final String executeStep;
    private final String error;
    private final long elapsedMs;
    private final String generatedCode;
    private final CoverageSummary coverage;
    private final CompileOutcome compile;
    private final List<BehaviourExpectation.Result> tests;
    private final String qualityGate;
    private final List<String> qualityGateFindings;
    private final Map<String, List<String>> generatedArtifacts;
    private final List<GoldenComparison> golden;
    private final Map<String, CoverageSummary> coverageByFile;
    private final Map<String, String> facts;

    private ExecutionResult(Builder builder) {
        this.success = builder.success;
        this.requestId = builder.requestId;
        this.trace = builder.trace;
        this.executeStep = builder.executeStep;
        this.error = builder.error;
        this.elapsedMs = builder.elapsedMs;
        this.generatedCode = builder.generatedCode;
        this.coverage = builder.coverage;
        this.compile = builder.compile;
        this.tests = builder.tests;
        this.qualityGate = builder.qualityGate;
        this.qualityGateFindings = builder.qualityGateFindings;
        this.generatedArtifacts = builder.generatedArtifacts;
        this.golden = builder.golden;
        this.coverageByFile = builder.coverageByFile;
        this.facts = builder.facts;
    }

    /** 変換パイプラインがコンテキストに記録した内容をすべて収集する。 */
    public static ExecutionResult from(MigrationContext context, boolean success, String executeStep,
                                      String error, long elapsedMs) {
        Builder builder = new Builder();
        builder.success = success;
        builder.requestId = context.getRequestId();
        builder.trace = context.getTrace();
        builder.executeStep = executeStep;
        builder.error = error;
        builder.elapsedMs = elapsedMs;
        builder.generatedCode = context.getGeneratedCode();
        builder.coverage = context.getCoverage();
        builder.compile = context.getCompileOutcome();
        builder.tests = context.getTestResults();
        builder.qualityGate = context.getQualityGate();
        builder.qualityGateFindings = context.getQualityGateFindings();
        builder.generatedArtifacts = context.getGeneratedArtifacts();
        builder.golden = context.getGoldenResults();
        builder.coverageByFile = context.getCoverageByFile();
        builder.facts = context.getFacts();
        return new ExecutionResult(builder);
    }

    private static final class Builder {
        private boolean success;
        private String requestId;
        private List<String> trace;
        private String executeStep;
        private String error;
        private long elapsedMs;
        private String generatedCode;
        private CoverageSummary coverage;
        private CompileOutcome compile;
        private List<BehaviourExpectation.Result> tests;
        private String qualityGate;
        private List<String> qualityGateFindings;
        private Map<String, List<String>> generatedArtifacts;
        private List<GoldenComparison> golden;
        private Map<String, CoverageSummary> coverageByFile;
        private Map<String, String> facts;
    }

    public boolean isSuccess() {
        return success;
    }

    public String getRequestId() {
        return requestId;
    }

    public List<String> getTrace() {
        return trace;
    }

    public String getExecuteStep() {
        return executeStep;
    }

    public String getError() {
        return error;
    }

    public long getElapsedMs() {
        return elapsedMs;
    }

    /** 変換ノードが生成したコード。変換を行わないチェーンでは空。 */
    public String getGeneratedCode() {
        return generatedCode;
    }

    /** ルールセットが認識できた入力行と、未カバー率。 */
    public CoverageSummary getCoverage() {
        return coverage;
    }

    /** 生成コードに対する実際の javac 結果。 */
    public CompileOutcome getCompile() {
        return compile;
    }

    /** コンパイル済みコードを実行したケース単位の振る舞い結果。 */
    public List<BehaviourExpectation.Result> getTests() {
        return tests;
    }

    public String getQualityGate() {
        return qualityGate;
    }

    public List<String> getQualityGateFindings() {
        return qualityGateFindings;
    }

    /** 成果物名 → 生成行。1入力から複数成果物を作るファミリでのみ埋まる。 */
    public Map<String, List<String>> getGeneratedArtifacts() {
        return generatedArtifacts;
    }

    /** 事前に用意した正解との突き合わせ結果。期待ファイルを渡さなければ空。 */
    public List<GoldenComparison> getGolden() {
        return golden;
    }

    /** 入力ファイル別のカバレッジ。集計値の {@link #getCoverage()} とは別の追加情報。 */
    public Map<String, CoverageSummary> getCoverageByFile() {
        return coverageByFile;
    }

    /** ファイル横断で集めた変数。ルール表のデバッグに使う。 */
    public Map<String, String> getFacts() {
        return facts;
    }
}
