package jp.co.softroad.liteflow.governance;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Types;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * ルール管理基盤（シナリオ#3）の永続化。
 *
 * <p><b>LiteFlow は履歴を持たない。</b> {@code lf_chain} / {@code lf_script} は
 * 発行のたびに本文を上書きし、{@code lf_change_log} はペイロードを持たない。
 * そのため履歴・差分・ロールバック・承認・監査はここで自前に持つ。
 *
 * <p>読み取りだけは LiteFlow のテーブルを直接見る（現行版の取得）。
 * <b>書き込みは絶対にここから行わない。</b> 書き込みは {@code RulePublisher} を通さないと
 * {@code lf_change_lock} の直列化と {@code lf_change_log} の採番を飛ばしてしまい、
 * 各 Executor が変更に気づけなくなる。
 */
@Repository
public class RuleGovernanceRepository {
    /** LiteFlow 側のテーブル接頭辞。{@code liteflow.rule-db.sql.table-prefix} の既定値。 */
    private static final String LF = "lf_";

    private final JdbcTemplate jdbc;
    private final String applicationName;

    public RuleGovernanceRepository(JdbcTemplate jdbc,
                                    @Value("${spring.application.name}") String applicationName) {
        this.jdbc = jdbc;
        this.applicationName = applicationName;
    }

    public String getApplicationName() {
        return applicationName;
    }

    // ---- LiteFlow 側の現行状態（読み取り専用） ---------------------------------

    private static final RowMapper<RuleSummary> CHAIN_MAPPER = (rs, i) -> new RuleSummary(
            "CHAIN", rs.getString("chain_id"), rs.getLong("version"),
            rs.getString("el_data"), null, rs.getInt("enable") == 1,
            String.valueOf(rs.getTimestamp("gmt_modified")));

    private static final RowMapper<RuleSummary> SCRIPT_MAPPER = (rs, i) -> new RuleSummary(
            "SCRIPT", rs.getString("node_id"), rs.getLong("version"),
            rs.getString("script_data"),
            rs.getString("script_language") + "/" + rs.getString("script_type"),
            rs.getInt("enable") == 1,
            String.valueOf(rs.getTimestamp("gmt_modified")));

    public List<RuleSummary> listChains() {
        return jdbc.query("SELECT chain_id, el_data, version, enable, gmt_modified FROM " + LF
                + "chain WHERE application_name = ? ORDER BY chain_id", CHAIN_MAPPER, applicationName);
    }

    public List<RuleSummary> listScripts() {
        return jdbc.query("SELECT node_id, script_data, script_language, script_type, version, enable,"
                + " gmt_modified FROM " + LF + "script WHERE application_name = ? ORDER BY node_id",
                SCRIPT_MAPPER, applicationName);
    }

    public Optional<RuleSummary> findChain(String chainId) {
        return jdbc.query("SELECT chain_id, el_data, version, enable, gmt_modified FROM " + LF
                        + "chain WHERE application_name = ? AND chain_id = ?",
                CHAIN_MAPPER, applicationName, chainId).stream().findFirst();
    }

    public Optional<RuleSummary> findScript(String nodeId) {
        return jdbc.query("SELECT node_id, script_data, script_language, script_type, version, enable,"
                        + " gmt_modified FROM " + LF + "script WHERE application_name = ? AND node_id = ?",
                SCRIPT_MAPPER, applicationName, nodeId).stream().findFirst();
    }

    public Optional<RuleSummary> findCurrent(String targetType, String targetId) {
        return "SCRIPT".equalsIgnoreCase(targetType) ? findScript(targetId) : findChain(targetId);
    }

    // ---- 履歴 -------------------------------------------------------------------

    private static final RowMapper<RuleRevision> REVISION_MAPPER = (rs, i) -> new RuleRevision(
            rs.getLong("id"), rs.getString("target_type"), rs.getString("target_id"),
            rs.getLong("version"), rs.getString("body"), rs.getString("attrs"),
            rs.getString("actor"), rs.getString("comment_text"),
            String.valueOf(rs.getTimestamp("created_at")));

    public void recordRevision(String targetType, String targetId, long version, String body,
                               String attrs, String actor, String comment) {
        jdbc.update("INSERT INTO rm_rule_revision (application_name, target_type, target_id, version,"
                        + " body, attrs, content_md5, actor, comment_text) VALUES (?,?,?,?,?,?,?,?,?)",
                applicationName, targetType, targetId, version, body, attrs,
                md5(body), actor, trim(comment, 512));
    }

