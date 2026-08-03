package jp.co.softroad.liteflow.model;

import jp.co.softroad.liteflow.transform.BehaviourExpectation;
import jp.co.softroad.liteflow.transform.CobolProgram;
import jp.co.softroad.liteflow.transform.CompileOutcome;
import jp.co.softroad.liteflow.transform.CoverageSummary;
import jp.co.softroad.liteflow.transform.GoldenComparison;
import jp.co.softroad.liteflow.transform.InlineTemplates;

import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * チェーン内の全ノードが共有する実行コンテキスト。
 *
 * <p>実行traceに加えて変換のペイロードを保持する。すなわち変換対象のソース行、変換に使う
 * テンプレート、そして生成された出力である。テンプレートはリクエストデータか Rule-DB の
 * スクリプトノードから渡され、Javaにハードコードされることはない。これが「ルールを変えれば
 * 生成コードが変わる」を再デプロイなしに示せる理由である。
 *
 * <p>LiteFlow はこのオブジェクトを {@code migrationContext} という名前でスクリプトへ束縛する
 * （コンテキストの単純名の先頭を小文字にしたもの）。そのため Rule-DB に格納した Groovy ノードから
 * {@link #render} や {@link #emit} を直接呼べる。
 */
public class MigrationContext {
    private final String requestId;
    private final Instant startedAt;
    private final List<String> trace = Collections.synchronizedList(new ArrayList<>());
    private final List<String> sourceLines = Collections.synchronizedList(new ArrayList<>());
    private final List<String> generatedLines = Collections.synchronizedList(new ArrayList<>());
    private final Map<String, String> templates = Collections.synchronizedMap(new LinkedHashMap<>());

    /** 変換に使う版数付きルールプロファイル名。null の場合はインラインテンプレートのみを使う。 */
    private volatile String templateProfile;
    private volatile CoverageSummary coverage;
    private volatile CompileOutcome compileOutcome;
    private volatile Path workDir;
    private final List<BehaviourExpectation> expectations =
            Collections.synchronizedList(new ArrayList<>());
    private final List<BehaviourExpectation.Result> testResults =
            Collections.synchronizedList(new ArrayList<>());
    /** カバレッジゲート。null の場合は品質ゲートのカバレッジ判定を無効化する。 */
    private volatile Double maxUncoveredRate;
    private volatile String qualityGate = "NOT_EVALUATED";
    private final List<String> qualityGateFindings =
            Collections.synchronizedList(new ArrayList<>());

    // ---- 複数ファイル・複数成果物のための追加分 -------------------------------
    // 単一ファイル方式（既存の cobol-statements ファミリ）はこれらを一切使わない。
    // 空のままなら従来どおり sourceLines / generatedLines だけで動く。

    /** 変換元ファイル名 → 行。複数ファイルを扱うファミリだけが使う。 */
    private final Map<String, List<String>> sourceFiles =
            Collections.synchronizedMap(new LinkedHashMap<>());
    /** 成果物名 → 生成行。1入力から複数成果物へ振り分けるファミリだけが使う。 */
    private final Map<String, List<String>> generatedArtifacts =
            Collections.synchronizedMap(new LinkedHashMap<>());
    /** 成果物名 → 期待する正解テキスト。ゴールデン差分で使う。 */
    private final Map<String, String> goldenArtifacts =
            Collections.synchronizedMap(new LinkedHashMap<>());
    private final List<GoldenComparison> goldenResults =
            Collections.synchronizedList(new ArrayList<>());
    /** AnalyzeNode が組み立てたCOBOLプログラム構造。段落が見つからなければ空のまま。 */
    private final List<CobolProgram> programs = Collections.synchronizedList(new ArrayList<>());
    /** 実行開始プログラム名（COBOLのプログラム名）。未指定なら最初のプログラム。 */
    private volatile String entryProgram;
    /** TestNode が読み込むクラス完全名。段落方式のときだけ設定される。 */
    private volatile String entryClassName;
    /** ファイル別カバレッジ。集計値の {@link #coverage} は従来どおりで、これは追加情報。 */
    private final Map<String, CoverageSummary> coverageByFile =
            Collections.synchronizedMap(new LinkedHashMap<>());
    /** ファイル横断で集めた変数。AnalyzeNode が facts 規則で作り、全ルールの描画に混ぜる。 */
    private final Map<String, String> facts =
            Collections.synchronizedMap(new LinkedHashMap<>());

    public MigrationContext(String requestId) {
        this.requestId = requestId;
        this.startedAt = Instant.now();
    }

    public void addStep(String step) {
        trace.add(step);
    }

    public String getRequestId() {
        return requestId;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public List<String> getTrace() {
        synchronized (trace) {
            return new ArrayList<>(trace);
        }
    }

    public void setSourceLines(List<String> lines) {
        synchronized (sourceLines) {
            sourceLines.clear();
            if (lines != null) {
                lines.stream().filter(line -> line != null && !line.isBlank()).forEach(sourceLines::add);
            }
        }
    }

    public List<String> getSourceLines() {
        synchronized (sourceLines) {
            return new ArrayList<>(sourceLines);
        }
    }

    public void setTemplates(Map<String, String> values) {
        synchronized (templates) {
            templates.clear();
            if (values != null) {
                values.forEach((key, value) -> {
                    if (key != null && value != null) {
                        templates.put(key, value);
                    }
                });
            }
        }
    }

    public Map<String, String> getTemplates() {
        synchronized (templates) {
            return new LinkedHashMap<>(templates);
        }
    }

    public String getTemplate(String key) {
        return templates.get(key);
    }

    /** 生成コードを1行追加する。JavaノードからもRule-DBのスクリプトノードからも呼ばれる。 */
    public void emit(String line) {
        if (line != null) {
            generatedLines.add(line);
        }
    }

    public String getGeneratedCode() {
        synchronized (generatedLines) {
            return String.join("\n", generatedLines);
        }
    }

    public List<String> getGeneratedLines() {
        synchronized (generatedLines) {
            return new ArrayList<>(generatedLines);
        }
    }

    public String getTemplateProfile() {
        return templateProfile;
    }

    public void setTemplateProfile(String templateProfile) {
        this.templateProfile = templateProfile;
    }

    public CoverageSummary getCoverage() {
        return coverage;
    }

    public void setCoverage(CoverageSummary coverage) {
        this.coverage = coverage;
    }

    public CompileOutcome getCompileOutcome() {
        return compileOutcome;
    }

    public void setCompileOutcome(CompileOutcome compileOutcome) {
        this.compileOutcome = compileOutcome;
    }

    /** コンパイル済みクラスを置く一時ディレクトリ。チェーン終了後に呼び出し側が削除する。 */
    public Path getWorkDir() {
        return workDir;
    }

    public void setWorkDir(Path workDir) {
        this.workDir = workDir;
    }

    public void setExpectations(List<BehaviourExpectation> values) {
        synchronized (expectations) {
            expectations.clear();
            if (values != null) {
                values.stream().filter(java.util.Objects::nonNull).forEach(expectations::add);
            }
        }
    }

    public List<BehaviourExpectation> getExpectations() {
        synchronized (expectations) {
            return new ArrayList<>(expectations);
        }
    }

    public void addTestResult(BehaviourExpectation.Result result) {
        testResults.add(result);
    }

    public List<BehaviourExpectation.Result> getTestResults() {
        synchronized (testResults) {
            return new ArrayList<>(testResults);
        }
    }

    public Double getMaxUncoveredRate() {
        return maxUncoveredRate;
    }

    public void setMaxUncoveredRate(Double maxUncoveredRate) {
        this.maxUncoveredRate = maxUncoveredRate;
    }

    public String getQualityGate() {
        return qualityGate;
    }

    public void setQualityGate(String qualityGate) {
        this.qualityGate = qualityGate;
    }

    public void addQualityGateFinding(String finding) {
        qualityGateFindings.add(finding);
    }

    public List<String> getQualityGateFindings() {
        synchronized (qualityGateFindings) {
            return new ArrayList<>(qualityGateFindings);
        }
    }

    // ---- 複数ファイル・複数成果物 -------------------------------------------

    public void setSourceFiles(Map<String, List<String>> files) {
        synchronized (sourceFiles) {
            sourceFiles.clear();
            if (files != null) {
                files.forEach((name, lines) -> {
                    if (name != null && lines != null) {
                        sourceFiles.put(name, new ArrayList<>(lines));
                    }
                });
            }
        }
    }

    public Map<String, List<String>> getSourceFiles() {
        synchronized (sourceFiles) {
            Map<String, List<String>> copy = new LinkedHashMap<>();
            sourceFiles.forEach((name, lines) -> copy.put(name, new ArrayList<>(lines)));
            return copy;
        }
    }

    /**
     * 変換対象があるかどうか。<b>4つのノードのガードはすべてこれを使うこと。</b>
     *
     * <p>ソースを渡さないオーケストレーション専用チェーン（Rule-DB検証の42項目）では
     * transform / compile / test / qualityGate が何もしない、という不変条件を守っている。
     * ここを片方だけ見るように書き換えると、PERF-01 / CONC-01 / SYNC-* が一斉に落ちる。
     */
    public boolean hasSource() {
        return !getSourceLines().isEmpty() || !getSourceFiles().isEmpty();
    }

    /** 生成物があるかどうか。compile / qualityGate のガードで使う。 */
    public boolean hasGeneratedOutput() {
        if (!getGeneratedLines().isEmpty()) {
            return true;
        }
        synchronized (generatedArtifacts) {
            return generatedArtifacts.values().stream().anyMatch(lines -> !lines.isEmpty());
        }
    }

    /** 名前付き成果物へ1行追加する。名前が空なら既定の {@link #emit} と同じ扱いにする。 */
    public void emitTo(String artifact, String line) {
        if (line == null) {
            return;
        }
        if (artifact == null || artifact.isBlank()) {
            emit(line);
            return;
        }
        synchronized (generatedArtifacts) {
            generatedArtifacts.computeIfAbsent(artifact, key -> new ArrayList<>()).add(line);
        }
    }

    public Map<String, List<String>> getGeneratedArtifacts() {
        synchronized (generatedArtifacts) {
            Map<String, List<String>> copy = new LinkedHashMap<>();
            generatedArtifacts.forEach((name, lines) -> copy.put(name, new ArrayList<>(lines)));
            return copy;
        }
    }

    public void putGeneratedArtifact(String artifact, List<String> lines) {
        if (artifact == null || lines == null) {
            return;
        }
        synchronized (generatedArtifacts) {
            generatedArtifacts.put(artifact, new ArrayList<>(lines));
        }
    }

    public void setGoldenArtifacts(Map<String, String> values) {
        synchronized (goldenArtifacts) {
            goldenArtifacts.clear();
            if (values != null) {
                values.forEach((name, text) -> {
                    if (name != null && text != null) {
                        goldenArtifacts.put(name, text);
                    }
                });
            }
        }
    }

    public Map<String, String> getGoldenArtifacts() {
        synchronized (goldenArtifacts) {
            return new LinkedHashMap<>(goldenArtifacts);
        }
    }

    public void addGoldenResult(GoldenComparison comparison) {
        goldenResults.add(comparison);
    }

    public List<GoldenComparison> getGoldenResults() {
        synchronized (goldenResults) {
            return new ArrayList<>(goldenResults);
        }
    }

    public List<CobolProgram> getPrograms() {
        synchronized (programs) {
            return new ArrayList<>(programs);
        }
    }

    public void addProgram(CobolProgram program) {
        if (program != null) {
            programs.add(program);
        }
    }

    public String getEntryProgram() {
        return entryProgram;
    }

    public void setEntryProgram(String entryProgram) {
        this.entryProgram = entryProgram;
    }

    public String getEntryClassName() {
        return entryClassName;
    }

    public void setEntryClassName(String entryClassName) {
        this.entryClassName = entryClassName;
    }

    public Map<String, CoverageSummary> getCoverageByFile() {
        synchronized (coverageByFile) {
            return new LinkedHashMap<>(coverageByFile);
        }
    }

    public void putCoverageForFile(String file, CoverageSummary summary) {
        if (file != null && summary != null) {
            coverageByFile.put(file, summary);
        }
    }

    public Map<String, String> getFacts() {
        synchronized (facts) {
            return new LinkedHashMap<>(facts);
        }
    }

    public void putFact(String name, String value) {
        if (name != null && value != null) {
            facts.put(name, value);
        }
    }

    /**
     * {@code key} で登録されたテンプレート内の {@code ${name}} プレースホルダを置換する。
     * 未知のテンプレートキーや未知のプレースホルダは黙って捨てず出力に残すため、
     * 設定ミスのあるルールは生成コード上で一目で分かる。
     *
     * <p><b>Rule-DB に保存済みの Groovy スクリプトがこれを直接呼ぶ。</b>
     * 置換規則は {@link InlineTemplates#render} に1か所で置いてあり、
     * {@link jp.co.softroad.liteflow.transform.RuleEngine} の {@code unknown} フォールバックと
     * 同じ振る舞いを共有する。意味を変えるとデータベースの中の本文が壊れる。
     */
    public String render(String key, Map<String, String> variables) {
        return InlineTemplates.render(getTemplate(key), key, variables);
    }
}
