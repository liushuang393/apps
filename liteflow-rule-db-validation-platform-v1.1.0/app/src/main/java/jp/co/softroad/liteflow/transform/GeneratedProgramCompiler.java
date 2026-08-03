package jp.co.softroad.liteflow.transform;

import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.StandardLocation;
import javax.tools.ToolProvider;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 生成された文を実行可能なクラスで包み、javac で実際にコンパイルする。
 *
 * <p>ラッパはCOBOLデータ項目を {@code Map<String,Object>} で保持するため、DATA DIVISION の
 * 翻訳はまだ不要である。テンプレートはこの取り決めに従って {@code vars.put(...)} /
 * {@code num(...)} / {@code out.add(...)} を出力する（{@code templates/compilable-v1.json} 参照）。
 *
 * <p>実行時にJDKが必要。JREでは {@code ToolProvider.getSystemJavaCompiler()} が null を返す。
 * 実行イメージを {@code eclipse-temurin:17-jdk} にしているのはこのためである。
 * コンパイラが無い場合は例外を投げず {@code compilerAvailable=false} を報告する。
 */
public final class GeneratedProgramCompiler {
    public static final String PACKAGE = "generated";
    public static final String SIMPLE_NAME = "GeneratedProgram";
    public static final String CLASS_NAME = PACKAGE + "." + SIMPLE_NAME;
    /** 複数プログラム方式で全プログラムが共有する実行時クラス。 */
    public static final String RUNTIME_CLASS_NAME = PACKAGE + ".CobolRuntime";

    /** 生成クラスが共通で持つ数値変換ヘルパ。平坦方式と段落方式で同一の本文を使う。 */
    private static final String NUM_HELPER =
            "    static double num(Object value) {\n"
                    + "        if (value == null) { return 0d; }\n"
                    + "        if (value instanceof Number number) { return number.doubleValue(); }\n"
                    + "        String text = String.valueOf(value).trim();\n"
                    + "        if (text.isEmpty()) { return 0d; }\n"
                    + "        return Double.parseDouble(text);\n"
                    + "    }\n";

    private GeneratedProgramCompiler() {
    }

    public static String buildSource(List<String> statements) {
        StringBuilder sb = new StringBuilder();
        sb.append("package ").append(PACKAGE).append(";\n\n")
                .append("import java.util.List;\n")
                .append("import java.util.Map;\n\n")
                .append("public final class ").append(SIMPLE_NAME).append(" {\n")
                .append("    public static Map<String, Object> run(Map<String, Object> vars, List<String> out) {\n");
        for (String statement : statements) {
            if (statement != null && !statement.isBlank()) {
                sb.append("        ").append(statement).append('\n');
            }
        }
        sb.append("        return vars;\n")
                .append("    }\n\n")
                .append(NUM_HELPER)
                .append("}\n");
        return sb.toString();
    }

    /**
     * 全プログラムが共有する実行時クラス。
     *
     * <p>STOP RUN / GOBACK / 範囲外 GO TO の3つの信号と、暴走検出の歩数計をここに置く。
     * <b>各プログラムの入れ子クラスにしてはいけない</b> — MAIN が SUB を CALL したとき、
     * {@code SUB.StopRun} と {@code MAIN.StopRun} は別クラスになり、SUB の STOP RUN を
     * MAIN が捕捉できなくなる。歩数計も同じ理由で共有していないと、
     * MAIN と SUB をまたぐ暴走ループを検出できない。
     *
     * <p>{@code steps} は static だが、実行ごとに新しい {@code URLClassLoader} で読み込まれるため
     * リクエスト間で混ざらない。
     */
    public static String buildRuntimeSource() {
        return """
                package generated;

                public final class CobolRuntime {
                    private CobolRuntime() { }

                    /** STOP RUN。実行全体を終了する。runAsMain だけが捕捉する。 */
                    public static final class StopRun extends RuntimeException {
                        public StopRun() { super(null, null, false, false); }
                    }

                    /** GOBACK。呼び出し元へ戻る。各プログラムの run() が捕捉する。 */
                    public static final class Goback extends RuntimeException {
                        public Goback() { super(null, null, false, false); }
                    }

                    /** 実行中の PERFORM 範囲の外へ飛ぶ GO TO。目標を含む外側の範囲まで解いていく。 */
                    public static final class GoTo extends RuntimeException {
                        public final String target;
                        public GoTo(String target) { super(null, null, false, false); this.target = target; }
                    }

                    private static final int MAX_STEPS = 2000000;
                    private static int steps;

                    public static void resetSteps() { steps = 0; }

                    public static void step() {
                        if (++steps > MAX_STEPS) {
                            throw new IllegalStateException(
                                    "runaway execution: exceeded " + MAX_STEPS + " paragraph activations");
                        }
                    }
                }
                """;
    }

