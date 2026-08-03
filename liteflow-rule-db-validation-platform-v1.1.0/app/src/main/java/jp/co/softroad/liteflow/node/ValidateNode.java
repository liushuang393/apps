package jp.co.softroad.liteflow.node;

import com.yomahub.liteflow.annotation.LiteflowComponent;

@LiteflowComponent("validate")
public class ValidateNode extends AbstractTraceNode {
    @Override
    public void process() {
        mark("validate");
    }
}
