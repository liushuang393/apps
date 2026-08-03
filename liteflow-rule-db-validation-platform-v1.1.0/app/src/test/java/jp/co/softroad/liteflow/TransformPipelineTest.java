package jp.co.softroad.liteflow;

import com.yomahub.liteflow.core.FlowExecutor;
import com.yomahub.liteflow.flow.LiteflowResponse;
import com.yomahub.liteflow.publisher.PublishChainRequest;
import com.yomahub.liteflow.publisher.RulePublisher;
import com.yomahub.liteflow.publisher.RulePublisherFactory;
import com.yomahub.liteflow.repository.RuleDbSyncManager;
import com.yomahub.liteflow.repository.sql.SqlPublisherConfig;
import jp.co.softroad.liteflow.model.MigrationContext;
import jp.co.softroad.liteflow.transform.BehaviourExpectation;
import jp.co.softroad.liteflow.transform.CompileOutcome;
import jp.co.softroad.liteflow.transform.CoverageSummary;
import jp.co.softroad.liteflow.transform.GeneratedProgramCompiler;
import jp.co.softroad.liteflow.transform.TemplateLibrary;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 「生成 → コンパイル → 振る舞いテスト」の閉ループをビルドのゲートにする。
 *
 * <p>コーパス実行スクリプトは同じパイプラインをHTTP経由で動かすが、こちらは保証を
 * {@code mvn verify} の中に置く。壊れたルール表がイメージまで到達しないようにするためである。
 */
@SpringBootTest
class TransformPipelineTest {
    private static final String H2_URL = "jdbc:h2:mem:ruledb;DB_CLOSE_DELAY=-1;MODE=MySQL";
    private static final String PIPELINE_EL =
            "THEN(validate,analyze,transform,compile,test,qualityGate,report)";

    @Autowired
    private FlowExecutor flowExecutor;

    @Autowired
    private TemplateLibrary templateLibrary;

    @Test
    void packagedProfilesAreLoadedAndVersioned() {
        Assertions.assertTrue(templateLibrary.profileNames().contains("compilable-v1"),
                "expected packaged profiles, got: " + templateLibrary.profileNames());
        var profile = templateLibrary.require("compilable-v1");
        Assertions.assertEquals(1, profile.getVersion());
        Assertions.assertFalse(profile.getRules().isEmpty());
        Assertions.assertNotNull(profile.getOwner());
    }

    @Test
    void generatedCodeCompilesAndBehavesAsExpected() {
        String chainId = publishPipelineChain();

        MigrationContext context = newContext(List.of(
                "MOVE WS-CUSTOMER-ID TO WS-OUT-ID.",
                "ADD 1 TO WS-COUNTER.",
                "COMPUTE WS-NET = WS-GROSS - WS-TAX.",
                "IF WS-NET > 100",
                "MOVE 1 TO WS-BIG",
                "ELSE",
                "MOVE 0 TO WS-BIG",
                "END-IF."));
        context.setExpectations(List.of(
                expectation("high value",
                        Map.of("WS-CUSTOMER-ID", 7, "WS-OUT-ID", 0, "WS-COUNTER", 0,
                                "WS-GROSS", 500, "WS-TAX", 50, "WS-NET", 0, "WS-BIG", 9),
                        Map.of("WS-OUT-ID", 7, "WS-COUNTER", 1, "WS-NET", 450, "WS-BIG", 1)),
                expectation("low value",
                        Map.of("WS-CUSTOMER-ID", 7, "WS-OUT-ID", 0, "WS-COUNTER", 0,
                                "WS-GROSS", 100, "WS-TAX", 50, "WS-NET", 0, "WS-BIG", 9),
                        Map.of("WS-NET", 50, "WS-BIG", 0))));
        context.setMaxUncoveredRate(0.0);

        try {
            LiteflowResponse response = flowExecutor.execute2Resp(chainId, "pipeline-test", context);

            CompileOutcome compiled = context.getCompileOutcome();
            Assertions.assertNotNull(compiled, "compile node did not run");
            Assertions.assertTrue(compiled.isCompilerAvailable(),
                    "no JDK compiler at test runtime: " + compiled.getFailureReason());
            Assertions.assertTrue(compiled.isSuccess(),
                    () -> "generated code did not compile: " + compiled.getFailureReason()
                            + "\n--- source ---\n" + compiled.getSource());

            List<BehaviourExpectation.Result> results = context.getTestResults();
            Assertions.assertEquals(2, results.size());
            results.forEach(result -> Assertions.assertTrue(result.isPassed(),
                    () -> result.getName() + " failed: " + result.getMismatches() + " " + result.getError()));

            CoverageSummary coverage = context.getCoverage();
            Assertions.assertEquals(0, coverage.getUnrecognisedLines(),
                    () -> "unrecognised: " + coverage.getUnrecognisedSamples());
            Assertions.assertEquals("PASS", context.getQualityGate());
            Assertions.assertTrue(response.isSuccess());
        } finally {
            GeneratedProgramCompiler.deleteRecursively(context.getWorkDir());
        }
    }

