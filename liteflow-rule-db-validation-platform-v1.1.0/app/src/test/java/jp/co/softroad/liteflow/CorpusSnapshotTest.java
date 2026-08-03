package jp.co.softroad.liteflow;

import com.yomahub.liteflow.core.FlowExecutor;
import com.yomahub.liteflow.publisher.PublishChainRequest;
import com.yomahub.liteflow.publisher.RulePublisher;
import com.yomahub.liteflow.publisher.RulePublisherFactory;
import com.yomahub.liteflow.repository.RuleDbSyncManager;
import com.yomahub.liteflow.repository.sql.SqlPublisherConfig;
import jp.co.softroad.liteflow.corpus.CorpusCases;
import jp.co.softroad.liteflow.corpus.TransformSnapshot;
import jp.co.softroad.liteflow.model.MigrationContext;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * コーパス19ケース全部の<b>変換結果をスナップショットで固定する</b>。
 *
 * <p>これは機能追加のためのテストではない。<b>改修の安全網</b>である。
 * 生成コードが1バイトでも変わればここが赤くなる。とくに凍結してある
 * {@code compilable-v1}（12ケース）は、リファクタで1文字も変えてはいけない。
 *
 * <p>チェーンは {@code THEN(validate,analyze,transform)} だけを使う。javac も実行も挟まないので
 * 19ケースを数秒で回せる。コンパイルと振る舞いの判定は
 * {@code TransformPipelineTest} / {@code CobolProgramPipelineTest} / コーパス実行が担う。
 *
 * <p>スナップショットを作り直すとき:
 * {@code mvn -f app/pom.xml test -Dtest=CorpusSnapshotTest -Dsnapshot.update=true}
 */
@SpringBootTest
class CorpusSnapshotTest {
    private static final String EL = "THEN(validate,analyze,transform)";

    @Autowired
    private FlowExecutor flowExecutor;

    @Autowired
    private javax.sql.DataSource dataSource;

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

        String chainId = publishChain();
        List<String> problems = new ArrayList<>();
        for (CorpusCases.Case target : cases) {
            MigrationContext context = new MigrationContext("snapshot-" + target.id());
            context.setTemplateProfile(target.profile());
            if ("single".equals(target.inputMode())) {
                context.setSourceLines(target.singleInputLines());
            } else {
                context.setSourceFiles(target.inputFiles());
            }
            if (target.entryProgram() != null) {
                context.setEntryProgram(target.entryProgram());
            }

            flowExecutor.execute2Resp(chainId, "snapshot", context);

            String actual = TransformSnapshot.render(target, context.getGeneratedLines(),
                    context.getGeneratedArtifacts(), context.getCoverage(),
                    context.getCoverageByFile(), context.getQualityGateFindings());
            String problem = TransformSnapshot.compare(target, actual);
            if (problem != null) {
                problems.add(problem);
            }
        }
        Assertions.assertTrue(problems.isEmpty(),
                () -> problems.size() + " 件のケースで変換結果が変わっている:\n"
                        + String.join("\n\n", problems));
    }

    private String publishChain() {
        String chainId = "itSnapshot" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        try (RulePublisher publisher = RulePublisherFactory.create(SqlPublisherConfig.builder()
                .applicationName("liteflow-validation-platform-test")
                .dataSource(dataSource)
                .build())) {
            publisher.publishChain(PublishChainRequest.builder()
                    .chainId(chainId).el(EL).expectedVersion(0L).build());
        }
        RuleDbSyncManager.reconcileOnce();
        return chainId;
    }
}
