package jp.co.softroad.liteflow.model;

/**
 * ロールバック要求。
 *
 * @see jp.co.softroad.liteflow.governance.RollbackResult 版は戻らず前向きに進む点に注意
 */
public class RollbackCommand {
    /** 本文を取り出す版。履歴（rm_rule_revision）に存在する必要がある。 */
    private Long toVersion;
    /** 楽観ロック。省略すると現行版を自動で使う。 */
    private Long expectedVersion;
    private String comment;

    public Long getToVersion() {
        return toVersion;
    }

    public void setToVersion(Long toVersion) {
        this.toVersion = toVersion;
    }

    public Long getExpectedVersion() {
        return expectedVersion;
    }

    public void setExpectedVersion(Long expectedVersion) {
        this.expectedVersion = expectedVersion;
    }

    public String getComment() {
        return comment;
    }

    public void setComment(String comment) {
        this.comment = comment;
    }
}
