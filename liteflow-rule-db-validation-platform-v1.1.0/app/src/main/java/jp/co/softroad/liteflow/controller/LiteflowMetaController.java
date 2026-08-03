package jp.co.softroad.liteflow.controller;

import com.yomahub.liteflow.metrics.LiteflowMetaView;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * LiteFlow 本体の {@code /actuator/liteflow} エンドポイントと同じパス・同じ応答内容を提供する。
 * 本体のエンドポイントは Spring Boot 4 / Spring Framework 7 では登録できない
 * （理由は {@link jp.co.softroad.liteflow.config.LiteflowMetricsConfig} を参照）。
 *
 * <p>データはすべて上流エンドポイントと同じ {@link LiteflowMetaView} から取得するため応答は同一で、
 * 違うのはディスパッチ機構だけである（actuatorのエンドポイント基盤ではなく Spring MVC を使う）。
 */
@RestController
@RequestMapping("/actuator/liteflow")
public class LiteflowMetaController {
    private final LiteflowMetaView metaView;

    public LiteflowMetaController(LiteflowMetaView metaView) {
        this.metaView = metaView;
    }

    @GetMapping
    public Map<String, Object> overview() {
        return metaView.overview();
    }

    @GetMapping("/{level}")
    public Object level(@PathVariable String level) {
        return switch (level) {
            case "chains" -> metaView.chains();
            case "nodes" -> metaView.nodes();
            case "ruledb" -> metaView.ruleDb();
            default -> metaView.error("unknown selector: " + level);
        };
    }

    @GetMapping("/{level}/{id}")
    public Map<String, Object> detail(@PathVariable String level, @PathVariable String id) {
        return switch (level) {
            case "chains" -> metaView.chain(id);
            case "nodes" -> metaView.node(id);
            default -> metaView.error("unknown selector: " + level);
        };
    }
}
