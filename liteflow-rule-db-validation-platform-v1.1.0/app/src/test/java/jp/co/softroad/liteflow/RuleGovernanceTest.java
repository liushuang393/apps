package jp.co.softroad.liteflow;

import com.yomahub.liteflow.publisher.PublishChainRequest;
import com.yomahub.liteflow.publisher.RulePublisher;
import com.yomahub.liteflow.publisher.RulePublisherFactory;
import com.yomahub.liteflow.repository.sql.SqlPublisherConfig;
import jp.co.softroad.liteflow.governance.ApprovalRequest;
import jp.co.softroad.liteflow.governance.RuleGovernanceService;
import jp.co.softroad.liteflow.governance.RuleRevision;
import jp.co.softroad.liteflow.governance.SeparationOfDutiesException;
import jp.co.softroad.liteflow.model.PublishChainCommand;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 統制層の不変条件。<b>LiteFlow は履歴を持たない</b>という前提から来るものばかりである。
 *
 * <p>ここで守っているのは3つ。
 * <ol>
 *   <li>発行の直前に pre-image を記録する（取らなければ前の本文は永久に失われる）</li>
 *   <li>申請者と承認者は別人でなければならない（そうでないと承認フローは権限の境界にならない）</li>
 *   <li>同時申請でidが入れ替わらない</li>
 * </ol>
 */
@SpringBootTest
class RuleGovernanceTest {

    @Autowired
    private RuleGovernanceService governance;

    @Autowired
    private javax.sql.DataSource dataSource;