    @Test
    void qualityGateRejectsUncoveredStatements() {
        String chainId = publishPipelineChain();

        // PERFORM と EVALUATE にはルールが無い。この実行を成功として報告してはならない。
        MigrationContext context = newContext(List.of(
                "MOVE 1 TO WS-FLAG.",
                "PERFORM VALIDATE-CUSTOMER.",
                "EVALUATE WS-STATUS"));
        context.setMaxUncoveredRate(0.0);

        try {
            LiteflowResponse response = flowExecutor.execute2Resp(chainId, "gate-test", context);

            Assertions.assertFalse(response.isSuccess(), "an uncovered statement must fail the chain");
            Assertions.assertEquals("FAIL", context.getQualityGate());
            Assertions.assertEquals(2, context.getCoverage().getUnrecognisedLines());
            Assertions.assertTrue(context.getQualityGateFindings().stream()
                            .anyMatch(finding -> finding.startsWith("coverage:")),
                    () -> "expected a coverage finding, got " + context.getQualityGateFindings());
        } finally {
            GeneratedProgramCompiler.deleteRecursively(context.getWorkDir());
        }
    }

    @Test
    void qualityGateRejectsCodeThatCompilesButMisbehaves() {
        String chainId = publishPipelineChain();

        // 数値比較の if-compare ルールは英数字オペランドにもマッチしてしまうため
        // num("ABC") を出力する。これはコンパイルは通り、実行時に例外になる。
        // 振る舞いテストだけがこれを捕まえられる。
        MigrationContext context = newContext(List.of(
                "MOVE 'ABC' TO WS-NAME.",
                "IF WS-NAME = 'ABC'",
                "MOVE 1 TO WS-MATCH",
                "END-IF."));
        context.setExpectations(List.of(expectation("alphanumeric equality",
                Map.of("WS-NAME", "XYZ", "WS-MATCH", 9),
                Map.of("WS-MATCH", 1))));

        try {
            LiteflowResponse response = flowExecutor.execute2Resp(chainId, "semantic-gap-test", context);

            Assertions.assertTrue(context.getCompileOutcome().isSuccess(),
                    "the point of this case is that it compiles");
            Assertions.assertFalse(response.isSuccess());
            Assertions.assertEquals("FAIL", context.getQualityGate());
            Assertions.assertTrue(context.getQualityGateFindings().stream()
                            .anyMatch(finding -> finding.startsWith("behaviour:")),
                    () -> "expected a behaviour finding, got " + context.getQualityGateFindings());
        } finally {
            GeneratedProgramCompiler.deleteRecursively(context.getWorkDir());
        }
    }

    private String publishPipelineChain() {
        String chainId = "itPipeline" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        try (RulePublisher publisher = RulePublisherFactory.create(SqlPublisherConfig.builder()
                .applicationName("liteflow-validation-platform-test")
                .url(H2_URL)
                .username("sa")
                .password("")
                .build())) {
            publisher.publishChain(PublishChainRequest.builder()
                    .chainId(chainId)
                    .el(PIPELINE_EL)
                    .expectedVersion(0L)
                    .build());
        }
        RuleDbSyncManager.reconcileOnce();
        return chainId;
    }

    private MigrationContext newContext(List<String> sourceLines) {
        MigrationContext context = new MigrationContext("pipeline-test");
        context.setSourceLines(sourceLines);
        context.setTemplateProfile("compilable-v1");
        return context;
    }

    private BehaviourExpectation expectation(String name, Map<String, Object> given,
                                             Map<String, Object> expect) {
        BehaviourExpectation expectation = new BehaviourExpectation();
        expectation.setName(name);
        expectation.setGiven(new LinkedHashMap<>(given));
        expectation.setExpect(new LinkedHashMap<>(expect));
        return expectation;
    }
}
