package jp.co.softroad.liteflow;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import jp.co.softroad.liteflow.transform.RuleEngine;
import jp.co.softroad.liteflow.transform.TemplateLibrary;
import jp.co.softroad.liteflow.transform.TemplateProfile;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * ルールエンジンの意味論を<b>ルール表を通した最小の単位で</b>固定する。
 *
 * <p>Spring も LiteFlow も javac も使わない。{@code GeneratedProgramHarnessTest} が
 * 「生成骨格が悪いのかルールが悪いのか」を切り分ける土台であるのと同じ役割を、
 * <b>ルール表の適用規則</b>に対して果たす。ここが緑なら、
 * コーパスが落ちた原因は「ルール表の中身」か「骨格」のどちらかに絞れる。
 *
 * <p>仕組み（{@code opens} / {@code closes} / {@code requires} / {@code continueWith} /
 * {@code appliesToFile} / {@code ${_indent}}）の検査は<b>手書きの小さなプロファイル</b>で行う。
 * 同梱プロファイルの中身に依存させると、ルールを1件足すたびにここが割れてしまう。
 */
class RuleEngineTest {
    private static final ObjectMapper MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    private static final TemplateLibrary LIBRARY = new TemplateLibrary("");

    // ---- 同梱プロファイルに対する不変条件 ---------------------------------------

    @Test
    void frozenProfileStillLeavesTwoStatementsUncovered() {
        // TransformPipelineTest が Spring 経由でアサートしているものと同じ不変条件。
        // compilable-v1 の未対応範囲そのものが品質ゲートの試験体なので、ここでも固定する。
        RuleEngine.Result result = apply("compilable-v1", List.of(
                "MOVE 1 TO WS-FLAG.",
                "PERFORM VALIDATE-CUSTOMER.",
                "EVALUATE WS-STATUS"));

        assertEquals(2, result.coverage().getUnrecognisedLines(),
                () -> "未カバー: " + result.coverage().getUnrecognisedSamples());
        // unknown テンプレートを渡していないので、認識できなかった2行は
        // 「テンプレートが無い」痕跡として残る。黙って消えないことが要点。
        assertEquals(List.of(
                "vars.put(\"WS-FLAG\", 1);",
                "/* missing template: unknown */",
                "/* missing template: unknown */"), result.generatedLines());
    }

    @Test
    void evaluateBecomesAnIfElseChainNotASwitch() {
        // Java は double で switch できず、WHEN にフォールスルーも無い。
        // if (false) を種にした else-if 連鎖であることを、生成テキストで固定する。
        RuleEngine.Result result = apply("cobol-programs-v1", List.of(
                "EVALUATE WS-STATUS",
                "WHEN 1",
                "MOVE 10 TO WS-RESULT",
                "WHEN OTHER",
                "MOVE 99 TO WS-RESULT",
                "END-EVALUATE."));

        assertEquals(List.of(
                "{ double _e0 = num(vars.get(\"WS-STATUS\")); if (false) {",
                "} else if (_e0 == num(1)) {",
                "vars.put(\"WS-RESULT\", num(10));",
                "} else {",
                "vars.put(\"WS-RESULT\", num(99));",
                "} }"), result.generatedLines());
        assertEquals(0, result.coverage().getUnrecognisedLines());
    }

    @Test
    void whenIsOnlyRecognisedInsideAnEvaluateFrame() {
        // requires が「最初にマッチしたものが勝つ」を文脈依存にしている。
        // EVALUATE の外の WHEN はどのルールにもマッチしてはいけない。
        RuleEngine.Result result = apply("cobol-programs-v1", List.of("WHEN 1"));

        assertEquals(1, result.coverage().getUnrecognisedLines());
        assertEquals(List.of("/* missing template: unknown */"), result.generatedLines());
    }

    @Test
    void continueWithReinjectsTheRestOfTheLine() {
        // WHEN と文が同じ行にある形。rest をもう一度ルール表へ通すので2行出る。
        RuleEngine.Result result = apply("cobol-programs-v1", List.of(
                "EVALUATE WS-CODE",
                "WHEN 3 MOVE 7 TO WS-OUT",
                "END-EVALUATE."));

        assertEquals(List.of(
                "{ double _e0 = num(vars.get(\"WS-CODE\")); if (false) {",
                "} else if (_e0 == num(3)) {",
                "vars.put(\"WS-OUT\", num(7));",
                "} }"), result.generatedLines());
    }

    @Test
    void unclosedBlockIsReportedAsAFinding() {
        // ブロックが閉じ切っていないルール表は、生成物がコンパイルできても信用できない。
        RuleEngine.Result result = apply("cobol-programs-v1", List.of(
                "EVALUATE WS-CODE",
                "WHEN 1"));

        assertEquals(1, result.findings().size(), result.findings()::toString);
        assertTrue(result.findings().get(0).startsWith("structure: 1 block(s)"),
                result.findings()::toString);
    }

