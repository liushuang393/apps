package jp.co.softroad.liteflow.transform;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;

/**
 * ルール表を入力行に適用する中核。<b>Spring も LiteFlow も {@code MigrationContext} も要らない。</b>
 *
 * <p>このPoCの主張は「新しい構文への対応でJavaを書かない、ルール表のJSONに1件足す」である。
 * つまり<b>ルール表が製品で、このクラスが実装</b>にあたる。だからここには
 * 専用のテスト面（<b>seam</b>）が要る。{@code TransformNode} はこのクラスを呼ぶだけの
 * <b>adapter</b> であり、ルールの意味を確かめたいテストは
 * {@link #apply(Request)} を直接呼ぶこと（起動が要らないので1件あたり数ミリ秒で済む）。
 *
 * <p>入力の受け取り方は3通りあり、上から順に判定する。
 * <ol>
 *   <li><b>段落方式</b> — {@link SourceAnalyzer} がプログラム構造を組み立てていれば、
 *       段落ごとに変換して {@link CobolProgram#getParagraphs()} へ詰める</li>
 *   <li><b>複数ファイル方式</b> — {@code sourceFiles} があれば、ファイル名でルールを絞りつつ
 *       {@code emitTo} / {@code section} で名前付き成果物へ振り分ける</li>
 *   <li><b>平坦方式</b> — 従来どおり {@code sourceLines} を1本の生成行列へ出す</li>
 * </ol>
 *
 * <p>ブロック構造（IF / EVALUATE / インライン PERFORM）は<b>実行ごとのローカルな枠スタック</b>で
 * 扱う。共有状態にはしない — LiteFlow はノードを並行実行しうるし、
 * Rule-DB のGroovyスクリプトノードが {@code emit()} を直接叩くため、
 * 共有すると括弧の対応が壊される。
 *
 * <p>適用範囲の注意: これは文単位のテンプレートマッパであり、COBOLパーサではない。
 * 型モデルもスコープ解析も持たない。
 */
public final class RuleEngine {
    /** {@code continueWith} の再投入の深さ上限。ルールの相互再帰で無限に回らないようにする。 */
    public static final int MAX_CONTINUE_DEPTH = 8;

    private RuleEngine() {
    }

    /**
     * 変換1回分の入力。
     *
     * @param profile         版数付きルールプロファイル。null ならインラインテンプレート経路
     * @param inlineTemplates プロファイル無しのときのテンプレート表。{@code unknown} の
     *                        フォールバックにも使う
     * @param facts           {@link SourceAnalyzer} が集めたファイル横断の変数
     * @param programs        {@link SourceAnalyzer} が組み立てたプログラム。
     *                        <b>このリストの要素は変換結果を書き込まれる</b>（段落方式）
     */
    public record Request(TemplateProfile profile,
                          Map<String, String> inlineTemplates,
                          Map<String, String> facts,
                          List<String> sourceLines,
                          Map<String, List<String>> sourceFiles,
                          List<CobolProgram> programs) {
        public Request {
            inlineTemplates = inlineTemplates == null ? Map.of() : inlineTemplates;
            facts = facts == null ? Map.of() : facts;
            sourceLines = sourceLines == null ? List.of() : sourceLines;
            sourceFiles = sourceFiles == null ? Map.of() : sourceFiles;
            programs = programs == null ? List.of() : programs;
        }

        /** ルール表だけを与える最小の入力。テストから使う。 */
        public static Request of(TemplateProfile profile, List<String> sourceLines) {
            return new Request(profile, Map.of(), Map.of(), sourceLines, Map.of(), List.of());
        }

        /** 複数ファイル方式の入力。解析まで済ませたいときは {@link SourceAnalyzer} を先に呼ぶ。 */
        public static Request ofFiles(TemplateProfile profile, Map<String, List<String>> sourceFiles,
                                      SourceAnalyzer.Analysis analysis) {
            return new Request(profile, Map.of(), analysis.facts(), List.of(), sourceFiles,
                    analysis.programs());
        }

        public boolean hasSource() {
            return !sourceLines.isEmpty() || !sourceFiles.isEmpty();
        }
    }

    /**
     * 変換1回分の結果。
     *
     * @param findings 品質ゲートへ渡す指摘（閉じ切っていないブロックなど）
     */
    public record Result(List<String> generatedLines,
                         Map<String, List<String>> artifacts,
                         CoverageSummary coverage,
                         Map<String, CoverageSummary> coverageByFile,
                         List<String> findings) {

        /** 実際に1回以上マッチしたルールのid。使われていないルールの検出に使う。 */
        public Set<String> firedRuleIds() {
            return coverage.getByRule().keySet();
        }

        public String generatedCode() {
            return String.join("\n", generatedLines);
        }
    }

