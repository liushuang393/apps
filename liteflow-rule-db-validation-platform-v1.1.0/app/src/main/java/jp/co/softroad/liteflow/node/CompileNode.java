package jp.co.softroad.liteflow.node;

import com.yomahub.liteflow.annotation.LiteflowComponent;
import jp.co.softroad.liteflow.model.MigrationContext;
import jp.co.softroad.liteflow.transform.CobolProgram;
import jp.co.softroad.liteflow.transform.CompileOutcome;
import jp.co.softroad.liteflow.transform.GeneratedProgramCompiler;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 生成コードを javac で実際にコンパイルする。
 *
 * <p>「生成器がテキストを出した」を「生成器がJavaを出した」に変えるのがこの工程である。
 * 構文的に誤ったものを描画するテンプレートは、出荷される前にここで落ちる。
 *
 * <p>チェーンがコードを生成しなかった場合は何もしない。Rule-DB検証が使う
 * オーケストレーション専用チェーンを通し続ける必要があるためである。
 */
@LiteflowComponent("compile")
public class CompileNode extends AbstractTraceNode {
    private static final org.slf4j.Logger LOG =
            org.slf4j.LoggerFactory.getLogger(CompileNode.class);

    @Override
    public void process() throws Exception {
        mark("compile");

        MigrationContext context = getContextBean(MigrationContext.class);
        if (!context.hasGeneratedOutput()) {
            return;
        }

        Path workDir = Files.createTempDirectory("liteflow-generated-");
        context.setWorkDir(workDir);
        Path classes = workDir.resolve("classes");

        List<CobolProgram> programs = context.getPrograms();
        if (!programs.isEmpty()) {
            context.setCompileOutcome(compilePrograms(context, programs, classes));
            return;
        }

        Map<String, List<String>> artifacts = context.getGeneratedArtifacts();
        if (!artifacts.isEmpty()) {
            // ここで例外を投げると品質ゲートまで届かず NOT_EVALUATED のまま終わり、
            // 何が悪かったのかレポートに残らない。失敗はコンパイル結果として報告する。
            CompileOutcome outcome;
            try {
                outcome = compileArtifacts(artifacts, classes);
            } catch (RuntimeException e) {
                outcome = new CompileOutcome();
                outcome.setAttempted(true);
                outcome.setCompilerAvailable(true);
                outcome.setSuccess(false);
                outcome.setFailureReason("compile setup failed: " + e);
            }
            context.setCompileOutcome(outcome);
            return;
        }

        CompileOutcome outcome =
                GeneratedProgramCompiler.compile(context.getGeneratedLines(), classes);
        context.setCompileOutcome(outcome);
    }

    /** 段落構造を持つ複数プログラム。共有ランタイムと一緒に1回の javac へ渡す。 */
    private CompileOutcome compilePrograms(MigrationContext context, List<CobolProgram> programs,
                                           Path classes) {
        Map<String, String> sources = new LinkedHashMap<>();
        sources.put(GeneratedProgramCompiler.RUNTIME_CLASS_NAME,
                GeneratedProgramCompiler.buildRuntimeSource());
        for (CobolProgram program : programs) {
            sources.put(program.getClassName(), GeneratedProgramCompiler.buildProgramSource(program));
        }
        context.setEntryClassName(resolveEntryClass(context, programs));
        return GeneratedProgramCompiler.compileUnits(sources, classes, List.of());
    }

    /**
     * 名前付き成果物のうち {@code .java} だけをコンパイルする。
     * Spring Boot 生成物のように外部依存が要るものは
     * {@code TRANSFORM_EXTRA_CLASSPATH} で指定したディレクトリをクラスパスへ足す。
     */
    private CompileOutcome compileArtifacts(Map<String, List<String>> artifacts, Path classes) {
        Map<String, String> sources = new LinkedHashMap<>();
        artifacts.forEach((name, lines) -> {
            if (name.endsWith(".java")) {
                String simpleName = name.substring(0, name.length() - ".java".length());
                sources.put(GeneratedProgramCompiler.PACKAGE + "." + simpleName,
                        String.join("\n", lines));
            }
        });
        if (sources.isEmpty()) {
            CompileOutcome outcome = new CompileOutcome();
            outcome.setAttempted(false);
            outcome.setCompilerAvailable(true);
            outcome.setSuccess(true);
            outcome.setClassName("(no java artifact)");
            outcome.setSource(artifacts.entrySet().stream()
                    .map(e -> "// ==== " + e.getKey() + "\n" + String.join("\n", e.getValue()))
                    .collect(Collectors.joining("\n\n")));
            return outcome;
        }
        return GeneratedProgramCompiler.compileUnits(sources, classes, extraClasspath());
    }

    /**
     * 追加クラスパス。Dockerイメージでは {@code /app/boot41-libs} に Spring Boot 4.1 の
     * 依存jarを実レイヤとして置いてある（BuildKitのキャッシュマウントはイメージに残らないため、
     * {@code dependency:copy-dependencies} + {@code COPY --from=build} で入れている）。
     *
     * <p><b>ワイルドカード（{@code dir/*}）は使えない。</b> あれを展開するのは
     * java / javac のランチャであって、ここで使っている in-process の
     * {@code StandardJavaFileManager} は展開しない。ディレクトリを渡されたら
     * jar を1つずつ並べること。
     */
    private List<String> extraClasspath() {
        String configured = System.getenv("TRANSFORM_EXTRA_CLASSPATH");
        if (configured == null || configured.isBlank()) {
            return List.of();
        }
        List<String> entries = new ArrayList<>();
        for (String part : configured.split(java.io.File.pathSeparator)) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            Path path;
            try {
                path = Path.of(trimmed);
            } catch (RuntimeException e) {
                continue;
            }
            if (Files.isDirectory(path)) {
                try (Stream<Path> jars = Files.list(path)) {
                    jars.filter(jar -> jar.getFileName().toString().endsWith(".jar"))
                            .sorted()
                            .forEach(jar -> entries.add(jar.toString()));
                } catch (IOException e) {
                    LOG.warn("追加クラスパスのディレクトリを読めません: {}", path, e);
                }
            } else {
                entries.add(trimmed);
            }
        }
        return entries;
    }

    private String resolveEntryClass(MigrationContext context, List<CobolProgram> programs) {
        String wanted = context.getEntryProgram();
        if (wanted != null && !wanted.isBlank()) {
            for (CobolProgram program : programs) {
                if (wanted.equalsIgnoreCase(program.getProgramId())) {
                    return program.getClassName();
                }
            }
        }
        return programs.get(0).getClassName();
    }
}
