package jp.co.softroad.liteflow.node;

import com.yomahub.liteflow.annotation.LiteflowComponent;

@LiteflowComponent("forcedFailure")
public class ForcedFailureNode extends AbstractTraceNode {
    @Override
    public void process() {
        mark("forcedFailure");
        throw new IllegalStateException("intentional validation failure");
    }
}
