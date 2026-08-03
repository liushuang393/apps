package jp.co.softroad.liteflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import jp.co.softroad.liteflow.corpus.CorpusCases;
import jp.co.softroad.liteflow.transform.ProfileDiagnostic;
import jp.co.softroad.liteflow.transform.ProfileValidator;
import jp.co.softroad.liteflow.transform.RuleEngine;
import jp.co.softroad.liteflow.transform.TemplateLibrary;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 書いたルールが<b>実際にコーパスで発火しているか</b>を見る。
 *
 * <p>静的な検査では見つけられない死んだルールがある（より広いパターンに実質的に
 * 食われている場合など）。実行結果と突き合わせるのがいちばん確実である。
 *
 * <p>証跡は {@code reports/rule-usage.json} に残す。画面出力だけで済ませない。
 */
class RuleUsageTest {
    private static final TemplateLibrary LIBRARY = new TemplateLibrary("");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * コーパスが読めないときは前提が満たされていないものとして飛ばす。
     *
     * <p>Dockerイメージのビルドコンテキストには {@code app/} しか入らないため、
     * コンテナ内の {@code mvn clean verify} からはコーパスが見えない。
     * <b>同じ検査はホストの local-verify と手順F/J/K の corpus-run が行う。</b>
     */
    @org.junit.jupiter.api.BeforeEach
    void requireCorpus() {
        org.junit.jupiter.api.Assumptions.assumeTrue(CorpusCases.isAvailable(),
                "コーパスがビルドコンテキストに無い（Dockerイメージ内のビルド）。"
                        + "ホストの local-verify と corpus-run が同じ検査を行う");
    }


    /**
     * <b>宣言されているのにコーパスが一度も通らないルール。</b>
     *
     * <p>この一覧は「許可」ではなく<b>負債の記録</b>である。
     * {@code cobol-programs-v1} は37ルールのうち11本がどのケースにも当たっていない。
     * つまりプロファイルは対応を主張しているが、<b>動く証拠は無い</b>。
     * このPoCの価値は「証明したこと」と「証明していないこと」を分ける点にあるので、
     * 黙って PASS にはしない — {@code reports/rule-usage.json} に件数を出し、
     * ここには1件ごとに理由を書く。
     *
     * <p>この検査は<b>ラチェット</b>として働く。ここに無い死んだルールが1本でも増えたら赤くなる。
     * 減らすには、対応するコーパスのケースを足すこと（ルールを消すのではなく）。
     */
    private static final Map<String, String> KNOWN_UNEXERCISED = Map.ofEntries(
            // 算術の変種。CobolProgramPipelineTest では MULTIPLY を通しているが、
            // コーパスのケースには無い。生成テンプレートは compilable-v1 と同型。
            Map.entry("cobol-programs-v1/subtract", "SUBTRACT を使うケースが無い"),
            Map.entry("cobol-programs-v1/multiply", "MULTIPLY を使うケースが無い（副プログラム側はテストで通している）"),
            Map.entry("cobol-programs-v1/add-giving", "ADD ... GIVING を使うケースが無い"),
            Map.entry("cobol-programs-v1/compute-copy", "COMPUTE A = B の単純代入形を使うケースが無い"),
            // ループの変種。使われているのは perform-para / perform-thru / perform-until /
            // perform-varying / perform-inline-times の5本だけ。
            Map.entry("cobol-programs-v1/perform-times", "PERFORM <段落> <n> TIMES を使うケースが無い"),
            Map.entry("cobol-programs-v1/perform-inline-until",
                    "行内 PERFORM UNTIL ... END-PERFORM を使うケースが無い"),
            Map.entry("cobol-programs-v1/perform-thru-until",
                    "PERFORM A THRU B UNTIL を使うケースが無い"),
            // その他
            Map.entry("cobol-programs-v1/call-noargs", "USING の無い CALL を使うケースが無い"),
            Map.entry("cobol-programs-v1/evaluate-when-inline",
                    "WHEN と文が同じ行にある形を使うケースが無い（RuleEngineTest では通している）"),
            Map.entry("cobol-programs-v1/continue", "CONTINUE を使うケースが無い"),
            Map.entry("cobol-programs-v1/comment", "段落の中にコメント行があるケースが無い"));

