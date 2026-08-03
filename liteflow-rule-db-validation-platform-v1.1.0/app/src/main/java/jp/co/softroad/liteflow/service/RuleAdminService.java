package jp.co.softroad.liteflow.service;

import com.yomahub.liteflow.enums.NodeTypeEnum;
import com.yomahub.liteflow.publisher.PublishChainRequest;
import com.yomahub.liteflow.publisher.PublishResult;
import com.yomahub.liteflow.publisher.PublishScriptRequest;
import com.yomahub.liteflow.publisher.RulePublisher;
import com.yomahub.liteflow.publisher.RulePublisherFactory;
import com.yomahub.liteflow.repository.sql.SqlPublisherConfig;
import jakarta.annotation.PreDestroy;
import jp.co.softroad.liteflow.model.PublishChainCommand;
import jp.co.softroad.liteflow.model.PublishResultView;
import jp.co.softroad.liteflow.model.PublishScriptCommand;
import jp.co.softroad.liteflow.model.PublishScriptResultView;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;

@Service
public class RuleAdminService {
    private final DataSource dataSource;
    private final String applicationName;
    private volatile RulePublisher publisher;

    public RuleAdminService(DataSource dataSource,
                            @Value("${spring.application.name}") String applicationName) {
        this.dataSource = dataSource;
        this.applicationName = applicationName;
    }

    public PublishResultView publishChain(PublishChainCommand command) {
        if (command.getChainId() == null || command.getChainId().isBlank()) {
            throw new IllegalArgumentException("chainId is required");
        }
        if (command.getEl() == null || command.getEl().isBlank()) {
            throw new IllegalArgumentException("el is required");
        }

        PublishResult result = publisher().publishChain(PublishChainRequest.builder()
                .chainId(command.getChainId())
                .el(command.getEl())
                .expectedVersion(command.getExpectedVersion())
                .build());

        return new PublishResultView(
                command.getChainId(),
                result.getVersion(),
                result.getSequence(),
                String.valueOf(result.getOperation()));
    }

    /**
     * スクリプトノードのソースを Rule-DB へ格納する。Executor は chain と同じ poll/reconcile 経路で
     * 取り込むため、再デプロイなしで変換ロジックを変更できる。
     */
    public PublishScriptResultView publishScript(PublishScriptCommand command) {
        if (command.getNodeId() == null || command.getNodeId().isBlank()) {
            throw new IllegalArgumentException("nodeId is required");
        }
        if (command.getScript() == null || command.getScript().isBlank()) {
            throw new IllegalArgumentException("script is required");
        }

        PublishResult result = publisher().publishScript(PublishScriptRequest.builder()
                .nodeId(command.getNodeId())
                .script(command.getScript())
                .name(command.getName() == null ? command.getNodeId() : command.getName())
                .type(command.getType() == null ? NodeTypeEnum.SCRIPT.getCode() : command.getType())
                .language(command.getLanguage() == null ? "groovy" : command.getLanguage())
                .expectedVersion(command.getExpectedVersion())
                .build());

        return new PublishScriptResultView(
                command.getNodeId(),
                result.getVersion(),
                result.getSequence(),
                String.valueOf(result.getOperation()));
    }

    private RulePublisher publisher() {
        RulePublisher current = publisher;
        if (current == null) {
            synchronized (this) {
                current = publisher;
                if (current == null) {
                    current = RulePublisherFactory.create(SqlPublisherConfig.builder()
                            .applicationName(applicationName)
                            .dataSource(dataSource)
                            .build());
                    publisher = current;
                }
            }
        }
        return current;
    }

    @PreDestroy
    public void close() {
        RulePublisher current = publisher;
        if (current != null) {
            current.close();
        }
    }
}
