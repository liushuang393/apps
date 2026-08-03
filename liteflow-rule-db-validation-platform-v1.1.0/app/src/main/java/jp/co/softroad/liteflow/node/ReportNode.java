package jp.co.softroad.liteflow.node;

import com.yomahub.liteflow.annotation.LiteflowComponent;

@LiteflowComponent("report")
public class ReportNode extends AbstractTraceNode {
    @Override
    public void process() {
        mark("report");
    }
}
