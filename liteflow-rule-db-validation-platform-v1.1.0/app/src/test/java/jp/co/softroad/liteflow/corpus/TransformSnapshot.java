package jp.co.softroad.liteflow.corpus;

import jp.co.softroad.liteflow.transform.CoverageSummary;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * 変換結果をテキストへ固定する。<b>改修の前後で1バイトも変わっていないことを機械に確認させるため</b>にある。
 *
 * <p>スナップショットは {@code app/src/test/resources/snapshots/} に置く。
 * 更新したいときだけ {@code -Dsnapshot.update=true} を付けて実行する。
 * 既定では「ファイルが無ければ失敗」であり、黙って作り直すことはない
 * （黙って作り直せる仕組みは、退行を検出しない仕組みと同じである）。
 */
public final class TransformSnapshot {
    private static final String UPDATE_PROPERTY = "snapshot.update";

    private TransformSnapshot() {
    }

    public static boolean updateRequested() {
        return Boolean.parseBoolean(System.getProperty(UPDATE_PROPERTY, "false"));
    }

    /**
     * 変換1回分の結果すべてを決定的なテキストへ。
     *
     * <p>カバレッジのルール別内訳まで入れている。生成コードが同じでも
     * 「どのルールが効いて出たのか」が変わっていれば、それは退行として見たいため。
     *
     * <p><b>{@code findings} と {@code coverageByFile} も入れる。</b> これらは
     * {@code RuleEngine.Result} が返す出力の一部であり（品質ゲートへ渡す指摘と、
     * ファイル別の未カバー率）、記録しなければ<b>安全網の外</b>になる。
     * とくに findings は「ブロックが閉じ切っていない」の検出であり、
     * 生成コードがコンパイルできてしまう場合こそ効く信号である。
     */
    public static String render(CorpusCases.Case target,
                                List<String> generatedLines,
                                Map<String, List<String>> artifacts,
                                CoverageSummary coverage,
                                Map<String, CoverageSummary> coverageByFile,
                                List<String> findings) {
        StringBuilder sb = new StringBuilder();
        sb.append("# case: ").append(target.key()).append('\n');
        sb.append("# profile: ").append(target.profile()).append('\n');
        sb.append("# coverage: total=").append(coverage.getTotalLines())
                .append(" recognised=").append(coverage.getRecognisedLines())
                .append(" unrecognised=").append(coverage.getUnrecognisedLines()).append('\n');
        new TreeMap<>(coverage.getByRule()).forEach((rule, count) ->
                sb.append("# rule: ").append(rule).append(" x").append(count).append('\n'));
        for (String sample : coverage.getUnrecognisedSamples()) {
            sb.append("# unrecognised: ").append(sample).append('\n');
        }
        if (coverageByFile != null) {
            new TreeMap<>(coverageByFile).forEach((file, summary) ->
                    sb.append("# file: ").append(file)
                            .append(" total=").append(summary.getTotalLines())
                            .append(" recognised=").append(summary.getRecognisedLines())
                            .append(" unrecognised=").append(summary.getUnrecognisedLines())
                            .append('\n'));
        }
        if (findings != null) {
            for (String finding : findings) {
                sb.append("# finding: ").append(finding).append('\n');
            }
        }
        if (generatedLines != null && !generatedLines.isEmpty()) {
            sb.append("--- generated ---\n");
            generatedLines.forEach(line -> sb.append(line).append('\n'));
        }
        if (artifacts != null) {
            new TreeMap<>(artifacts).forEach((name, lines) -> {
                sb.append("--- artifact: ").append(name).append(" ---\n");
                lines.forEach(line -> sb.append(line).append('\n'));
            });
        }
        return sb.toString();
    }

    private static Path file(CorpusCases.Case target) {
        return CorpusCases.repoRoot()
                .resolve("app/src/test/resources/snapshots")
                .resolve(target.family() + "__" + target.id() + ".txt");
    }

    /**
     * スナップショットと突き合わせる。
     *
     * @return 一致すれば null、違えば人が読める差分の説明
     */
    public static String compare(CorpusCases.Case target, String actual) {
        Path path = file(target);
        if (updateRequested()) {
            write(path, actual);
            return null;
        }
        if (!Files.isRegularFile(path)) {
            return target.key() + ": スナップショットが無い (" + path
                    + ")。意図した新規なら -Dsnapshot.update=true で作ること";
        }
        String expected = read(path);
        if (expected.equals(actual)) {
            return null;
        }
        return target.key() + ": 生成結果がスナップショットと違う\n" + diff(expected, actual);
    }

    private static String diff(String expected, String actual) {
        List<String> left = List.of(expected.split("\n", -1));
        List<String> right = List.of(actual.split("\n", -1));
        List<String> lines = new ArrayList<>();
        int max = Math.max(left.size(), right.size());
        for (int i = 0; i < max && lines.size() < 40; i++) {
            String a = i < left.size() ? left.get(i) : null;
            String b = i < right.size() ? right.get(i) : null;
            if (a == null) {
                lines.add("  +" + (i + 1) + ": " + b);
            } else if (b == null) {
                lines.add("  -" + (i + 1) + ": " + a);
            } else if (!a.equals(b)) {
                lines.add("  -" + (i + 1) + ": " + a);
                lines.add("  +" + (i + 1) + ": " + b);
            }
        }
        return String.join("\n", lines);
    }

    private static void write(Path path, String content) {
        try {
            Files.createDirectories(path.getParent());
            Files.writeString(path, content, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String read(Path path) {
        try {
            return Files.readString(path, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