    /** 実行1回分の作業領域。呼び出しごとに新しく作るので共有状態は無い。 */
    private static final class Run {
        private final TemplateProfile profile;
        private final Map<String, String> inlineTemplates;
        private final Map<String, String> facts;
        private final CoverageSummary coverage = new CoverageSummary();
        private final Map<String, CoverageSummary> coverageByFile = new LinkedHashMap<>();
        private final List<String> findings = new ArrayList<>();
        private final List<String> generatedLines = new ArrayList<>();
        private final Map<String, List<String>> artifacts = new LinkedHashMap<>();

        private Run(Request request) {
            this.profile = request.profile();
            this.inlineTemplates = request.inlineTemplates();
            this.facts = request.facts();
        }

        private Result toResult() {
            return new Result(generatedLines, artifacts, coverage, coverageByFile, findings);
        }
    }

    public static Result apply(Request request) {
        Run run = new Run(request);
        if (!request.hasSource()) {
            return run.toResult();  // 変換対象なし。オーケストレーション専用チェーンはここに来る
        }
        if (!request.programs().isEmpty()) {
            transformPrograms(run, request.programs());
        } else if (!request.sourceFiles().isEmpty()) {
            transformFiles(run, request.sourceFiles());
        } else {
            transformFlat(run, request.sourceLines());
        }
        return run.toResult();
    }

    // ---- 平坦方式（既存12ケース。挙動を変えないこと） --------------------------

    private static void transformFlat(Run run, List<String> sourceLines) {
        Emitter emitter = run.generatedLines::add;
        Deque<Frame> stack = new ArrayDeque<>();
        for (String raw : sourceLines) {
            String line = raw.trim();
            if (line.isEmpty()) {
                continue;
            }
            handleLine(run, stack, emitter, line, null, 0);
        }
        reportUnbalanced(run, stack);
    }

    // ---- 段落方式（COBOL複数プログラム） ----------------------------------------

    private static void transformPrograms(Run run, List<CobolProgram> programs) {
        for (CobolProgram program : programs) {
            for (Map.Entry<String, List<String>> paragraph
                    : program.getSourceParagraphs().entrySet()) {
                List<String> target = program.declareParagraph(paragraph.getKey());
                Emitter emitter = target::add;
                Deque<Frame> stack = new ArrayDeque<>();
                for (String raw : paragraph.getValue()) {
                    String line = raw.trim();
                    if (line.isEmpty()) {
                        continue;
                    }
                    handleLine(run, stack, emitter, line, program.getSourceFile(), 0);
                }
                reportUnbalanced(run, stack);
            }
            // CompileNode / QualityGateNode が「生成物あり」を判定できるよう、
            // 段落ごとの生成行を名前付き成果物としても見えるようにしておく。
            program.getParagraphs().forEach((label, lines) ->
                    run.artifacts.put(program.getSimpleName() + "#" + label, new ArrayList<>(lines)));
        }
    }

    // ---- 複数ファイル方式（Struts など） ----------------------------------------

    private static void transformFiles(Run run, Map<String, List<String>> sourceFiles) {
        // 成果物名 → 区画名 → 行。区画順は artifacts[].sections が決める。
        Map<String, Map<String, List<String>>> buckets = new LinkedHashMap<>();

        sourceFiles.forEach((fileName, lines) -> {
            CoverageSummary fileCoverage = new CoverageSummary();
            Deque<Frame> stack = new ArrayDeque<>();
            for (String raw : lines) {
                String line = raw.trim();
                if (line.isEmpty()) {
                    continue;
                }
                // 出力先は行ごとにルールの emitTo / section で決まる。
                RoutedEmit routed = new RoutedEmit(buckets, run.facts, run.profile);
                handleLine(run, stack, routed, line, fileName, 0);
                if (routed.recognised) {
                    fileCoverage.recordRecognised(routed.ruleId);
                } else {
                    fileCoverage.recordUnrecognised(line);
                }
            }
            reportUnbalanced(run, stack);
            run.coverageByFile.put(fileName, fileCoverage);
        });

        // 骨組みを被せて成果物を確定する。
        Map<String, ArtifactSpec> specs = new LinkedHashMap<>();
        if (run.profile != null) {
            for (ArtifactSpec spec : run.profile.getArtifacts()) {
                specs.put(TemplateRenderer.render(spec.getName(), run.facts), spec);
            }
        }
        for (Map.Entry<String, ArtifactSpec> entry : specs.entrySet()) {
            buckets.computeIfAbsent(entry.getKey(), key -> new LinkedHashMap<>());
        }
        buckets.forEach((artifact, sections) -> {
            ArtifactSpec spec = specs.get(artifact);
            List<String> out = new ArrayList<>();
            if (spec != null) {
                spec.getPreamble().forEach(line -> out.add(TemplateRenderer.render(line, run.facts)));
                for (String section : spec.getSections()) {
                    out.addAll(sections.getOrDefault(section, List.of()));
                }
                sections.forEach((section, lines) -> {
                    if (!spec.getSections().contains(section)) {
                        out.addAll(lines);
                    }
                });
                spec.getEpilogue().forEach(line -> out.add(TemplateRenderer.render(line, run.facts)));
            } else {
                sections.values().forEach(out::addAll);
            }
            run.artifacts.put(artifact, out);
        });
    }