    @Test
    void balancedBlocksProduceNoFinding() {
        RuleEngine.Result result = apply("cobol-programs-v1", List.of(
                "IF WS-A > WS-B",
                "MOVE 1 TO WS-C",
                "END-IF."));

        assertTrue(result.findings().isEmpty(), result.findings()::toString);
        assertEquals(List.of(
                "if (num(vars.get(\"WS-A\")) > num(vars.get(\"WS-B\"))) {",
                "vars.put(\"WS-C\", num(1));",
                "}"), result.generatedLines());
    }

    @Test
    void firstMatchingRuleWinsSoNarrowRulesMustComeFirst() {
        // move-numeric が move より前に置かれているため、数値リテラルは num() を通る。
        // 順序が入れ替わると DISPLAY の出力形式が "0" と "0.0" で揺れる。
        assertEquals(List.of("vars.put(\"WS-A\", num(5));"),
                apply("cobol-programs-v1", List.of("MOVE 5 TO WS-A.")).generatedLines());
        assertEquals(List.of("vars.put(\"WS-A\", vars.get(\"WS-B\"));"),
                apply("cobol-programs-v1", List.of("MOVE WS-B TO WS-A.")).generatedLines());
    }

    // ---- 仕組みの検査（手書きの最小プロファイル） --------------------------------

    @Test
    void indentTracksBlockDepthAndClosingLinesAlignWithTheirOpener() {
        TemplateProfile profile = profile("""
                { "profile": "indent-test", "version": 1, "rules": [
                  { "id": "open",  "pattern": "^OPEN$",  "template": "${_indent}open {",  "opens": "block" },
                  { "id": "close", "pattern": "^CLOSE$", "template": "${_indent}}",       "closes": "block" },
                  { "id": "body",  "pattern": "^BODY$",  "template": "${_indent}body;" }
                ] }
                """);

        RuleEngine.Result result = RuleEngine.apply(
                RuleEngine.Request.of(profile, List.of("OPEN", "BODY", "OPEN", "BODY", "CLOSE", "CLOSE")));

        assertEquals(List.of(
                "open {",
                "    body;",
                "    open {",
                "        body;",
                "    }",
                "}"), result.generatedLines());
    }

    @Test
    void depthKeepsNestedTemporaryNamesApart() {
        TemplateProfile profile = profile("""
                { "profile": "depth-test", "version": 1, "rules": [
                  { "id": "open",  "pattern": "^OPEN$",  "template": "int _t${_depth} = 0;", "opens": "block" },
                  { "id": "close", "pattern": "^CLOSE$", "template": "end _t${_depth};",     "closes": "block" }
                ] }
                """);

        RuleEngine.Result result = RuleEngine.apply(
                RuleEngine.Request.of(profile, List.of("OPEN", "OPEN", "CLOSE", "CLOSE")));

        assertEquals(List.of("int _t0 = 0;", "int _t1 = 0;", "end _t1;", "end _t0;"),
                result.generatedLines());
    }

    @Test
    void appliesToFileLimitsARuleToMatchingFileNames() {
        TemplateProfile profile = profile("""
                { "profile": "file-test", "version": 1,
                  "artifacts": [ { "name": "out.txt", "sections": ["a", "b"] } ],
                  "rules": [
                    { "id": "only-a", "appliesToFile": ".*\\\\.a$", "pattern": "^X$",
                      "template": "from-a", "emitTo": "out.txt", "section": "a" },
                    { "id": "only-b", "appliesToFile": ".*\\\\.b$", "pattern": "^X$",
                      "template": "from-b", "emitTo": "out.txt", "section": "b" }
                  ] }
                """);

        RuleEngine.Result result = RuleEngine.apply(new RuleEngine.Request(profile, Map.of(), Map.of(),
                List.of(), new java.util.LinkedHashMap<>(Map.of("one.a", List.of("X"))), List.of()));

        // ファイル名が合わないルールは、たとえ先に書いてあってもマッチしない。
        assertEquals(List.of("from-a"), result.artifacts().get("out.txt"));
        assertEquals(Map.of("only-a", 1), result.coverage().getByRule());
    }

    @Test
    void sectionsAreConcatenatedInTheOrderTheArtifactDeclares() {
        TemplateProfile profile = profile("""
                { "profile": "section-test", "version": 1,
                  "artifacts": [ { "name": "out.txt", "sections": ["head", "body"],
                                   "preamble": ["// start"], "epilogue": ["// end"] } ],
                  "rules": [
                    { "id": "body-rule", "pattern": "^B$", "template": "body-line",
                      "emitTo": "out.txt", "section": "body" },
                    { "id": "head-rule", "pattern": "^H$", "template": "head-line",
                      "emitTo": "out.txt", "section": "head" }
                  ] }
                """);

        // 入力の順は B が先。それでも出力は sections の順に並ぶ。
        RuleEngine.Result result = RuleEngine.apply(new RuleEngine.Request(profile, Map.of(), Map.of(),
                List.of(), new java.util.LinkedHashMap<>(Map.of("in.txt", List.of("B", "H"))), List.of()));

        assertEquals(List.of("// start", "head-line", "body-line", "// end"),
                result.artifacts().get("out.txt"));
    }

