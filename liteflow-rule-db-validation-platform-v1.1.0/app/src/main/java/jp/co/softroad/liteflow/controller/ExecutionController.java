package jp.co.softroad.liteflow.controller;

import com.yomahub.liteflow.core.FlowExecutor;
import com.yomahub.liteflow.flow.LiteflowResponse;
import jp.co.softroad.liteflow.model.ExecutionRequest;
import jp.co.softroad.liteflow.model.ExecutionResult;
import jp.co.softroad.liteflow.model.MigrationContext;
import jp.co.softroad.liteflow.transform.GeneratedProgramCompiler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/flows")
public class ExecutionController {
    private final FlowExecutor flowExecutor;

    public ExecutionController(FlowExecutor flowExecutor) {
        this.flowExecutor = flowExecutor;
    }

    @PostMapping("/{chainId}/execute")
    public ExecutionResult execute(@PathVariable String chainId,
                                   @RequestBody(required = false) ExecutionRequest request) {
        long started = System.nanoTime();
        MigrationContext context = new MigrationContext(UUID.randomUUID().toString());
        String payload = request == null ? null : request.getPayload();
        if (request != null) {
            context.setSourceLines(request.getSourceLines());
            context.setTemplates(request.getTemplates());
            context.setTemplateProfile(request.getTemplateProfile());
            context.setExpectations(request.getExpectations());
            context.setMaxUncoveredRate(request.getMaxUncoveredRate());
            context.setSourceFiles(request.getSourceFiles());
            context.setEntryProgram(request.getEntryProgram());
            context.setGoldenArtifacts(request.getGoldenArtifacts());
        }

        try {
            LiteflowResponse response = flowExecutor.execute2Resp(chainId, payload, context);
            String error = response.getCause() == null ? null : response.getCause().toString();
            return ExecutionResult.from(context, response.isSuccess(),
                    response.getExecuteStepStr(), error, elapsedMs(started));
        } catch (Exception e) {
            return ExecutionResult.from(context, false, null, e.toString(), elapsedMs(started));
        } finally {
            // CompileNode はクラスファイルを一時ディレクトリへ書き出す。リクエストを越えて残さない。
            GeneratedProgramCompiler.deleteRecursively(context.getWorkDir());
        }
    }

    private long elapsedMs(long started) {
        return (System.nanoTime() - started) / 1_000_000L;
    }
}