    private String newChainId() {
        return "itGov" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    /** 統制層を通さない発行。JUnit の各テストと demo-transform.ps1 が実際に使っている経路。 */
    private long publishOutsideGovernance(String chainId, String el, long expectedVersion) {
        try (RulePublisher publisher = RulePublisherFactory.create(SqlPublisherConfig.builder()
                .applicationName("liteflow-validation-platform-test")
                .dataSource(dataSource)
                .build())) {
            return publisher.publishChain(PublishChainRequest.builder()
                    .chainId(chainId).el(el).expectedVersion(expectedVersion).build()).getVersion();
        }
    }

    private PublishChainCommand chainCommand(String chainId, String el, long expectedVersion) {
        PublishChainCommand command = new PublishChainCommand();
        command.setChainId(chainId);
        command.setEl(el);
        command.setExpectedVersion(expectedVersion);
        return command;
    }

    // ---- 1. pre-image -----------------------------------------------------------

    @Test
    void versionPublishedOutsideGovernanceCanStillBeRolledBackTo() {
        String chainId = newChainId();
        // 統制層の外で2版まで進める。この時点で rm_rule_revision には1件も無い。
        publishOutsideGovernance(chainId, "THEN(validate,report)", 0L);
        long outsideVersion = publishOutsideGovernance(chainId, "THEN(validate,transform,report)", 1L);

        // 統制層から発行する。ここで pre-image が拾われなければ v2 の本文は永久に失われる。
        governance.publishChain(chainCommand(chainId, "THEN(validate,analyze,transform,report)",
                outsideVersion), "admin", "統制層からの初回発行");

        List<RuleRevision> history = governance.history("CHAIN", chainId);
        assertTrue(history.stream().anyMatch(r -> r.version() == outsideVersion),
                () -> "統制層の外で作られた版 " + outsideVersion + " が履歴に無い: "
                        + history.stream().map(RuleRevision::version).toList());
        assertEquals("THEN(validate,transform,report)",
                history.stream().filter(r -> r.version() == outsideVersion)
                        .findFirst().orElseThrow().body(),
                "pre-image は上書きされる直前の本文であること（post-image ではない）");

        // そしてその版へ戻せる。ロールバックは前向きの再発行なので版は進む。
        var rollback = governance.rollback("CHAIN", chainId, outsideVersion, null, "admin", null);
        assertEquals("THEN(validate,transform,report)", rollback.restoredBody());
        assertTrue(rollback.newVersion() > outsideVersion, "ロールバックは版を前へ進める");
    }

    @Test
    void preImageIsNotRecordedTwiceForTheSameVersion() {
        String chainId = newChainId();
        long v1 = publishOutsideGovernance(chainId, "THEN(validate,report)", 0L);
        governance.publishChain(chainCommand(chainId, "THEN(validate,transform,report)", v1),
                "admin", "1回目");
        governance.publishChain(chainCommand(chainId, "THEN(validate,analyze,report)", v1 + 1),
                "admin", "2回目");

        List<Long> versions = governance.history("CHAIN", chainId).stream()
                .map(RuleRevision::version).sorted().toList();

        assertEquals(versions.stream().distinct().toList(), versions,
                () -> "同じ版が二重に記録されている: " + versions);
    }

    @Test
    void newChainHasNoPreImage() {
        String chainId = newChainId();
        governance.publishChain(chainCommand(chainId, "THEN(validate,report)", 0L),
                "admin", "新規作成");

        List<RuleRevision> history = governance.history("CHAIN", chainId);
        assertEquals(1, history.size(), () -> "新規作成に pre-image は無いはず: " + history);
        assertEquals("admin", history.get(0).actor());
    }

    // ---- 2. 職務分離 -------------------------------------------------------------

    @Test
    void theRequesterCannotApproveTheirOwnRequest() {
        String chainId = newChainId();
        governance.publishChain(chainCommand(chainId, "THEN(validate,report)", 0L), "admin", null);
        ApprovalRequest request = governance.request("CHAIN", chainId,
                "THEN(validate,transform,report)", null, null, "approver", "自分で通したい");

        SeparationOfDutiesException thrown = assertThrows(SeparationOfDutiesException.class,
                () -> governance.approve(request.id(), "approver", "自己承認"));
        assertTrue(thrown.getMessage().contains("approver"), thrown::getMessage);

        // 申請は PENDING のまま残り、反映もされていない。
        ApprovalRequest after = governance.approvals("PENDING").stream()
                .filter(entry -> entry.id() == request.id()).findFirst().orElseThrow();
        assertEquals("PENDING", after.status());
        assertEquals("THEN(validate,report)",
                governance.findRule("CHAIN", chainId).orElseThrow().body(),
                "自己承認が失敗したのに本文が変わっている");
    }

    @Test
    void anotherActorCanApproveTheSameRequest() {
        String chainId = newChainId();
        governance.publishChain(chainCommand(chainId, "THEN(validate,report)", 0L), "admin", null);
        ApprovalRequest request = governance.request("CHAIN", chainId,
                "THEN(validate,transform,report)", null, null, "admin", "お願いします");

        ApprovalRequest applied = governance.approve(request.id(), "approver", "承認します");

        assertEquals("APPLIED", applied.status());
        assertEquals("approver", applied.decidedBy());
        assertEquals("THEN(validate,transform,report)",
                governance.findRule("CHAIN", chainId).orElseThrow().body());
    }

    @Test
    void theRequesterMayWithdrawTheirOwnRequestByRejectingIt() {
        // 却下は自分の申請にも許す。取り下げにあたるため。
        String chainId = newChainId();
        governance.publishChain(chainCommand(chainId, "THEN(validate,report)", 0L), "admin", null);
        ApprovalRequest request = governance.request("CHAIN", chainId,
                "THEN(validate,transform,report)", null, null, "approver", "やっぱり取り下げる");

        ApprovalRequest rejected = governance.reject(request.id(), "approver", "取り下げ");

        assertEquals("REJECTED", rejected.status());
    }

    // ---- 3. 同時申請の採番 -------------------------------------------------------

    @Test
    void concurrentRequestsEachGetTheirOwnId() throws Exception {
        String chainId = newChainId();
        governance.publishChain(chainCommand(chainId, "THEN(validate,report)", 0L), "admin", null);

        int threads = 8;
        CyclicBarrier startTogether = new CyclicBarrier(threads);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            List<Callable<ApprovalRequest>> jobs = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                String body = "THEN(validate,report) /* " + i + " */";
                jobs.add(() -> {
                    startTogether.await();
                    return governance.request("CHAIN", chainId, body, null, null,
                            "requester", "同時申請");
                });
            }
            List<ApprovalRequest> created = new ArrayList<>();
            for (Future<ApprovalRequest> future : pool.invokeAll(jobs)) {
                created.add(future.get());
            }

            assertEquals(threads, created.stream().map(ApprovalRequest::id).distinct().count(),
                    () -> "idが重複している: " + created.stream()
                            .map(entry -> String.valueOf(entry.id())).collect(Collectors.joining(",")));
            // 返ってきた本文が、自分が申請した本文であること（他人の行を渡されていないこと）
            created.forEach(entry -> {
                assertNotNull(entry.body());
                assertTrue(entry.body().startsWith("THEN(validate,report)"), entry::body);
            });
            assertEquals(created.size(),
                    created.stream().map(ApprovalRequest::body).distinct().count(),
                    "同じ本文が2件返っている＝他人の行を受け取っている");
        } finally {
            pool.shutdownNow();
        }
    }
}