    @Test
    void everyRuleInAProfileUsedByTheCorpusActuallyFires() {
        Map<String, Set<String>> firedByProfile = new TreeMap<>();
        Map<String, Integer> casesByProfile = new TreeMap<>();

        for (CorpusCases.Case target : CorpusCases.all()) {
            RuleEngine.Result result = RuleEngineCorpusTest.run(target);
            firedByProfile.computeIfAbsent(target.profile(), key -> new LinkedHashSet<>())
                    .addAll(result.firedRuleIds());
            casesByProfile.merge(target.profile(), 1, Integer::sum);
        }

        Map<String, Object> report = new LinkedHashMap<>();
        Map<String, Object> profiles = new LinkedHashMap<>();
        List<String> newlyUnexercised = new ArrayList<>();
        Map<String, String> known = new TreeMap<>();
        int[] unexercisedTotal = {0};

        firedByProfile.forEach((profileName, fired) -> {
            var profile = LIBRARY.require(profileName);
            List<ProfileDiagnostic> unused = ProfileValidator.unusedRules(profile, fired);
            Set<String> unusedIds = new TreeSet<>();
            unused.forEach(item -> unusedIds.add(
                    item.target().substring(item.target().indexOf(' ') + 1)));
            unexercisedTotal[0] += unusedIds.size();

            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("cases", casesByProfile.get(profileName));
            entry.put("ruleCount", profile.getRules().size());
            entry.put("exercisedRules", new TreeSet<>(fired).size());
            entry.put("unexercisedRules", unusedIds);
            profiles.put(profileName, entry);

            unusedIds.forEach(id -> {
                String key = profileName + "/" + id;
                String reason = KNOWN_UNEXERCISED.get(key);
                if (reason == null) {
                    newlyUnexercised.add(key);
                } else {
                    known.put(key, reason);
                }
            });
        });

        // status は「新しく死んだルールが増えていないか」だけを表す。
        // 既知の未検証ルール件数は別に出す。PASS を「全部検証済み」と読み違えさせないため。
        report.put("status", newlyUnexercised.isEmpty() ? "PASS" : "FAIL");
        report.put("summary", "コーパスが使うプロファイルのルール発火状況。"
                + "未検証 " + unexercisedTotal[0] + " 本（既知 " + known.size() + " / 新規 "
                + newlyUnexercised.size() + "）");
        report.put("unexercisedRuleCount", unexercisedTotal[0]);
        report.put("profiles", profiles);
        report.put("knownUnexercised", known);
        report.put("newlyUnexercised", new TreeSet<>(newlyUnexercised));
        report.put("scope", "Shows which rules the corpus actually exercises. "
                + "status=PASS means only that no NEW dead rule appeared - it does NOT mean every "
                + "rule is verified: " + unexercisedTotal[0] + " rule(s) are declared but never "
                + "reached by any corpus case, so the profile claims support that has no evidence "
                + "behind it. Does NOT prove the exercised rules are correct either, only that at "
                + "least one case reaches them. readable-v1 has no corpus family at all.");
        write(report);

        assertTrue(newlyUnexercised.isEmpty(),
                () -> "コーパスで一度も発火しないルールが増えている: " + newlyUnexercised
                        + "\n対応するケースを足すこと。"
                        + "どうしても今すぐ足せないなら KNOWN_UNEXERCISED に理由つきで登録する");
    }

    @Test
    void profilesWithoutACorpusFamilyAreKnownAndDeliberate() {
        Set<String> used = new TreeSet<>();
        CorpusCases.all().forEach(target -> used.add(target.profile()));
        Set<String> uncovered = new TreeSet<>(LIBRARY.profileNames());
        uncovered.removeAll(used);

        // readable-v1 は「意図的にコンパイルできない、人が読む形式」なので
        // 生成物を実行するコーパスには乗せられない。ここを黙って増やさないための固定。
        assertEquals(Set.of("readable-v1"), uncovered,
                "コーパスで一切検証されていないプロファイルが増えている");
    }

    private static void write(Map<String, Object> report) {
        Path path = CorpusCases.repoRoot().resolve("reports").resolve("rule-usage.json");
        try {
            Files.createDirectories(path.getParent());
            Files.writeString(path,
                    MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(report),
                    StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