    /** 1行分の出力先。平坦方式は既定出力、複数ファイル方式は {@code emitTo} で振り分ける。 */
    @FunctionalInterface
    private interface Emitter {
        void emit(String line);
    }

    /** {@code emitTo} / {@code section} に従って成果物バケットへ振り分ける出力先。 */
    private static final class RoutedEmit implements Emitter {
        private final Map<String, Map<String, List<String>>> buckets;
        private final Map<String, String> facts;
        private final TemplateProfile profile;
        private String artifact;
        private String section;
        private boolean recognised;
        private String ruleId;

        private RoutedEmit(Map<String, Map<String, List<String>>> buckets,
                           Map<String, String> facts, TemplateProfile profile) {
            this.buckets = buckets;
            this.facts = facts;
            this.profile = profile;
        }

        private void route(TransformRule rule, Map<String, String> variables) {
            this.recognised = true;
            this.ruleId = rule.getId();
            this.artifact = rule.getEmitTo() == null ? null
                    : TemplateRenderer.render(rule.getEmitTo(), variables);
            this.section = rule.getSection();
        }

        private void routeUnrecognised() {
            this.recognised = false;
            this.ruleId = null;
            this.artifact = defaultArtifact();
            this.section = null;
        }

        private String defaultArtifact() {
            if (profile != null && !profile.getArtifacts().isEmpty()) {
                return TemplateRenderer.render(profile.getArtifacts().get(0).getName(), facts);
            }
            return "generated.txt";
        }

        @Override
        public void emit(String line) {
            String name = artifact == null || artifact.isBlank() ? defaultArtifact() : artifact;
            String bucket = section == null || section.isBlank() ? "" : section;
            buckets.computeIfAbsent(name, key -> new LinkedHashMap<>())
                    .computeIfAbsent(bucket, key -> new ArrayList<>())
                    .add(line);
        }
    }

    // ---- ルール適用の中核 -------------------------------------------------------

    /** ブロック構造の枠。ルール表が {@code opens} / {@code closes} を宣言したときだけ積まれる。 */
    private record Frame(String kind, int depth, Map<String, String> bound) {
    }

    private static void handleLine(Run run, Deque<Frame> stack, Emitter emitter, String line,
                                   String fileName, int depth) {
        if (depth < 0) {
            return;  // 呼び出し側の都合で無効化された呼び出し
        }
        if (applyRules(run, stack, emitter, line, fileName, depth)) {
            return;
        }
        run.coverage.recordUnrecognised(line);
        if (emitter instanceof RoutedEmit routed) {
            // 成果物へ振り分ける方式では、認識できなかった行を成果物へ混ぜない。
            // ゴールデン差分の比較対象を汚さないため。未カバーとしては上で数えてある。
            routed.routeUnrecognised();
            return;
        }
        if (emitter != null) {
            emitter.emit(InlineTemplates.render(run.inlineTemplates.get("unknown"), "unknown",
                    Map.of("line", line)));
        }
    }

