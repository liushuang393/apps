package jp.co.softroad.liteflow.model;

public class PublishScriptResultView {
    private final String nodeId;
    private final long version;
    private final long sequence;
    private final String operation;

    public PublishScriptResultView(String nodeId, long version, long sequence, String operation) {
        this.nodeId = nodeId;
        this.version = version;
        this.sequence = sequence;
        this.operation = operation;
    }

    public String getNodeId() {
        return nodeId;
    }

    public long getVersion() {
        return version;
    }

    public long getSequence() {
        return sequence;
    }

    public String getOperation() {
        return operation;
    }
}
