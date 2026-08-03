package jp.co.softroad.liteflow.node;

import com.yomahub.liteflow.core.NodeComponent;
import jp.co.softroad.liteflow.model.MigrationContext;

public abstract class AbstractTraceNode extends NodeComponent {
    protected void mark(String step) {
        MigrationContext context = getContextBean(MigrationContext.class);
        context.addStep(step);
    }
}