    /** いずれかのルールが行にマッチした場合に true を返す。 */
    private static boolean applyRules(Run run, Deque<Frame> stack, Emitter emitter, String line,
                                      String fileName, int depth) {
        if (run.profile == null) {
            return applyInlineTemplates(run, emitter, line);
        }
        for (TransformRule rule : run.profile.getRules()) {
            if (!rule.appliesToFileName(fileName) || !frameAllows(rule, stack)) {
                continue;
            }
            Matcher matcher = rule.compiledPattern().matcher(line);
            if (!matcher.matches()) {
                continue;
            }

            Map<String, String> variables = new LinkedHashMap<>(run.facts);
            variables.putAll(TemplateRenderer.variables(rule, matcher, run.profile.getMaps()));
            Frame top = stack.peek();
            // ${_indent} は「この行が入るブロックの深さ」に対応する字下げ。
            // 閉じ括弧は自分が閉じる枠の深さに合わせるので、枠を降ろす前の深さを使う。
            int indentDepth = stack.size();
            if (top != null && (rule.getRequires() != null || rule.getCloses() != null)) {
                variables.putAll(top.bound());
                variables.put("_depth", String.valueOf(top.depth()));
                if (rule.getCloses() != null) {
                    indentDepth = top.depth();
                }
            }
            if (rule.getOpens() != null) {
                variables.put("_depth", String.valueOf(stack.size()));
            }
            variables.put("_indent", "    ".repeat(Math.max(0, indentDepth)));

            if (rule.getCloses() != null && !stack.isEmpty()) {
                stack.pop();
            }
            String rendered = TemplateRenderer.render(rule.getTemplate(), variables);
            run.coverage.recordRecognised(rule.getId());
            if (emitter instanceof RoutedEmit routed) {
                routed.route(rule, variables);
            }
            if (!rendered.isBlank() && emitter != null) {
                for (String outLine : rendered.split("\n", -1)) {
                    emitter.emit(outLine);
                }
            }
            if (rule.getOpens() != null) {
                stack.push(new Frame(rule.getOpens(), stack.size(), bindings(rule, variables)));
            }
            continueWith(run, stack, emitter, rule, matcher, fileName, depth);
            return true;
        }
        return false;
    }

    /** {@code requires} / {@code closes} は枠の一番上が一致するときだけマッチさせる。 */
    private static boolean frameAllows(TransformRule rule, Deque<Frame> stack) {
        String needed = rule.getRequires() != null ? rule.getRequires() : rule.getCloses();
        if (needed == null) {
            return true;
        }
        Frame top = stack.peek();
        return top != null && needed.equals(top.kind());
    }

    private static Map<String, String> bindings(TransformRule rule, Map<String, String> variables) {
        if (rule.getBinds() == null || rule.getBinds().isEmpty()) {
            return Map.of();
        }
        Map<String, String> bound = new LinkedHashMap<>();
        rule.getBinds().forEach((name, template) ->
                bound.put(name, TemplateRenderer.render(template, variables)));
        return bound;
    }

    /**
     * 同一行に複合した文（{@code WHEN 1 MOVE A TO B} や END-IF の無い
     * {@code IF x > y MOVE 1 TO Z}）を扱うため、指定グループの中身を1行として再投入する。
     */
    private static void continueWith(Run run, Deque<Frame> stack, Emitter emitter,
                                     TransformRule rule, Matcher matcher, String fileName,
                                     int depth) {
        if (rule.getContinueWith() == null || depth >= MAX_CONTINUE_DEPTH) {
            return;
        }
        String rest;
        try {
            rest = matcher.group(rule.getContinueWith());
        } catch (IllegalArgumentException | IllegalStateException e) {
            return;
        }
        if (rest == null || rest.isBlank()) {
            return;
        }
        handleLine(run, stack, emitter, rest.trim(), fileName, depth + 1);
    }

    /** ブロックが閉じ切っていないルール表は、生成コードがコンパイルできても信用できない。 */
    private static void reportUnbalanced(Run run, Deque<Frame> stack) {
        if (stack.isEmpty()) {
            return;
        }
        List<String> kinds = new ArrayList<>();
        stack.forEach(frame -> kinds.add(frame.kind()));
        run.findings.add("structure: " + stack.size()
                + " block(s) were opened but never closed: " + String.join(", ", kinds));
    }

    /**
     * プロファイル指定なしで {@code templates} マップだけを渡すリクエスト向けのフォールバック。
     * ルールライブラリ無しでも「テンプレート表を差し替える」デモが動くように残してある。
     */
    private static boolean applyInlineTemplates(Run run, Emitter emitter, String line) {
        for (InlineTemplates.Form form : InlineTemplates.Form.values()) {
            Matcher matcher = form.matcher(line);
            if (!matcher.matches()) {
                continue;
            }
            String rendered = InlineTemplates.render(run.inlineTemplates.get(form.key()),
                    form.key(), form.variables(matcher));
            run.coverage.recordRecognised(form.key());
            if (!rendered.isBlank() && emitter != null) {
                emitter.emit(rendered);
            }
            return true;
        }
        return false;
    }
}
