package jp.co.softroad.liteflow.governance;

/** 監査ログ1件。誰が・いつ・何に対して・どの操作をしたか。 */
public record AuditEntry(long id, String actor, String action, String targetType,
                         String targetId, Long version, String detail, String createdAt) {
}
