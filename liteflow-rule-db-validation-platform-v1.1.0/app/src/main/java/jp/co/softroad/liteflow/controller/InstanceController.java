package jp.co.softroad.liteflow.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class InstanceController {
    private final String instanceId;
    private final String applicationName;

    public InstanceController(@Value("${instance.id}") String instanceId,
                              @Value("${spring.application.name}") String applicationName) {
        this.instanceId = instanceId;
        this.applicationName = applicationName;
    }

    @GetMapping("/instance")
    public Map<String, Object> instance() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("instanceId", instanceId);
        result.put("applicationName", applicationName);
        result.put("time", Instant.now().toString());
        result.put("liteflowVersion", "2.16.1");
        return result;
    }
}
