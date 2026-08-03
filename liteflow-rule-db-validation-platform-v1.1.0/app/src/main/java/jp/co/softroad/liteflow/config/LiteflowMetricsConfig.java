package jp.co.softroad.liteflow.config;

import com.yomahub.liteflow.metrics.ChainMetricsLifeCycle;
import com.yomahub.liteflow.metrics.LiteflowMetaView;
import com.yomahub.liteflow.metrics.LiteflowMeterBinder;
import com.yomahub.liteflow.metrics.NodeMetricsLifeCycle;
import com.yomahub.liteflow.property.LiteflowConfig;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * application.properties で除外している
 * {@code com.yomahub.liteflow.springboot4.metrics.LiteflowMetricsAutoConfiguration} の代替。
 *
 * <p>除外理由: この自動設定は {@code LiteflowEndpoint} も登録する。これは読み取り操作が
 * {@code @Selector} 引数を取る actuator の {@code @Endpoint} である。公開されている
 * liteflow-spring-boot4-starter:2.16.1 のjarは {@code -parameters} 無しでコンパイルされており、
 * さらに Spring Framework 7 は {@code LocalVariableTableParameterNameDiscoverer} を削除したため、
 * 引数名を解決できない。その結果、以下のエラーでコンテキストが起動しない。
 *
 * <pre>
 * Failed to extract parameter names for
 * public java.lang.Object com.yomahub.liteflow.springboot4.metrics.LiteflowEndpoint.chains(java.lang.String)
 * </pre>
 *
 * <p>そのエンドポイント以外はここで元のまま再登録するため、Prometheusメトリクス
 * （liteflow.chain.executions / liteflow.node.executions / liteflow.slot.size / liteflow.slot.occupied）
 * は影響を受けない。エンドポイント自体は
 * {@link jp.co.softroad.liteflow.controller.LiteflowMetaController} が代替し、
 * 同じパス・同じ応答内容を提供する。
 *
 * <p>上流が {@code -parameters} 付きでjarを再公開したら、このクラスは削除してよい。
 */
@Configuration(proxyBeanMethods = false)
public class LiteflowMetricsConfig {

    @Bean
    public LiteflowMeterBinder liteflowMeterBinder(LiteflowConfig liteflowConfig) {
        return new LiteflowMeterBinder(liteflowConfig);
    }

    @Bean
    public ChainMetricsLifeCycle chainMetricsLifeCycle(MeterRegistry meterRegistry) {
        return new ChainMetricsLifeCycle(meterRegistry);
    }

    @Bean
    public NodeMetricsLifeCycle nodeMetricsLifeCycle(MeterRegistry meterRegistry) {
        return new NodeMetricsLifeCycle(meterRegistry);
    }

    @Bean
    public LiteflowMetaView liteflowMetaView(MeterRegistry meterRegistry) {
        return new LiteflowMetaView(meterRegistry);
    }
}