    /**
     * 段落構造を持つ1本のプログラムをJavaクラスへ落とす。
     *
     * <p>段落は「ラベル配列 + ディスパッチャ」で表現する。これでないと GO TO と
     * PERFORM THRU を同時に正しく扱えない。段落メソッドは {@code null}（次の段落へ落ちる）か
     * 飛び先ラベルを返す。
     *
     * <p>段落本体を {@code if (true) { ... }} で包むのは意図的である。COBOLの段落は
     * 末尾が {@code GO TO}（= {@code return "LABEL";}）になることが普通で、素直に書くと
     * 直後の {@code return null;} が「到達不能」で javac エラーになる。JLS 14.21 は
     * {@code if} の条件値を到達可能性の判定に使わないと明記しているため、この包みで回避できる。
     */
    public static String buildProgramSource(CobolProgram program) {
        String simpleName = program.getSimpleName();
        List<String> labels = new ArrayList<>(program.getParagraphs().keySet());
        labels.add("__END");

        StringBuilder sb = new StringBuilder();
        sb.append("package ").append(PACKAGE).append(";\n\n")
                .append("import java.util.LinkedHashMap;\n")
                .append("import java.util.List;\n")
                .append("import java.util.Map;\n\n")
                .append("public final class ").append(simpleName).append(" {\n")
                .append("    private static final String[] PARAS = {")
                .append(labels.stream().map(GeneratedProgramCompiler::javaString)
                        .collect(Collectors.joining(", ")))
                .append("};\n")
                .append("    private static final String[] LINKAGE = {")
                .append(program.getLinkage().stream().map(GeneratedProgramCompiler::javaString)
                        .collect(Collectors.joining(", ")))
                .append("};\n\n");

        sb.append("    /** 実行の入口。STOP RUN をここで受け止める。 */\n")
                .append("    public static Map<String, Object> runAsMain(Map<String, Object> vars, List<String> out) {\n")
                .append("        CobolRuntime.resetSteps();\n")
                .append("        try { run(vars, out); } catch (CobolRuntime.StopRun ignored) { }\n")
                .append("        return vars;\n")
                .append("    }\n\n");

        sb.append("    /** プログラム本体。GOBACK は捕捉し、STOP RUN は素通しする。 */\n")
                .append("    public static Map<String, Object> run(Map<String, Object> vars, List<String> out) {\n")
                .append("        initWorkingStorage(vars);\n")
                .append("        try { perform(vars, out, PARAS[0], PARAS[PARAS.length - 1]); }\n")
                .append("        catch (CobolRuntime.Goback ignored) { }\n")
                .append("        return vars;\n")
                .append("    }\n\n");

        sb.append("    /** CALL の入口。LINKAGE を位置で束縛し、復帰時に呼び出し元へ書き戻す。 */\n")
                .append("    public static void call(Map<String, Object> callerVars, List<String> out, String... args) {\n")
                .append("        if (args.length != LINKAGE.length) {\n")
                .append("            throw new IllegalStateException(\"CALL ").append(simpleName)
                .append(": expected \" + LINKAGE.length + \" argument(s) but got \" + args.length);\n")
                .append("        }\n")
                .append("        Map<String, Object> mine = new LinkedHashMap<>();\n")
                .append("        for (int k = 0; k < args.length; k++) { mine.put(LINKAGE[k], callerVars.get(args[k])); }\n")
                .append("        run(mine, out);\n")
                .append("        for (int k = 0; k < args.length; k++) { callerVars.put(args[k], mine.get(LINKAGE[k])); }\n")
                .append("    }\n\n");

        sb.append("    /** VALUE 句。呼び出し側が渡した given を潰さないよう putIfAbsent を使う。 */\n")
                .append("    private static void initWorkingStorage(Map<String, Object> vars) {\n");
        for (Map.Entry<String, String> item : program.getWorkingStorage().entrySet()) {
            sb.append("        vars.putIfAbsent(").append(javaString(item.getKey())).append(", ")
                    .append(item.getValue()).append(");\n");
        }
        sb.append("    }\n\n");

        sb.append("""
                    /** PERFORM <from> [THRU <until>]: 範囲内の段落を順に実行して戻る。 */
                    static void perform(Map<String, Object> vars, List<String> out, String from, String until) {
                        int first = indexOf(from);
                        int last = indexOf(until);
                        if (first > last) {
                            throw new IllegalStateException(
                                    "PERFORM " + from + " THRU " + until + ": range runs backwards");
                        }
                        int i = first;
                        while (i <= last) {
                            CobolRuntime.step();
                            String jump;
                            try {
                                jump = dispatch(PARAS[i], vars, out);
                            } catch (CobolRuntime.GoTo g) {
                                int t = indexOf(g.target);
                                if (t < first || t > last) { throw g; }
                                i = t;
                                continue;
                            }
                            if (jump == null) {
                                i++;
                            } else {
                                int t = indexOf(jump);
                                if (t < first || t > last) { throw new CobolRuntime.GoTo(jump); }
                                i = t;
                            }
                        }
                    }

                    /** 未知のラベルは黙って無視せず落とす。テンプレートの打ち間違いを静かな誤答にしないため。 */
                    private static int indexOf(String label) {
                        for (int k = 0; k < PARAS.length; k++) {
                            if (PARAS[k].equals(label)) { return k; }
                        }
                        throw new IllegalStateException("unknown paragraph: " + label);
                    }

                    static void stopRun() { throw new CobolRuntime.StopRun(); }

                    static void goback() { throw new CobolRuntime.Goback(); }

                """);

        sb.append("    private static String dispatch(String p, Map<String, Object> vars, List<String> out) {\n")
                .append("        switch (p) {\n");
        for (String label : program.getParagraphs().keySet()) {
            sb.append("            case ").append(javaString(label)).append(": return ")
                    .append(paragraphMethod(label)).append("(vars, out);\n");
        }
        sb.append("            case \"__END\": return null;\n")
                .append("            default: throw new IllegalStateException(\"unknown paragraph: \" + p);\n")
                .append("        }\n")
                .append("    }\n\n");

        for (Map.Entry<String, List<String>> paragraph : program.getParagraphs().entrySet()) {
            sb.append("    private static String ").append(paragraphMethod(paragraph.getKey()))
                    .append("(Map<String, Object> vars, List<String> out) {\n")
                    .append("        if (true) {\n");
            for (String statement : paragraph.getValue()) {
                if (statement != null && !statement.isBlank()) {
                    sb.append("            ").append(statement).append('\n');
                }
            }
            sb.append("        }\n")
                    .append("        return null;\n")
                    .append("    }\n\n");
        }

        sb.append(NUM_HELPER).append("}\n");
        return sb.toString();
    }

