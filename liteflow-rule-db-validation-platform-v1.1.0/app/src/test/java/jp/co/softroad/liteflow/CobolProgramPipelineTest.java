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
import jp.co.softroad.liteflow.transform.CobolProgram;
import jp.co.softroad.liteflow.transform.CompileOutcome;
import jp.co.softroad.liteflow.transform.GeneratedProgramCompiler;
import jp.co.softroad.liteflow.transform.TemplateLibrary;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 複数ファイルのCOBOLプログラムを、ルール表だけで「解析 → 変換 → コンパイル → 実行」まで
 * 通せることを {@code mvn verify} で守る。
 *
 * <p>コーパス（{@code scripts\corpus-run.cmd -Family cobol-programs}）と同じ経路だが、
 * こちらは Docker も Executor も要らない。ルール表を触ったときに20秒で気づけるようにするためのもの。
 */
@SpringBootTest
class CobolProgramPipelineTest {
    private static final String PIPELINE_EL =
            "THEN(validate,analyze,transform,compile,test,qualityGate,report)";
    private static final String PROFILE = "cobol-programs-v1";

    private static final List<String> MAIN = List.of(
            "IDENTIFICATION DIVISION.",
            "PROGRAM-ID. MAINPGM.",
            "DATA DIVISION.",
            "WORKING-STORAGE SECTION.",
            "01 WS-TOTAL      PIC 9(7) VALUE 0.",
            "01 WS-I          PIC 9(3) VALUE 0.",
            "01 WS-LABEL      PIC X(8) VALUE SPACES.",
            "PROCEDURE DIVISION.",
            "MAIN-PARA.",
            "    MOVE 1 TO WS-I",
            "    PERFORM ADD-PARA UNTIL WS-I > 3",
            "    CALL 'SUBDBL' USING WS-TOTAL",
            "    IF WS-TOTAL > 100",
            "        MOVE 'BIG' TO WS-LABEL",
            "        GO TO END-PARA",
            "    END-IF",
            "    MOVE 'SMALL' TO WS-LABEL",
            "    GO TO END-PARA.",
            "ADD-PARA.",
            "    ADD WS-STEP TO WS-TOTAL",
            "    ADD 1 TO WS-I.",
            "NEVER-PARA.",
            "    MOVE 'NEVER' TO WS-LABEL.",
            "END-PARA.",
            "    DISPLAY WS-LABEL",
            "    STOP RUN.");

    private static final List<String> SUB = List.of(
            "IDENTIFICATION DIVISION.",
            "PROGRAM-ID. SUBDBL.",
            "DATA DIVISION.",
            "WORKING-STORAGE SECTION.",
            "01 WS-I          PIC 9(3) VALUE 555.",
            "LINKAGE SECTION.",
            "01 LK-VALUE      PIC 9(7).",
            "PROCEDURE DIVISION USING LK-VALUE.",
            "DOUBLE-PARA.",
            "    MULTIPLY 2 BY LK-VALUE",
            "    GOBACK.");

    @Autowired
    private FlowExecutor flowExecutor;

    @Autowired
    private TemplateLibrary templateLibrary;

    @Autowired
    private javax.sql.DataSource dataSource;

    private String publishPipelineChain() {
        String chainId = "itCobolPrograms" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        try (RulePublisher publisher = RulePublisherFactory.create(SqlPublisherConfig.builder()
                .applicationName("liteflow-validation-platform-test")
                .dataSource(dataSource)
                .build())) {
            publisher.publishChain(PublishChainRequest.builder()
                    .chainId(chainId).el(PIPELINE_EL).expectedVersion(0L).build());
        }
        RuleDbSyncManager.reconcileOnce();
        return chainId;
    }

    private MigrationContext newContext() {
        MigrationContext context = new MigrationContext("cobol-programs-test");
        context.setTemplateProfile(PROFILE);
        context.setSourceFiles(new LinkedHashMap<>(Map.of("MAINPGM.cbl", MAIN, "SUBDBL.cbl", SUB)));
        context.setEntryProgram("MAINPGM");
        context.setMaxUncoveredRate(0.0);
        return context;
    }

