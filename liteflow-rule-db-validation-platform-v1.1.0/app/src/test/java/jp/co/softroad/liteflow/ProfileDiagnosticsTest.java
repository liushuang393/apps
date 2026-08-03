package jp.co.softroad.liteflow;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jp.co.softroad.liteflow.transform.ProfileDiagnostic;
import jp.co.softroad.liteflow.transform.ProfileDiagnostics;
import jp.co.softroad.liteflow.transform.ProfileValidator;
import jp.co.softroad.liteflow.transform.TemplateLibrary;
import jp.co.softroad.liteflow.transform.TemplateProfile;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * ルール表の診断。
 *
 * <p>2方向から固定する。
 * <ol>
 *   <li><b>同梱プロファイル4本は ERROR 0 件</b> — 誤検知が1件でもあれば診断は使われなくなる</li>
 *   <li><b>壊した書き方はきちんと名指しされる</b> — 実際に踏んだ不具合の型を並べてある</li>
 * </ol>
 */
class ProfileDiagnosticsTest {
    private static final ObjectMapper MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    private static final TemplateLibrary LIBRARY = new TemplateLibrary("");

    @Test
    void everyPackagedProfileIsClean() {
        List<ProfileDiagnostics> all = LIBRARY.allDiagnostics();
        assertEquals(4, all.size(), () -> "同梱プロファイルは4本のはず: " + all);
        all.forEach(result -> assertTrue(result.errors().isEmpty(),
                () -> result.profile() + " に ERROR がある:\n  "
                        + String.join("\n  ", result.errors().stream()
                        .map(ProfileDiagnostic::toString).toList())));
    }

    // ---- 実際に踏んだ不具合の型 ---------------------------------------------------

    @Test
    void misspelledFieldIsNamed() {
        // appliesToFiles（複数形）は黙って無視され、そのルールが全ファイルに適用される。
        List<ProfileDiagnostic> items = validate("""
                { "profile": "x", "version": 1, "rules": [
                  { "id": "r", "appliesToFiles": ".*\\\\.cbl$", "pattern": "^A$", "template": "a" }
                ] }
                """);

        assertEquals(1, items.size(), items::toString);
        assertEquals("unknown-field", items.get(0).code());
        assertTrue(items.get(0).message().contains("appliesToFile"),
                "正しい綴りを示すこと: " + items.get(0).message());
    }

    @Test
    void invalidRegexIsFoundBeforeItThrowsAtRuntime() {
        List<ProfileDiagnostic> items = validate("""
                { "profile": "x", "version": 1, "rules": [
                  { "id": "r", "pattern": "^A(?<bad$", "template": "a" }
                ] }
                """);

        assertEquals(1, items.size(), items::toString);
        assertEquals("bad-regex", items.get(0).code());
    }

    @Test
    void unresolvableVariableIsFound() {
        // ${targt} は名前付きグループにも facts にも無い。生成物に ${targt} が現れる。
        List<ProfileDiagnostic> items = validate("""
                { "profile": "x", "version": 1, "rules": [
                  { "id": "r", "pattern": "^MOVE (?<target>\\\\S+)$", "template": "put(${targt});" }
                ] }
                """);

        assertEquals(1, items.size(), items::toString);
        assertEquals("unresolved-variable", items.get(0).code());
    }

    @Test
    void derivedVariablesAndBuiltInsAreAccepted() {
        // ${gJava} / ${gExpr} / ${gMapped} / ${gList} / ${gExprList} / ${_indent} / ${_depth}
        assertTrue(validate("""
                { "profile": "x", "version": 1, "rules": [
                  { "id": "r", "pattern": "^CALL (?<args>.+)$",
                    "template": "${_indent}f(${argsList}, ${argsExprList}, ${argsJava}, ${argsExpr}, ${argsMapped}, ${_depth});" }
                ] }
                """).isEmpty());
    }

    @Test
    void thymeleafEscapeIsNotMistakenForAPlaceholder() {
        // $\{form} はリテラルの ${form} を出すエスケープ。誤検知してはいけない。
        assertTrue(validate("""
                { "profile": "x", "version": 1, "rules": [
                  { "id": "r", "pattern": "^F$", "template": "<form th:object=\\"$\\\\{form}\\">" }
                ] }
                """).isEmpty());
    }

    @Test
    void frameOpenedButNeverClosedIsFound() {
        List<ProfileDiagnostic> items = validate("""
                { "profile": "x", "version": 1, "rules": [
                  { "id": "open", "pattern": "^IF$", "template": "if (x) {", "opens": "if" }
                ] }
                """);

        assertEquals(1, items.size(), items::toString);
        assertEquals("unclosed-frame", items.get(0).code());
    }

