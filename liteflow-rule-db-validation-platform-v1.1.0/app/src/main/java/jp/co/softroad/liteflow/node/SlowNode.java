package jp.co.softroad.liteflow.node;

import com.yomahub.liteflow.annotation.LiteflowComponent;

@LiteflowComponent("slow")
public class SlowNode extends AbstractTraceNode {
    @Override
    public void process() throws Exception {
        mark("slow");
        Thread.sleep(30L);
    }
}