    @Test
    void unrecognisedLinesAreNeverMixedIntoRoutedArtifacts() {
        // ゴールデン差分の比較対象を汚さないため。未カバーとしては数える。
        TemplateProfile profile = profile("""
                { "profile": "routed-test", "version": 1,
                  "artifacts": [ { "name": "out.txt", "sections": ["body"] } ],
                  "rules": [ { "id": "known", "pattern": "^KNOWN$", "template": "kept",
                               "emitTo": "out.txt", "section": "body" } ] }
                """);

        RuleEngine.Result result = RuleEngine.apply(new RuleEngine.Request(profile,
                Map.of("unknown", "// TODO: ${line}"), Map.of(), List.of(),
                new java.util.LinkedHashMap<>(Map.of("in.txt", List.of("KNOWN", "MYSTERY"))), List.of()));

        assertEquals(List.of("kept"), result.artifacts().get("out.txt"));
        assertEquals(1, result.coverage().getUnrecognisedLines());
    }

    @Test
    void flatModeKeepsUnrecognisedLinesVisibleThroughTheUnknownTemplate() {
        // 平坦方式では逆に、認識できなかった行を捨てない。生成物に痕跡を残す。
        RuleEngine.Result result = RuleEngine.apply(new RuleEngine.Request(
                LIBRARY.require("compilable-v1"), Map.of("unknown", "// TODO: ${line}"),
                Map.of(), List.of("MOVE 1 TO WS-A.", "SORT WS-TABLE."), Map.of(), List.of()));

        assertEquals(List.of("vars.put(\"WS-A\", 1);", "// TODO: SORT WS-TABLE."),
                result.generatedLines());
    }

    @Test
    void withoutAProfileTheInlineTemplateTableDecidesTheOutput() {
        // プロファイル無しでテンプレート表だけを渡す経路（demo-transform.ps1 が使う）。
        List<String> source = List.of("MOVE WS-A TO WS-B.", "ADD 1 TO WS-C.", "DISPLAY 'DONE'.");

        RuleEngine.Result first = RuleEngine.apply(new RuleEngine.Request(null,
                Map.of("move", "${target} = ${source};",
                        "add", "${target} += ${source};",
                        "display", "System.out.println(${value});"),
                Map.of(), source, Map.of(), List.of()));
        RuleEngine.Result second = RuleEngine.apply(new RuleEngine.Request(null,
                Map.of("move", "this.${target} = this.${source};",
                        "add", "this.${target} = this.${target} + ${source};",
                        "display", "log.info(\"{}\", ${value});"),
                Map.of(), source, Map.of(), List.of()));

        assertEquals(List.of("WS-B = WS-A;", "WS-C += 1;", "System.out.println('DONE');"),
                first.generatedLines());
        assertFalse(first.generatedCode().equals(second.generatedCode()),
                "テンプレート表を差し替えたら出力が変わること");
        assertEquals(0, first.coverage().getUnrecognisedLines());
    }

    @Test
    void missingTemplateKeyIsReportedInTheOutputRatherThanSilentlyDropped() {
        RuleEngine.Result result = RuleEngine.apply(new RuleEngine.Request(null,
                Map.of(), Map.of(), List.of("MOVE WS-A TO WS-B."), Map.of(), List.of()));

        assertEquals(List.of("/* missing template: move */"), result.generatedLines());
    }

    @Test
    void noSourceMeansNoWorkAtAll() {
        // 手順D（42項目）のオーケストレーション専用チェーンが通る経路。
        // ここで何かを出すと PERF-01 / CONC-01 / SYNC-* が一斉に落ちる。
        RuleEngine.Result result = RuleEngine.apply(
                RuleEngine.Request.of(LIBRARY.require("compilable-v1"), List.of()));

        assertTrue(result.generatedLines().isEmpty());
        assertTrue(result.artifacts().isEmpty());
        assertTrue(result.findings().isEmpty());
        assertEquals(0, result.coverage().getTotalLines());
    }

    // ---- 補助 -------------------------------------------------------------------

    private static RuleEngine.Result apply(String profileName, List<String> sourceLines) {
        return RuleEngine.apply(RuleEngine.Request.of(LIBRARY.require(profileName), sourceLines));
    }

    private static TemplateProfile profile(String json) {
        try {
            return MAPPER.readValue(json, TemplateProfile.class);
        } catch (Exception e) {
            throw new IllegalArgumentException("テスト用プロファイルが読めない: " + json, e);
        }
    }
}
