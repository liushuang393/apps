package jp.co.softroad.liteflow.model;

/** 変更申請。承認されるまで LiteFlow へは一切発行されない。 */
public class ApprovalRequestCommand {
    /** {@code CHAIN} または {@code SCRIPT}。省略時は CHAIN。 */
    private String targetType;
    private String targetId;
    /** chain なら EL、script ならスクリプト本文。 */
    private String body;
    /** script の付随情報。{@code name=..;type=..;language=..} 形式。 */
    private String attrs;
    /** 楽観ロック。省略すると承認時点の現行版を使う。 */
    private Long expectedVersion;
    private String comment;

    public String getTargetType() {
        return targetType;
    }

    public void setTargetType(String targetType) {
        this.targetType = targetType;
    }

    public String getTargetId() {
        return targetId;
    }

    public void setTargetId(String targetId) {
        this.targetId = targetId;
    }

    public String getBody() {
        return body;
    }

    public void setBody(String body) {
        this.body = body;
    }

    public String getAttrs() {
        return attrs;
    }

    public void setAttrs(String attrs) {
        this.attrs = attrs;
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
