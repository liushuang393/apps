package jp.co.softroad.liteflow.corpus;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * {@code corpus/families/*&#47;cases/*} をテストから読むための入口。
 *
 * <p>コーパスの実行手段は今まで {@code scripts\corpus-run.cmd}（HTTP経由・Executor起動が前提）
 * しか無かった。ルール表を触ったときの確認をビルドの中で完結させるため、
 * 同じ入力を {@code mvn test} から読めるようにしてある。
 *
 * <p><b>{@code output/} は読むだけ。</b> あそこは「期待する正解」の置き場であり、
 * テストが実結果を書き戻してはいけない。
 */
public final class CorpusCases {
    private static final ObjectMapper MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private CorpusCases() {
    }

    /**
     * コーパスのケース1件。
     *
     * @param inputFiles ファイル名 → 行。名前順で並べてあるので実行順が安定する
     * @param golden     期待する正解の成果物（{@code behaviour.json} は除く）
     */
    public record Case(String family,
                       String id,
                       String profile,
                       String inputMode,
                       String grading,
                       String entryProgram,
                       Double maxUncoveredRate,
                       String expectQualityGate,
                       Map<String, List<String>> inputFiles,
                       Map<String, String> golden) {

        public String key() {
            return family + "/" + id;
        }

        /** 単一ファイル方式（{@code inputMode: single}）の1本目の入力行。 */
        public List<String> singleInputLines() {
            return inputFiles.values().iterator().next();
        }

        public boolean isNegative() {
            return "FAIL".equals(expectQualityGate);
        }
    }

    /** {@code corpus/families} を持つディレクトリまで上へ辿る。実行時のカレントに依存しないため。 */
    public static Path repoRoot() {
        Path root = findRepoRoot();
        if (root == null) {
            throw new IllegalStateException(
                    "corpus/families が見つかりません。起点: " + Paths.get("").toAbsolutePath());
        }
        return root;
    }

    /**
     * コーパスが読める場所にあるか。
     *
     * <p><b>Dockerイメージのビルドでは無い。</b> ビルドコンテキストには {@code app/} しか入らず
     * （実行イメージにテスト用コーパスを持たせない）、コンテナ内の {@code mvn clean verify} からは
     * 見えない。コーパスに依存するテストはそこでは前提が満たされないものとして飛ばし、
     * 同じ検査は<b>ホストの {@code local-verify}</b> と<b>手順F/J/K の {@code corpus-run}</b> が行う。
     */
    public static boolean isAvailable() {
        return findRepoRoot() != null;
    }

    private static Path findRepoRoot() {
        Path current = Paths.get("").toAbsolutePath();
        for (Path candidate = current; candidate != null; candidate = candidate.getParent()) {
            if (Files.isDirectory(candidate.resolve("corpus").resolve("families"))) {
                return candidate;
            }
        }
        return null;
    }

    public static List<Case> all() {
        Path families = repoRoot().resolve("corpus").resolve("families");
        List<Case> cases = new ArrayList<>();
        for (Path family : listDirectories(families)) {
            JsonNode familyMeta = readJson(family.resolve("family.json"));
            Path caseRoot = family.resolve("cases");
            if (!Files.isDirectory(caseRoot)) {
                continue;
            }
            for (Path dir : listDirectories(caseRoot)) {
                cases.add(readCase(family.getFileName().toString(), familyMeta, dir));
            }
        }
        return cases;
    }

    public static List<Case> family(String name) {
        return all().stream().filter(entry -> entry.family().equals(name)).toList();
    }

    private static Case readCase(String family, JsonNode familyMeta, Path dir) {
        JsonNode meta = readJson(dir.resolve("meta.json"));
        String profile = text(meta, "templateProfile", text(familyMeta, "templateProfile", null));
        Map<String, List<String>> inputs = new LinkedHashMap<>();
        for (Path file : listFiles(dir.resolve("input"))) {
            inputs.put(file.getFileName().toString(), readLines(file));
        }
        Map<String, String> golden = new LinkedHashMap<>();
        for (Path file : listFiles(dir.resolve("output"))) {
            String name = file.getFileName().toString();
            if (name.equals("behaviour.json")) {
                continue;
            }
            golden.put(name, readText(file));
        }
        Double maxUncovered = meta.hasNonNull("maxUncoveredRate")
                ? meta.get("maxUncoveredRate").asDouble() : null;
        return new Case(family, dir.getFileName().toString(), profile,
                text(familyMeta, "inputMode", "single"), text(familyMeta, "grading", "behaviour"),
                text(meta, "entryProgram", null), maxUncovered,
                text(meta, "expectQualityGate", "PASS"), inputs, golden);
    }

    private static String text(JsonNode node, String field, String fallback) {
        return node != null && node.hasNonNull(field) ? node.get(field).asText() : fallback;
    }

    private static List<Path> listDirectories(Path dir) {
        try (Stream<Path> stream = Files.list(dir)) {
            return stream.filter(Files::isDirectory)
                    .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                    .toList();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static List<Path> listFiles(Path dir) {
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        try (Stream<Path> stream = Files.list(dir)) {
            return stream.filter(Files::isRegularFile)
                    .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                    .toList();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static JsonNode readJson(Path file) {
        if (!Files.isRegularFile(file)) {
            return MAPPER.createObjectNode();
        }
        try {
            return MAPPER.readTree(file.toFile());
        } catch (IOException e) {
            throw new UncheckedIOException("読めません: " + file, e);
        }
    }

    private static List<String> readLines(Path file) {
        try {
            return Files.readAllLines(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("読めません: " + file, e);
        }
    }

    private static String readText(Path file) {
        try {
            return Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("読めません: " + file, e);
        }
    }
}
