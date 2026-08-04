package jp.co.softroad.liteflow.governance;

import jp.co.softroad.liteflow.model.PublishChainCommand;
import jp.co.softroad.liteflow.model.PublishResultView;
import jp.co.softroad.liteflow.model.PublishScriptCommand;
import jp.co.softroad.liteflow.model.PublishScriptResultView;
import jp.co.softroad.liteflow.service.RuleAdminService;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * ルール管理基盤（シナリオ#3）の中身。履歴・差分・ロールバック・承認・監査。
 *
 * <p>設計上の要点が5つある。
 * <ol>
 *   <li><b>発行は必ず {@link RuleAdminService} 経由。</b> つまり必ず LiteFlow の
 *       {@code RulePublisher} を通る。テーブルを直接書くと {@code lf_change_lock} の直列化と
 *       {@code lf_change_log} の採番を飛ばしてしまい、各 Executor が変更に気づけない</li>
 *   <li><b>発行の直前に pre-image を記録する。</b>（{@link #recordPreImage}）
 *       LiteFlow は上書き保存なので、<b>そこで取らなければ前の本文は永久に失われる</b>。
 *       統制層を通さない発行は実際に起きる — JUnit の各テストや、運用中に誰かが
 *       {@code RulePublisher} を直接使った場合である。すでに履歴にある版は積み直さない</li>
 *   <li><b>発行の直後に post-image を記録する。</b> この2つが揃って初めて
 *       「どの版の本文も履歴から取り出せる」が成立する</li>
 *   <li><b>ロールバックは「戻す」のではなく「古い本文を前向きに再発行する」。</b>
 *       LiteFlow に版を戻す原語は無い。v3 から v2 へ戻すと v4 になる</li>
 *   <li><b>申請者は自分の申請を承認できない。</b>（{@link #requireDifferentActor}）
 *       ロールを分けるだけでは権限の境界にならない。詳細は
 *       {@link SeparationOfDutiesException}</li>
 * </ol>
 */
@Service
public class RuleGovernanceService {
    public static final String CHAIN = "CHAIN";
    public static final String SCRIPT = "SCRIPT";
    /** 統制層の外で発行された版を後追いで記録したときの記録者名。人ではないと分かる形にする。 */
    public static final String PRE_IMAGE_ACTOR = "(pre-image)";
    /**
     * まだ承認／却下を受け付ける状態。
     *
     * <p>{@code APPROVED} を含めているのは、発行に失敗して「承認済みだが未反映」で
     * 止まった申請を再試行できるようにするため。
     */
    private static final List<String> DECIDABLE_STATUSES = List.of("PENDING", "APPROVED");

    private final RuleAdminService ruleAdminService;
    private final RuleGovernanceRepository repository;

    public RuleGovernanceService(RuleAdminService ruleAdminService,
                                 RuleGovernanceRepository repository) {
        this.ruleAdminService = ruleAdminService;
        this.repository = repository;
    }

    // ---- 参照 -------------------------------------------------------------------

    public List<RuleSummary> listRules() {
        List<RuleSummary> all = new ArrayList<>(repository.listChains());
        all.addAll(repository.listScripts());
        return all;
    }

    public Optional<RuleSummary> findRule(String targetType, String targetId) {
        return repository.findCurrent(targetType, targetId);
    }

    public List<RuleRevision> history(String targetType, String targetId) {
        return repository.listRevisions(normalise(targetType), targetId);
    }

    public List<AuditEntry> audit(int limit) {
        return repository.listAudit(limit);
    }

    // ---- 差分 -------------------------------------------------------------------

    /**
     * 2つの版の本文を行単位で突き合わせる。
     *
     * <p>{@code to} を省略すると LiteFlow 側の現行本文と比べる。履歴に無い版を指定した場合は
     * その旨を返し、黙って空の差分を返さない（「差分ゼロ＝同一」と誤読させないため）。
     */
    public RuleDiff diff(String targetType, String targetId, Long from, Long to) {
        String type = normalise(targetType);
        String left = from == null ? null
                : repository.findRevision(type, targetId, from).map(RuleRevision::body).orElse(null);
        String right;
        if (to == null) {
            right = repository.findCurrent(type, targetId).map(RuleSummary::body).orElse(null);
        } else {
            right = repository.findRevision(type, targetId, to).map(RuleRevision::body).orElse(null);
        }

        List<String> notes = new ArrayList<>();
        if (from != null && left == null) {
            notes.add("version " + from + " is not in the recorded history");
        }
        if (to != null && right == null) {
            notes.add("version " + to + " is not in the recorded history");
        }

        List<String> leftLines = split(left);
        List<String> rightLines = split(right);
        List<String> lines = new ArrayList<>();
        int max = Math.max(leftLines.size(), rightLines.size());
        int changed = 0;
        for (int i = 0; i < max; i++) {
            String a = i < leftLines.size() ? leftLines.get(i) : null;
            String b = i < rightLines.size() ? rightLines.get(i) : null;
            if (a == null) {
                lines.add("+ " + b);
                changed++;
            } else if (b == null) {
                lines.add("- " + a);
                changed++;
            } else if (!a.equals(b)) {
                lines.add("- " + a);
                lines.add("+ " + b);
                changed++;
            } else {
                lines.add("  " + a);
            }
        }
        return new RuleDiff(type, targetId, from, to, left, right, lines, changed, notes);
    }

    // ---- 発行（履歴つき） --------------------------------------------------------

    public PublishResultView publishChain(PublishChainCommand command, String actor, String comment) {
        RuleSummary before = repository.findChain(command.getChainId()).orElse(null);
        recordPreImage(CHAIN, command.getChainId(), before);
        PublishResultView result = ruleAdminService.publishChain(command);
        repository.recordRevision(CHAIN, command.getChainId(), result.getVersion(),
                command.getEl(), null, actor, comment);
        repository.audit(actor, before == null ? "CREATE_CHAIN" : "UPDATE_CHAIN", CHAIN,
                command.getChainId(), result.getVersion(),
                "operation=" + result.getOperation() + " sequence=" + result.getSequence());
        return result;
    }

    public PublishScriptResultView publishScript(PublishScriptCommand command, String actor,
                                                 String comment) {
        RuleSummary before = repository.findScript(command.getNodeId()).orElse(null);
        recordPreImage(SCRIPT, command.getNodeId(), before);
        PublishScriptResultView result = ruleAdminService.publishScript(command);
        repository.recordRevision(SCRIPT, command.getNodeId(), result.getVersion(),
                command.getScript(), attrsOf(command), actor, comment);
        repository.audit(actor, before == null ? "CREATE_SCRIPT" : "UPDATE_SCRIPT", SCRIPT,
                command.getNodeId(), result.getVersion(),
                "operation=" + result.getOperation() + " sequence=" + result.getSequence());
        return result;
    }

    /**
     * 発行の<b>直前</b>に、いま LiteFlow 側にある本文を履歴へ入れる。
     *
     * <p>これが無いと、統制層を通さずに発行された版へは二度と戻せない。
     * {@code lf_chain} は上書き保存であり、{@code lf_change_log} は本文を持たないので、
     * <b>発行した瞬間に前の本文は永久に失われる</b>。
     * 統制層の外から発行される経路は実際にある — JUnit の各テスト、{@code demo-transform.ps1}、
     * そして運用中に誰かが {@code RulePublisher} を直接使った場合である。
     *
     * <p>すでに履歴にある版なら何もしない（同じ版を二重に積まない）。
     */
    private void recordPreImage(String type, String targetId, RuleSummary before) {
        if (before == null || before.version() <= 0) {
            return;  // 新規作成。前の本文は存在しない
        }
        if (repository.findRevision(type, targetId, before.version()).isPresent()) {
            return;  // 統制層経由で発行された版。post-image として既に記録済み
        }
        repository.recordRevision(type, targetId, before.version(), before.body(),
                before.attrs(), PRE_IMAGE_ACTOR,
                "統制層の外で発行されていた版。上書きされる直前に記録した");
    }

    // ---- ロールバック ------------------------------------------------------------

    /**
     * 指定した版の本文を、現行版に対して前向きに再発行する。
     *
     * @param expectedVersion 楽観ロック。null なら現行版を自動で使う
     */
    public RollbackResult rollback(String targetType, String targetId, long toVersion,
                                   Long expectedVersion, String actor, String comment) {
        String type = normalise(targetType);
        RuleRevision source = repository.findRevision(type, targetId, toVersion)
                .orElseThrow(() -> new IllegalArgumentException(
                        "version " + toVersion + " is not in the recorded history of " + targetId));
        long current = repository.findCurrent(type, targetId)
                .map(RuleSummary::version)
                .orElseThrow(() -> new IllegalArgumentException("unknown rule: " + targetId));
        long expected = expectedVersion == null ? current : expectedVersion;
        String note = comment == null || comment.isBlank()
                ? "rollback to version " + toVersion : comment;

        long newVersion;
        if (SCRIPT.equals(type)) {
            PublishScriptCommand command = new PublishScriptCommand();
            command.setNodeId(targetId);
            command.setScript(source.body());
            command.setExpectedVersion(expected);
            applyAttrs(command, source.attrs());
            newVersion = publishScript(command, actor, note).getVersion();
        } else {
            PublishChainCommand command = new PublishChainCommand();
            command.setChainId(targetId);
            command.setEl(source.body());
            command.setExpectedVersion(expected);
            newVersion = publishChain(command, actor, note).getVersion();
        }
        repository.audit(actor, "ROLLBACK", type, targetId, newVersion,
                "restored body of version " + toVersion + " as new version " + newVersion);
        return new RollbackResult(type, targetId, toVersion, current, newVersion, source.body());
    }

    // ---- 承認フロー --------------------------------------------------------------

    public ApprovalRequest request(String targetType, String targetId, String body, String attrs,
                                   Long expectedVersion, String requestedBy, String comment) {
        String type = normalise(targetType);
        if (targetId == null || targetId.isBlank()) {
            throw new IllegalArgumentException("targetId is required");
        }
        if (body == null || body.isBlank()) {
            throw new IllegalArgumentException("body is required");
        }
        // 期待版を「申請した時点」で確定させる。
        //
        // これを承認時に読み直すと、申請から承認までの間に入った別の変更を
        // 黙って巻き戻してしまう（申請 #7 が v3 に対するものでも、承認時に v4 を読んで
        // compare-and-set が成功し、v3 相当の本文が v5 として通ってしまう）。
        // ここで固定しておけば、間に別の変更が入った場合は発行が楽観ロックで失敗し、
        // 409 として承認者に見える。
        Long lockedVersion = expectedVersion != null ? expectedVersion
                : repository.findCurrent(type, targetId).map(RuleSummary::version).orElse(0L);
        long id = repository.createApproval(type, targetId, body, attrs, lockedVersion,
                requestedBy, comment);
        repository.audit(requestedBy, "REQUEST", type, targetId, lockedVersion,
                "approval #" + id + " requested (expectedVersion=" + lockedVersion + ")");
        return repository.findApproval(id).orElseThrow();
    }

    public List<ApprovalRequest> approvals(String status) {
        return repository.listApprovals(status);
    }

    /**
     * 承認して即時に発行する。
     *
     * <p>発行に失敗した場合は {@code APPROVED} のまま残す。{@code APPLIED} との区別が
     * 「承認は下りたが反映されていない」を表に出すために要る。
     * <b>その状態からの再試行は許す</b>（許さないと発行失敗で永久に詰まる）。
     *
     * <p>期待版は<b>申請時に確定したもの</b>を使い、ここで読み直さない。読み直すと
     * 申請から承認までの間に入った別の変更を黙って巻き戻す。間に変更が入っていれば
     * 発行が楽観ロックで失敗し、{@code VersionConflictException} → 409 として見える。
     */
    public ApprovalRequest approve(long id, String actor, String note) {
        ApprovalRequest request = requireDecidable(id);
        requireDifferentActor(request, actor);
        String type = request.targetType();
        // null になるのは、この仕組みを入れる前に作られた古い行だけ。
        Long expected = request.expectedVersion() != null ? request.expectedVersion()
                : repository.findCurrent(type, request.targetId()).map(RuleSummary::version).orElse(0L);

        // 状態を条件付きで進める。0行なら他の承認者が先に決着させている。
        // これが無いと、2人が同時に承認したとき片方の APPLIED をもう片方が
        // APPROVED で上書きし、「反映済みなのに未反映」と表示される。
        if (repository.decideApprovalIfCurrentStatusIn(id, "APPROVED", actor, note, null,
                DECIDABLE_STATUSES) == 0) {
            throw new IllegalArgumentException("申請 " + id
                    + " は既に他の利用者が決着させています。一覧を読み直してください");
        }
        long newVersion;
        if (SCRIPT.equals(type)) {
            PublishScriptCommand command = new PublishScriptCommand();
            command.setNodeId(request.targetId());
            command.setScript(request.body());
            command.setExpectedVersion(expected);
            applyAttrs(command, request.attrs());
            newVersion = publishScript(command, actor, "approval #" + id).getVersion();
        } else {
            PublishChainCommand command = new PublishChainCommand();
            command.setChainId(request.targetId());
            command.setEl(request.body());
            command.setExpectedVersion(expected);
            newVersion = publishChain(command, actor, "approval #" + id).getVersion();
        }
        repository.decideApproval(id, "APPLIED", actor, note, newVersion);
        repository.audit(actor, "APPROVE", type, request.targetId(), newVersion,
                "approval #" + id + " applied");
        return repository.findApproval(id).orElseThrow();
    }

    public ApprovalRequest reject(long id, String actor, String note) {
        ApprovalRequest request = requireDecidable(id);
        if (repository.decideApprovalIfCurrentStatusIn(id, "REJECTED", actor, note, null,
                DECIDABLE_STATUSES) == 0) {
            throw new IllegalArgumentException("申請 " + id
                    + " は既に他の利用者が決着させています。一覧を読み直してください");
        }
        repository.audit(actor, "REJECT", request.targetType(), request.targetId(), null,
                "approval #" + id + " rejected");
        return repository.findApproval(id).orElseThrow();
    }

    /**
     * 申請者と承認者が別人であることを要求する。
     *
     * <p>これが承認フローを権限の境界にしている唯一の仕掛けである。詳細は
     * {@link SeparationOfDutiesException}。却下側では呼ばない（自分の申請の取り下げは許す）。
     */
    private static void requireDifferentActor(ApprovalRequest request, String actor) {
        String requester = request.requestedBy();
        if (requester != null && requester.equals(actor)) {
            throw new SeparationOfDutiesException("申請 " + request.id()
                    + " は申請者 '" + requester + "' 自身では承認できません。"
                    + "発行権限（ADMIN）と承認権限（APPROVER）を別の利用者に割り当てること");
        }
    }

    /**
     * まだ決着させられる状態か。{@code APPROVED}（承認済みだが未反映）も許す — 塞ぐと再試行できず
     * その申請が永久に詰まる。<b>競合の解決は条件付き UPDATE 側</b>で、ここは早期の弾き出しだけ。
     */
    private ApprovalRequest requireDecidable(long id) {
        ApprovalRequest request = repository.findApproval(id)
                .orElseThrow(() -> new IllegalArgumentException("unknown approval: " + id));
        if (!DECIDABLE_STATUSES.contains(request.status())) {
            throw new IllegalArgumentException(
                    "approval " + id + " is already " + request.status());
        }
        return request;
    }

    // ---- 補助 -------------------------------------------------------------------

    private static String normalise(String targetType) {
        return SCRIPT.equalsIgnoreCase(targetType) ? SCRIPT : CHAIN;
    }

    private static List<String> split(String body) {
        if (body == null || body.isEmpty()) {
            return List.of();
        }
        return List.of(body.split("\\R", -1));
    }

    /** スクリプトの付随情報を1つの文字列で持ち回る。専用テーブルを増やすほどの情報量ではない。 */
    private static String attrsOf(PublishScriptCommand command) {
        return "name=" + orEmpty(command.getName())
                + ";type=" + orEmpty(command.getType())
                + ";language=" + orEmpty(command.getLanguage());
    }

    private static void applyAttrs(PublishScriptCommand command, String attrs) {
        if (attrs == null) {
            return;
        }
        for (String pair : attrs.split(";")) {
            int eq = pair.indexOf('=');
            if (eq <= 0) {
                continue;
            }
            String key = pair.substring(0, eq);
            String value = pair.substring(eq + 1);
            if (value.isEmpty()) {
                continue;
            }
            switch (key) {
                case "name" -> command.setName(value);
                case "type" -> command.setType(value);
                case "language" -> command.setLanguage(value);
                default -> { }
            }
        }
    }

    private static String orEmpty(String value) {
        return value == null ? "" : value;
    }
}