    private static BehaviourExpectation expectation(String name, Map<String, Object> given,
                                                    Map<String, Object> expect, List<String> display) {
        BehaviourExpectation expectation = new BehaviourExpectation();
        expectation.setName(name);
        expectation.setGiven(given);
        expectation.setExpect(expect);
        expectation.setExpectDisplay(display);
        return expectation;
    }

    @Test
    void profileIsLoadedAndDeclaresStructureRules() {
        assertTrue(templateLibrary.profileNames().contains(PROFILE));
        assertFalse(templateLibrary.require(PROFILE).getStructure().isEmpty(),
                "構造規則が無いと段落を切り出せない");
    }

    @Test
    void multipleProgramsAreAnalysedCompiledAndExecuted() {
        String chainId = publishPipelineChain();
        MigrationContext context = newContext();
        context.setExpectations(List.of(
                expectation("合計が閾値を超えると CALL 後に BIG へ分岐する",
                        Map.of("WS-STEP", 30),
                        Map.of("WS-TOTAL", 180, "WS-I", 4, "WS-LABEL", "BIG"),
                        List.of("BIG")),
                expectation("閾値以下なら SMALL。副プログラムの WS-I は呼び出し元を壊さない",
                        Map.of("WS-STEP", 10),
                        Map.of("WS-TOTAL", 60, "WS-I", 4, "WS-LABEL", "SMALL"),
                        List.of("SMALL"))));

        try {
            LiteflowResponse response = flowExecutor.execute2Resp(chainId, "cobol-programs", context);

            assertEquals(2, context.getPrograms().size(), "2本のプログラムが認識されること");
            CobolProgram main = context.getPrograms().stream()
                    .filter(program -> "MAINPGM".equals(program.getProgramId()))
                    .findFirst().orElseThrow();
            assertEquals(List.of("MAIN-PARA", "ADD-PARA", "NEVER-PARA", "END-PARA"),
                    List.copyOf(main.getParagraphs().keySet()));

            CompileOutcome compiled = context.getCompileOutcome();
            assertNotNull(compiled);
            assertTrue(compiled.isCompilerAvailable(), "JDK が必要");
            assertTrue(compiled.isSuccess(),
                    () -> "コンパイル失敗: " + compiled.getFailureReason() + "\n" + compiled.getSource());
            assertEquals(GeneratedProgramCompiler.PACKAGE + ".MAINPGM", context.getEntryClassName());

            List<BehaviourExpectation.Result> results = context.getTestResults();
            assertEquals(2, results.size());
            results.forEach(result -> assertTrue(result.isPassed(),
                    () -> result.getName() + " -> " + result.getMismatches() + " " + result.getError()));
            assertEquals("PASS", context.getQualityGate(), context.getQualityGateFindings()::toString);
            assertTrue(response.isSuccess());
        } finally {
            GeneratedProgramCompiler.deleteRecursively(context.getWorkDir());
        }
    }

    @Test
    void unsupportedStatementsAreCountedAndRejected() {
        String chainId = publishPipelineChain();
        MigrationContext context = new MigrationContext("cobol-programs-negative");
        context.setTemplateProfile(PROFILE);
        context.setSourceFiles(new LinkedHashMap<>(Map.of("ODDPGM.cbl", List.of(
                "IDENTIFICATION DIVISION.",
                "PROGRAM-ID. ODDPGM.",
                "PROCEDURE DIVISION.",
                "MAIN-PARA.",
                "    MOVE 0 TO WS-A",
                "    INSPECT WS-A TALLYING WS-B FOR ALL 'X'",
                "    STOP RUN."))));
        context.setEntryProgram("ODDPGM");
        context.setMaxUncoveredRate(0.0);

        try {
            LiteflowResponse response = flowExecutor.execute2Resp(chainId, "negative", context);

            assertFalse(response.isSuccess(), "未対応の文があるチェーンは成功してはならない");
            assertEquals("FAIL", context.getQualityGate());
            assertEquals(1, context.getCoverage().getUnrecognisedLines());
            assertTrue(context.getQualityGateFindings().stream()
                            .anyMatch(finding -> finding.startsWith("coverage:")),
                    context.getQualityGateFindings()::toString);
        } finally {
            GeneratedProgramCompiler.deleteRecursively(context.getWorkDir());
        }
    }
}
