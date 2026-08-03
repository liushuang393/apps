package jp.co.softroad.liteflow.controller;

import jp.co.softroad.liteflow.governance.ApprovalRequest;
import jp.co.softroad.liteflow.governance.AuditEntry;
import jp.co.softroad.liteflow.governance.RollbackResult;
import jp.co.softroad.liteflow.governance.RuleDiff;
import jp.co.softroad.liteflow.governance.RuleGovernanceService;
import jp.co.softroad.liteflow.governance.RuleRevision;
import jp.co.softroad.liteflow.governance.RuleSummary;
import jp.co.softroad.liteflow.model.ApprovalDecisionCommand;
import jp.co.softroad.liteflow.model.ApprovalRequestCommand;
import jp.co.softroad.liteflow.model.PublishChainCommand;
import jp.co.softroad.liteflow.model.PublishResultView;
import jp.co.softroad.liteflow.model.PublishScriptCommand;
import jp.co.softroad.liteflow.model.PublishScriptResultView;
import jp.co.softroad.liteflow.model.RollbackCommand;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.security.Principal;
import java.util.List;
import java.util.Map;

/**
 * ルール公開・管理API（シナリオ#3）。
 *
 * <p>発行は必ず {@link RuleGovernanceService} を経由する。そうすることで
 * 「LiteFlow へ発行する」と「履歴と監査を残す」が必ず一組で起きる。
 * LiteFlow 自体は履歴を持たないので、この経路を迂回した発行は前の版を永久に失う。
 *
 * <p>認証は {@code SecurityConfig} が {@code /api/rules/**} に対して掛けている。
 * 実行API（{@code /api/flows/**}）と actuator は無認証のままにしてある。
 */
@RestController
@RequestMapping("/api/rules")
public class RuleController {
    private final RuleGovernanceService governance;

    public RuleController(RuleGovernanceService governance) {
        this.governance = governance;
    }

    private static String actorOf(Principal principal) {
        return principal == null ? "anonymous" : principal.getName();
    }

    // ---- 発行 -------------------------------------------------------------------

    @PostMapping("/chains")
    public ResponseEntity<PublishResultView> publishChain(@RequestBody PublishChainCommand command,
                                                          Principal principal) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(governance.publishChain(command, actorOf(principal), command.getComment()));
    }

    @PostMapping("/scripts")
    public ResponseEntity<PublishScriptResultView> publishScript(
            @RequestBody PublishScriptCommand command, Principal principal) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(governance.publishScript(command, actorOf(principal), command.getComment()));
    }

    // ---- 参照 -------------------------------------------------------------------

    @GetMapping
    public Map<String, Object> list() {
        List<RuleSummary> rules = governance.listRules();
        return Map.of("count", rules.size(), "rules", rules);
    }

    @GetMapping("/{targetType}/{targetId}")
    public RuleSummary detail(@PathVariable String targetType, @PathVariable String targetId) {
        return governance.findRule(targetType, targetId)
                .orElseThrow(() -> new IllegalArgumentException(
                        "unknown rule: " + targetType + "/" + targetId));
    }

    @GetMapping("/{targetType}/{targetId}/revisions")
    public Map<String, Object> revisions(@PathVariable String targetType,
                                         @PathVariable String targetId) {
        List<RuleRevision> history = governance.history(targetType, targetId);
        return Map.of("targetType", targetType, "targetId", targetId,
                "count", history.size(), "revisions", history);
    }

    @GetMapping("/{targetType}/{targetId}/diff")
    public RuleDiff diff(@PathVariable String targetType, @PathVariable String targetId,
                         @RequestParam(required = false) Long from,
                         @RequestParam(required = false) Long to) {
        return governance.diff(targetType, targetId, from, to);
    }

    // ---- ロールバック ------------------------------------------------------------

    @PostMapping("/{targetType}/{targetId}/rollback")
    public RollbackResult rollback(@PathVariable String targetType, @PathVariable String targetId,
                                   @RequestBody RollbackCommand command, Principal principal) {
        if (command.getToVersion() == null) {
            throw new IllegalArgumentException("toVersion is required");
        }
        return governance.rollback(targetType, targetId, command.getToVersion(),
                command.getExpectedVersion(), actorOf(principal), command.getComment());
    }

    // ---- 承認フロー --------------------------------------------------------------

    @PostMapping("/approvals")
    public ResponseEntity<ApprovalRequest> request(@RequestBody ApprovalRequestCommand command,
                                                   Principal principal) {
        return ResponseEntity.status(HttpStatus.CREATED).body(governance.request(
                command.getTargetType(), command.getTargetId(), command.getBody(),
                command.getAttrs(), command.getExpectedVersion(), actorOf(principal),
                command.getComment()));
    }

    @GetMapping("/approvals")
    public Map<String, Object> approvals(@RequestParam(required = false) String status) {
        List<ApprovalRequest> requests = governance.approvals(status);
        return Map.of("count", requests.size(), "approvals", requests);
    }

    @PostMapping("/approvals/{id}/approve")
    public ApprovalRequest approve(@PathVariable long id,
                                   @RequestBody(required = false) ApprovalDecisionCommand command,
                                   Principal principal) {
        return governance.approve(id, actorOf(principal), command == null ? null : command.getNote());
    }

    @PostMapping("/approvals/{id}/reject")
    public ApprovalRequest reject(@PathVariable long id,
                                  @RequestBody(required = false) ApprovalDecisionCommand command,
                                  Principal principal) {
        return governance.reject(id, actorOf(principal), command == null ? null : command.getNote());
    }

    // ---- 監査 -------------------------------------------------------------------

    @GetMapping("/audit")
    public Map<String, Object> audit(@RequestParam(defaultValue = "100") int limit) {
        List<AuditEntry> entries = governance.audit(limit);
        return Map.of("count", entries.size(), "entries", entries);
    }
}
