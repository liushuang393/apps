package jp.co.softroad.liteflow.model;

public class PublishChainCommand {
    private String chainId;
    private String el;
    private Long expectedVersion;
    /** 履歴に残す変更理由。ルール管理基盤が rm_rule_revision へ記録する。 */
    private String comment;

    public String getChainId() {
        return chainId;
    }

    public void setChainId(String chainId) {
        this.chainId = chainId;
    }

    public String getEl() {
        return el;
    }

    public void setEl(String el) {
        this.el = el;
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