    public List<RuleRevision> listRevisions(String targetType, String targetId) {
        return jdbc.query("SELECT id, target_type, target_id, version, body, attrs, actor, comment_text,"
                        + " created_at FROM rm_rule_revision WHERE application_name = ?"
                        + " AND target_type = ? AND target_id = ? ORDER BY version, id",
                REVISION_MAPPER, applicationName, targetType, targetId);
    }

    public Optional<RuleRevision> findRevision(String targetType, String targetId, long version) {
        return jdbc.query("SELECT id, target_type, target_id, version, body, attrs, actor, comment_text,"
                        + " created_at FROM rm_rule_revision WHERE application_name = ?"
                        + " AND target_type = ? AND target_id = ? AND version = ? ORDER BY id DESC",
                REVISION_MAPPER, applicationName, targetType, targetId, version).stream().findFirst();
    }

    // ---- 承認 -------------------------------------------------------------------

    private static final RowMapper<ApprovalRequest> APPROVAL_MAPPER = (rs, i) -> new ApprovalRequest(
            rs.getLong("id"), rs.getString("target_type"), rs.getString("target_id"),
            rs.getString("body"), rs.getString("attrs"),
            (Long) rs.getObject("expected_version"), (Long) rs.getObject("applied_version"),
            rs.getString("status"), rs.getString("requested_by"), rs.getString("decided_by"),
            rs.getString("comment_text"), rs.getString("decision_note"),
            String.valueOf(rs.getTimestamp("requested_at")),
            rs.getTimestamp("decided_at") == null ? null : String.valueOf(rs.getTimestamp("decided_at")));

    private static final String APPROVAL_COLUMNS =
            "id, target_type, target_id, body, attrs, expected_version, applied_version, status,"
                    + " requested_by, decided_by, comment_text, decision_note, requested_at, decided_at";

