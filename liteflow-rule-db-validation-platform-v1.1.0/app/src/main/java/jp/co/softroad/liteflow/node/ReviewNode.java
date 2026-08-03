package jp.co.softroad.liteflow.node;

import com.yomahub.liteflow.annotation.LiteflowComponent;

@LiteflowComponent("review")
public class ReviewNode extends AbstractTraceNode {
    @Override
    public void process() {
        mark("review");
    }
}
