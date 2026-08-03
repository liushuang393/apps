package jp.co.softroad.liteflow.governance;

/**
 * 変更申請1件。
 *
 * <p>状態は {@code PENDING} → {@code APPLIED}（承認して実際に発行できた）
 * または {@code REJECTED}（却下）。承認したが発行に失敗した場合は {@code APPROVED} で止まる
 * ので、「承認済みだが未反映」がレポート上で判別できる。
 */
public record ApprovalRequest(long id, String targetType, String targetId, String body,
                              String attrs, Long expectedVersion, Long appliedVersion,
                              String status, String requestedBy, String decidedBy,
                              String comment, String decisionNote,
                              String requestedAt, String decidedAt) {
}
