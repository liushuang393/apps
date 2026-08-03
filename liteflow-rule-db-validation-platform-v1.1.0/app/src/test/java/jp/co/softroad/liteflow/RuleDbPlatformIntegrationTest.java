package jp.co.softroad.liteflow;

import com.yomahub.liteflow.core.FlowExecutor;
import com.yomahub.liteflow.flow.LiteflowResponse;
import com.yomahub.liteflow.publisher.PublishChainRequest;
import com.yomahub.liteflow.publisher.PublishResult;
import com.yomahub.liteflow.publisher.RulePublisher;
import com.yomahub.liteflow.publisher.RulePublisherFactory;
import com.yomahub.liteflow.publisher.exception.VersionConflictException;
import com.yomahub.liteflow.repository.RuleDbSyncManager;
import com.yomahub.liteflow.repository.sql.SqlPublisherConfig;
import jp.co.softroad.liteflow.model.MigrationContext;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.Arrays;
import java.util.UUID;

@SpringBootTest
class RuleDbPlatformIntegrationTest {
    private static final String H2_URL = "jdbc:h2:mem:ruledb;DB_CLOSE_DELAY=-1;MODE=MySQL";

    @Autowired
    private FlowExecutor flowExecutor;

    @Test
    void publishExecuteUpdateAndRejectStaleVersion() {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String chainId = "itMigration" + suffix;
        String failureChainId = "itFailure" + suffix;

        try (RulePublisher publisher = RulePublisherFactory.create(SqlPublisherConfig.builder()
                .applicationName("liteflow-validation-platform-test")
                .url(H2_URL)
                .username("sa")
                .password("")
                .build())) {

            PublishResult v1 = publisher.publishChain(PublishChainRequest.builder()
                    .chainId(chainId)
                    .el("THEN(validate,analyze,transform,compile,test,qualityGate,report)")
                    .expectedVersion(0L)
                    .build());
            Assertions.assertEquals(1L, v1.getVersion());

            RuleDbSyncManager.reconcileOnce();
            MigrationContext firstContext = new MigrationContext("test-v1");
            LiteflowResponse first = execute(chainId, firstContext);
            Assertions.assertTrue(first.isSuccess());
            Assertions.assertEquals(
                    Arrays.asList("validate", "analyze", "transform", "compile", "test", "qualityGate", "report"),
                    firstContext.getTrace());

            PublishResult v2 = publisher.publishChain(PublishChainRequest.builder()
                    .chainId(chainId)
                    .el("THEN(validate,analyze,transform,compile,test,review,qualityGate,report)")
                    .expectedVersion(v1.getVersion())
                    .build());
            Assertions.assertEquals(2L, v2.getVersion());

            RuleDbSyncManager.reconcileOnce();
            MigrationContext updatedContext = new MigrationContext("test-v2");
            LiteflowResponse updated = execute(chainId, updatedContext);
            Assertions.assertTrue(updated.isSuccess());
            Assertions.assertEquals(
                    Arrays.asList("validate", "analyze", "transform", "compile", "test", "review", "qualityGate", "report"),
                    updatedContext.getTrace());

            Assertions.assertThrows(VersionConflictException.class,
                    () -> publisher.publishChain(PublishChainRequest.builder()
                            .chainId(chainId)
                            .el("THEN(validate,report)")
                            .expectedVersion(v1.getVersion())
                            .build()));

            publisher.publishChain(PublishChainRequest.builder()
                    .chainId(failureChainId)
                    .el("THEN(validate,forcedFailure,report)")
                    .expectedVersion(0L)
                    .build());
            RuleDbSyncManager.reconcileOnce();
            MigrationContext failureContext = new MigrationContext("test-failure");
            LiteflowResponse failed = execute(failureChainId, failureContext);
            Assertions.assertFalse(failed.isSuccess());
            Assertions.assertTrue(failureContext.getTrace().contains("forcedFailure"));
        }
    }

    private LiteflowResponse execute(String chainId, MigrationContext context) {
        return flowExecutor.execute2Resp(chainId, "integration-test", context);
    }
}