    private static String paragraphMethod(String label) {
        return "P_" + CobolProgram.toJavaIdentifier(label);
    }

    private static String javaString(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    /**
     * 複数のコンパイル単位を1回の javac タスクでコンパイルする。
     *
     * @param sources      クラス完全名 → ソース
     * @param classesDir   クラス出力先。所有権は呼び出し側
     * @param extraClasspath 追加クラスパス。Spring Boot 生成物のように外部依存が要る場合に使う。
     *                       空でよい（COBOL生成物は標準ライブラリだけで足りる）
     */
    public static CompileOutcome compileUnits(Map<String, String> sources, Path classesDir,
                                              List<String> extraClasspath) {
        CompileOutcome outcome = new CompileOutcome();
        outcome.setAttempted(true);
        outcome.setClassName(String.join(", ", sources.keySet()));
        outcome.setSource(String.join("\n\n// ---------------------------------------------\n\n",
                sources.values()));

        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            outcome.setCompilerAvailable(false);
            outcome.setFailureReason("no JDK compiler available at runtime "
                    + "(ToolProvider.getSystemJavaCompiler() == null); run on a JDK image, not a JRE");
            return outcome;
        }
        outcome.setCompilerAvailable(true);

        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        try (StandardJavaFileManager fileManager =
                     compiler.getStandardFileManager(diagnostics, null, null)) {
            Files.createDirectories(classesDir);
            fileManager.setLocationFromPaths(StandardLocation.CLASS_OUTPUT, List.of(classesDir));

            List<String> options = new ArrayList<>(List.of("-proc:none", "-nowarn"));
            if (extraClasspath != null && !extraClasspath.isEmpty()) {
                options.add("-classpath");
                options.add(String.join(java.io.File.pathSeparator, extraClasspath));
            }
            List<JavaFileObject> units = new ArrayList<>();
            sources.forEach((className, source) -> units.add(new InMemorySource(className, source)));

            boolean ok = compiler.getTask(null, fileManager, diagnostics, options, null, units).call();
            outcome.setSuccess(Boolean.TRUE.equals(ok));
        } catch (IOException | RuntimeException e) {
            outcome.setSuccess(false);
            outcome.setFailureReason(e.toString());
        }

        diagnostics.getDiagnostics().forEach(d -> outcome.getDiagnostics().add(
                new CompileOutcome.Diagnostic(d.getKind().name(), d.getLineNumber(),
                        d.getMessage(null))));
        if (!outcome.isSuccess() && outcome.getFailureReason() == null) {
            outcome.setFailureReason("javac reported " + outcome.getErrorCount() + " error(s)");
        }
        return outcome;
    }

