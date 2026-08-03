package jp.co.softroad.liteflow.model;

/**
 * スクリプトノードを Rule-DB へ公開するためのリクエストボディ。
 *
 * <p>ノードの順序だけでなく変換ロジックそのものを設定の管理下に置くための仕組みである。
 * スクリプト本文はデータベースに格納され、通常の poll/reconcile サイクルで
 * 全 Executor が再デプロイなしに取り込む。
 */
public class PublishScriptCommand {
    private String nodeId;
    private String script;
    private String name;
    /** LiteFlowのスクリプトノード種別コード。既定は {@code script}（通常のスクリプトノード）。 */
    private String type;
    /** スクリプト言語。例: {@code groovy}。 */
    private String language;
    private Long expectedVersion;
    /** 履歴に残す変更理由。ルール管理基盤が rm_rule_revision へ記録する。 */
    private String comment;

    public String getNodeId() {
        return nodeId;
    }

    public void setNodeId(String nodeId) {
        this.nodeId = nodeId;
    }

    public String getScript() {
        return script;
    }

    public void setScript(String script) {
        this.script = script;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getLanguage() {
        return language;
    }

    public void setLanguage(String language) {
        this.language = language;
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
