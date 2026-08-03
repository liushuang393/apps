package jp.co.softroad.liteflow.model;

public class PublishResultView {
    private final String chainId;
    private final long version;
    private final long sequence;
    private final String operation;

    public PublishResultView(String chainId, long version, long sequence, String operation) {
        this.chainId = chainId;
        this.version = version;
        this.sequence = sequence;
        this.operation = operation;
    }

    public String getChainId() {
        return chainId;
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