    /**
     * 文を {@code classesDir} へコンパイルする。ディレクトリの所有権は呼び出し側にあり、
     * 削除も呼び出し側の責任である（{@link #deleteRecursively(Path)} 参照）。
     */
    public static CompileOutcome compile(List<String> statements, Path classesDir) {
        CompileOutcome outcome = new CompileOutcome();
        outcome.setAttempted(true);
        outcome.setClassName(CLASS_NAME);
        String source = buildSource(statements);
        outcome.setSource(source);

        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            outcome.setCompilerAvailable(false);
            outcome.setFailureReason("no JDK compiler available at runtime "
                    + "(ToolProvider.getSystemJavaCompiler() == null); run on a JDK image, not a JRE");
            return outcome;
        }
        outcome.setCompilerAvailable(true);

        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        try (StandardJavaFileManager fileManager =
                     compiler.getStandardFileManager(diagnostics, null, null)) {
            Files.createDirectories(classesDir);
            fileManager.setLocationFromPaths(StandardLocation.CLASS_OUTPUT, List.of(classesDir));

            boolean ok = compiler.getTask(null, fileManager, diagnostics,
                    List.of("-proc:none", "-nowarn"), null,
                    List.of(new InMemorySource(CLASS_NAME, source))).call();
            outcome.setSuccess(Boolean.TRUE.equals(ok));
        } catch (IOException | RuntimeException e) {
            outcome.setSuccess(false);
            outcome.setFailureReason(e.toString());
        }

        diagnostics.getDiagnostics().forEach(d -> outcome.getDiagnostics().add(
                new CompileOutcome.Diagnostic(d.getKind().name(), d.getLineNumber(),
                        d.getMessage(null))));
        if (!outcome.isSuccess() && outcome.getFailureReason() == null) {
            outcome.setFailureReason("javac reported " + outcome.getErrorCount() + " error(s)");
        }
        return outcome;
    }

    public static void deleteRecursively(Path root) {
        if (root == null || !Files.exists(root)) {
            return;
        }
        try (Stream<Path> paths = Files.walk(root)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // ベストエフォート。一時ディレクトリの消し残しでチェーンを失敗させてはならない
                }
            });
        } catch (IOException ignored) {
            // 同上
        }
    }

    private static final class InMemorySource extends SimpleJavaFileObject {
        private final String code;

        private InMemorySource(String className, String code) {
            super(URI.create("string:///" + className.replace('.', '/') + Kind.SOURCE.extension),
                    Kind.SOURCE);
            this.code = code;
        }

        @Override
        public CharSequence getCharContent(boolean ignoreEncodingErrors) {
            return code;
        }
    }
}