    /**
     * 変更申請を1件作る。
     *
     * <p><b>採番はJDBCの生成キーで受け取る。</b> かつては INSERT のあとに
     * {@code SELECT MAX(id) WHERE application_name = ?} を別文で撃っていた。
     * トランザクションが無いので両方が個別にコミットされ、同時に2件の申請が来ると
     * <b>先に INSERT した側が後から INSERT された側のidを受け取る</b>。
     * 申請者は他人の申請のidと本文を返され、承認者はそのidを承認して
     * <b>意図しない変更を反映してしまう</b>。生成キーなら自分が挿入した行のidが確実に返る。
     */
    public long createApproval(String targetType, String targetId, String body, String attrs,
                               Long expectedVersion, String requestedBy, String comment) {
        String sql = "INSERT INTO rm_approval (application_name, target_type, target_id, body, attrs,"
                + " expected_version, status, requested_by, comment_text)"
                + " VALUES (?,?,?,?,?,?,'PENDING',?,?)";
        String trimmedComment = trim(comment, 512);
        KeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(sql, new String[] {"id"});
            statement.setString(1, applicationName);
            statement.setString(2, targetType);
            statement.setString(3, targetId);
            statement.setString(4, body);
            statement.setString(5, attrs);
            if (expectedVersion == null) {
                statement.setNull(6, Types.BIGINT);
            } else {
                statement.setLong(6, expectedVersion);
            }
            statement.setString(7, requestedBy);
            statement.setString(8, trimmedComment);
            return statement;
        }, keys);
        Number key = singleKey(keys);
        if (key == null) {
            throw new IllegalStateException(
                    "変更申請のidを採番できませんでした。生成キーが返っていません");
        }
        return key.longValue();
    }

    /** 生成キーを1つ取り出す。ドライバによってキー列が複数返ることがあるため素直に取らない。 */
    private static Number singleKey(KeyHolder keys) {
        List<Map<String, Object>> rows = keys.getKeyList();
        if (rows.size() == 1) {
            for (Object value : rows.get(0).values()) {
                if (value instanceof Number number) {
                    return number;
                }
            }
        }
        return keys.getKey();
    }

    public List<ApprovalRequest> listApprovals(String status) {
        if (status == null || status.isBlank()) {
            return jdbc.query("SELECT " + APPROVAL_COLUMNS + " FROM rm_approval"
                    + " WHERE application_name = ? ORDER BY id DESC", APPROVAL_MAPPER, applicationName);
        }
        return jdbc.query("SELECT " + APPROVAL_COLUMNS + " FROM rm_approval"
                        + " WHERE application_name = ? AND status = ? ORDER BY id DESC",
                APPROVAL_MAPPER, applicationName, status);
    }

    public Optional<ApprovalRequest> findApproval(long id) {
        return jdbc.query("SELECT " + APPROVAL_COLUMNS + " FROM rm_approval"
                        + " WHERE application_name = ? AND id = ?", APPROVAL_MAPPER, applicationName, id)
                .stream().findFirst();
    }

    public void decideApproval(long id, String status, String decidedBy, String note,
                               Long appliedVersion) {
        jdbc.update("UPDATE rm_approval SET status = ?, decided_by = ?, decision_note = ?,"
                        + " applied_version = ?, decided_at = CURRENT_TIMESTAMP"
                        + " WHERE application_name = ? AND id = ?",
                status, decidedBy, trim(note, 512), appliedVersion, applicationName, id);
    }

    /**
     * 申請を<b>条件付きで</b>次の状態へ進める。いま許容された状態にある場合だけ更新する。
     *
     * <p>これが無いと承認は check-then-act になる。2人の承認者が同じ申請の {@code PENDING} を
     * 見て両方が承認へ進み、片方が {@code APPLIED} と書いた直後にもう片方が
     * {@code APPROVED} で上書きして、<b>変更は反映済みなのに「未反映」と表示される</b>。
     *
     * <p>状態の語彙は変えていない。{@code APPROVED} は今も
     * 「承認は下りたが反映されていない」を表す。発行に失敗したときはこの状態で残り、
     * {@code APPROVED} からの再試行を許容範囲に含めることで<b>永久に詰まらない</b>ようにしている
     * （二重発行そのものは LiteFlow 側の楽観ロックが弾く）。
     *
     * @param allowedFrom 更新を許す現在の状態
     * @return 更新した行数。0 なら誰かが先に決着させている
     */
    public int decideApprovalIfCurrentStatusIn(long id, String status, String decidedBy, String note,
                                               Long appliedVersion, List<String> allowedFrom) {
        if (allowedFrom == null || allowedFrom.isEmpty()) {
            throw new IllegalArgumentException("allowedFrom を空にしてはいけません");
        }
        String placeholders = String.join(",", allowedFrom.stream().map(entry -> "?").toList());
        List<Object> args = new ArrayList<>();
        args.add(status);
        args.add(decidedBy);
        args.add(trim(note, 512));
        args.add(appliedVersion);
        args.add(applicationName);
        args.add(id);
        args.addAll(allowedFrom);
        return jdbc.update("UPDATE rm_approval SET status = ?, decided_by = ?, decision_note = ?,"
                        + " applied_version = ?, decided_at = CURRENT_TIMESTAMP"
                        + " WHERE application_name = ? AND id = ? AND status IN (" + placeholders + ")",
                args.toArray());
    }

    // ---- 監査 -------------------------------------------------------------------

    private static final RowMapper<AuditEntry> AUDIT_MAPPER = (rs, i) -> new AuditEntry(
            rs.getLong("id"), rs.getString("actor"), rs.getString("action"),
            rs.getString("target_type"), rs.getString("target_id"),
            (Long) rs.getObject("version"), rs.getString("detail"),
            String.valueOf(rs.getTimestamp("created_at")));

    public void audit(String actor, String action, String targetType, String targetId,
                      Long version, String detail) {
        jdbc.update("INSERT INTO rm_audit (application_name, actor, action, target_type, target_id,"
                        + " version, detail) VALUES (?,?,?,?,?,?,?)",
                applicationName, actor, action, targetType, targetId, version, trim(detail, 1024));
    }

    public List<AuditEntry> listAudit(int limit) {
        return jdbc.query("SELECT id, actor, action, target_type, target_id, version, detail, created_at"
                        + " FROM rm_audit WHERE application_name = ? ORDER BY id DESC LIMIT ?",
                AUDIT_MAPPER, applicationName, Math.max(1, Math.min(limit, 500)));
    }

    // ---- 補助 -------------------------------------------------------------------

    private static String trim(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max);
    }

    private static String md5(String body) {
        if (body == null) {
            return null;
        }
        try {
            byte[] digest = java.security.MessageDigest.getInstance("MD5")
                    .digest(body.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            return null;
        }
    }
}