    @Test
    void ruleRequiringAFrameNobodyOpensIsFound() {
        List<ProfileDiagnostic> items = validate("""
                { "profile": "x", "version": 1, "rules": [
                  { "id": "when", "pattern": "^WHEN$", "template": "} else {", "requires": "evaluate" }
                ] }
                """);

        assertEquals(1, items.size(), items::toString);
        assertEquals("unopened-frame", items.get(0).code());
    }

    @Test
    void ruleHiddenByAnEarlierIdenticalPatternIsFound() {
        // 「配列順に評価され最初にマッチしたものが勝つ」の裏側。後ろのルールは死んでいる。
        List<ProfileDiagnostic> items = validate("""
                { "profile": "x", "version": 1, "rules": [
                  { "id": "broad",  "pattern": "^MOVE (?<s>\\\\S+)$", "template": "broad" },
                  { "id": "narrow", "pattern": "^MOVE (?<s>\\\\S+)$", "template": "narrow" }
                ] }
                """);

        assertEquals(1, items.size(), items::toString);
        assertEquals("shadowed-rule", items.get(0).code());
        assertTrue(items.get(0).target().contains("narrow"), items.get(0)::toString);
    }

    @Test
    void emitToWithoutAMatchingArtifactIsFound() {
        List<ProfileDiagnostic> items = validate("""
                { "profile": "x", "version": 1,
                  "artifacts": [ { "name": "Right.java", "sections": ["body"] } ],
                  "rules": [ { "id": "r", "pattern": "^A$", "template": "a",
                               "emitTo": "Wrong.java", "section": "body" } ] }
                """);

        assertTrue(items.stream().anyMatch(item -> item.code().equals("unknown-artifact")),
                items::toString);
    }

    @Test
    void continueWithPointingAtNoGroupIsFound() {
        List<ProfileDiagnostic> items = validate("""
                { "profile": "x", "version": 1, "rules": [
                  { "id": "r", "pattern": "^WHEN (?<value>\\\\S+) (?<rest>.+)$",
                    "template": "w", "continueWith": "tail" }
                ] }
                """);

        assertTrue(items.stream().anyMatch(item -> item.code().equals("unknown-group")),
                items::toString);
    }

    @Test
    void duplicateRuleIdIsFound() {
        List<ProfileDiagnostic> items = validate("""
                { "profile": "x", "version": 1, "rules": [
                  { "id": "same", "pattern": "^A$", "template": "a" },
                  { "id": "same", "pattern": "^B$", "template": "b" }
                ] }
                """);

        assertTrue(items.stream().anyMatch(item -> item.code().equals("duplicate-id")),
                items::toString);
    }

    @Test
    void missingTemplateIsFoundButEmptyTemplateIsAllowed() {
        assertTrue(validate("""
                { "profile": "x", "version": 1, "rules": [
                  { "id": "no-template", "pattern": "^A$" } ] }
                """).stream().anyMatch(item -> item.code().equals("missing-field")));

        // 空文字は「認識して捨てる」という意図の宣言なので誤りではない。
        assertTrue(validate("""
                { "profile": "x", "version": 1, "rules": [
                  { "id": "discard", "pattern": "^A$", "template": "" } ] }
                """).isEmpty());
    }

    @Test
    void unknownStructureKindIsFound() {
        List<ProfileDiagnostic> items = validate("""
                { "profile": "x", "version": 1,
                  "structure": [ { "id": "s", "pattern": "^P$", "kind": "paragrph" } ] }
                """);

        assertTrue(items.stream().anyMatch(item -> item.code().equals("unknown-kind")),
                items::toString);
    }

    @Test
    void unusedRulesAreListedFromARealRun() {
        TemplateProfile profile = LIBRARY.require("compilable-v1");

        List<ProfileDiagnostic> unused = ProfileValidator.unusedRules(profile,
                java.util.Set.of("move", "add"));

        assertFalse(unused.isEmpty());
        assertTrue(unused.stream().allMatch(item -> item.code().equals("unused-rule")));
        assertTrue(unused.stream().noneMatch(item -> item.target().contains("move")),
                unused::toString);
    }

    // ---- 補助 -------------------------------------------------------------------

    private static List<ProfileDiagnostic> validate(String json) {
        try {
            TemplateProfile profile = MAPPER.readValue(json, TemplateProfile.class);
            JsonNode raw = MAPPER.readTree(json);
            return ProfileValidator.validate(profile, raw).items();
        } catch (Exception e) {
            throw new IllegalArgumentException("テスト用プロファイルが読めない: " + json, e);
        }
    }
}
