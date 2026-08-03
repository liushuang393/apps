package jp.co.softroad.liteflow;

import jp.co.softroad.liteflow.transform.CobolProgram;
import jp.co.softroad.liteflow.transform.CompileOutcome;
import jp.co.softroad.liteflow.transform.GeneratedProgramCompiler;
import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 段落ディスパッチ方式の生成ハーネスを、ルール表を一切通さず直接検証する。
 *
 * <p>Spring も LiteFlow も使わない。COBOLの制御構造をJavaへ落とすときの
 * 難所（GO TO、PERFORM THRU、PERFORM の中の STOP RUN、GOBACK、CALL の LINKAGE 束縛、
 * 暴走ループ）が骨格の段階で正しいことを、ルールを書き始める前に固めるためのテストである。
 *
 * <p>ここが緑でないと、後段のコーパスが落ちたときに「ルールが悪いのか骨格が悪いのか」を
 * 切り分けられなくなる。
 */
class GeneratedProgramHarnessTest {

    /** 生成した複数プログラムをコンパイルし、入口プログラムを実際に実行する。 */
    private Result run(List<CobolProgram> programs, String entry, Map<String, Object> given)
            throws Exception {
        Path workDir = Files.createTempDirectory("harness-test-");
        try {
            Map<String, String> sources = new LinkedHashMap<>();
            sources.put(GeneratedProgramCompiler.RUNTIME_CLASS_NAME,
                    GeneratedProgramCompiler.buildRuntimeSource());
            for (CobolProgram program : programs) {
                sources.put(program.getClassName(), GeneratedProgramCompiler.buildProgramSource(program));
            }
            Path classes = workDir.resolve("classes");
            CompileOutcome outcome = GeneratedProgramCompiler.compileUnits(sources, classes, List.of());
            assertTrue(outcome.isCompilerAvailable(), "JDK が必要です（JREでは実行できません）");
            assertTrue(outcome.isSuccess(),
                    () -> "コンパイル失敗: " + outcome.getFailureReason() + "\n" + outcome.getSource());

            try (URLClassLoader loader = new URLClassLoader(
                    new URL[]{classes.toUri().toURL()}, getClass().getClassLoader())) {
                Class<?> clazz = loader.loadClass(GeneratedProgramCompiler.PACKAGE + "." + entry);
                Method method = clazz.getMethod("runAsMain", Map.class, List.class);
                Map<String, Object> vars = new LinkedHashMap<>(given);
                List<String> display = new ArrayList<>();
                try {
                    method.invoke(null, vars, display);
                } catch (InvocationTargetException e) {
                    throw (Exception) e.getCause();
                }
                return new Result(vars, display);
            }
        } finally {
            GeneratedProgramCompiler.deleteRecursively(workDir);
        }
    }

    private record Result(Map<String, Object> vars, List<String> display) {
    }

    private static CobolProgram program(String id) {
        return new CobolProgram(id);
    }

    /** 段落を宣言して文を並べる。{@code List.add} は boolean を返すので連鎖できない。 */
    private static void para(CobolProgram program, String label, String... statements) {
        program.declareParagraph(label).addAll(List.of(statements));
    }

    private static double numberOf(Object value) {
        return ((Number) value).doubleValue();
    }

    @Test
    void paragraphsFallThroughInSourceOrder() throws Exception {
        CobolProgram main = program("MAINPGM");
        para(main, "FIRST-PARA", "out.add(\"first\");");
        para(main, "SECOND-PARA", "out.add(\"second\");");
        para(main, "THIRD-PARA", "out.add(\"third\");");

        Result result = run(List.of(main), "MAINPGM", Map.of());

        assertEquals(List.of("first", "second", "third"), result.display());
    }

    @Test
    void goToJumpsForwardAndSkipsInterveningParagraphs() throws Exception {
        CobolProgram main = program("MAINPGM");
        para(main, "A-PARA", "out.add(\"a\");", "return \"C-PARA\";");
        para(main, "B-PARA", "out.add(\"b\");");
        para(main, "C-PARA", "out.add(\"c\");");

        Result result = run(List.of(main), "MAINPGM", Map.of());

        assertEquals(List.of("a", "c"), result.display(), "GO TO で B-PARA を飛ばすこと");
    }

    @Test
    void goToBackwardsFormsALoop() throws Exception {
        CobolProgram main = program("MAINPGM");
        main.getWorkingStorage().put("WS-I", "0d");
        para(main, "LOOP-PARA",
                "vars.put(\"WS-I\", num(vars.get(\"WS-I\")) + 1);",
                "if (num(vars.get(\"WS-I\")) < 3) { return \"LOOP-PARA\"; }");
        para(main, "DONE-PARA", "out.add(\"i=\" + num(vars.get(\"WS-I\")));");

        Result result = run(List.of(main), "MAINPGM", Map.of());

        assertEquals(List.of("i=3.0"), result.display());
    }

    @Test
    void performThruRunsOnlyTheRangeAndReturns() throws Exception {
        CobolProgram main = program("MAINPGM");
        para(main, "MAIN-PARA",
                "perform(vars, out, \"X-PARA\", \"Y-PARA\");",
                "out.add(\"back\");",
                "stopRun();");
        para(main, "X-PARA", "out.add(\"x\");");
        para(main, "Y-PARA", "out.add(\"y\");");
        para(main, "Z-PARA", "out.add(\"z\");");

        Result result = run(List.of(main), "MAINPGM", Map.of());

        assertEquals(List.of("x", "y", "back"), result.display(),
                "PERFORM X THRU Y は Z を実行せず、呼び出し元へ戻ること");
    }

    @Test
    void performUntilEvaluatesTheConditionBeforeEachIteration() throws Exception {
        CobolProgram main = program("MAINPGM");
        main.getWorkingStorage().put("WS-N", "0d");
        para(main, "MAIN-PARA",
                "while (!(num(vars.get(\"WS-N\")) >= 3)) "
                        + "{ perform(vars, out, \"ADD-PARA\", \"ADD-PARA\"); }",
                "stopRun();");
        para(main, "ADD-PARA",
                "vars.put(\"WS-N\", num(vars.get(\"WS-N\")) + 1);",
                "out.add(\"n=\" + num(vars.get(\"WS-N\")));");

        Result alreadyDone = run(List.of(main), "MAINPGM", Map.of("WS-N", 3));
        assertTrue(alreadyDone.display().isEmpty(),
                "WITH TEST BEFORE。最初から条件成立なら1回も回らないこと");

        Result looped = run(List.of(main), "MAINPGM", Map.of("WS-N", 1));
        assertEquals(List.of("n=2.0", "n=3.0"), looped.display());
    }

    @Test
    void stopRunInsideAPerformedParagraphTerminatesTheWholeProgram() throws Exception {
        CobolProgram main = program("MAINPGM");
        para(main, "MAIN-PARA",
                "perform(vars, out, \"HALT-PARA\", \"HALT-PARA\");",
                "out.add(\"must-not-appear\");");
        para(main, "HALT-PARA", "out.add(\"halting\");", "stopRun();");
        para(main, "TAIL-PARA", "out.add(\"must-not-appear-either\");");

        Result result = run(List.of(main), "MAINPGM", Map.of());

        assertEquals(List.of("halting"), result.display(),
                "STOP RUN は PERFORM の内側からでも実行全体を止めること");
    }

    @Test
    void stopRunInsideASubprogramTerminatesTheCallerToo() throws Exception {
        CobolProgram sub = program("SUBHALT");
        sub.getLinkage().add("LK-V");
        para(sub, "SUB-PARA", "out.add(\"sub\");", "stopRun();");

        CobolProgram main = program("MAINPGM");
        para(main, "MAIN-PARA",
                "generated.SUBHALT.call(vars, out, \"WS-V\");",
                "out.add(\"must-not-appear\");");

        Result result = run(List.of(main, sub), "MAINPGM", Map.of("WS-V", 1));

        assertEquals(List.of("sub"), result.display(),
                "STOP RUN の信号は全プログラムで共有されていること");
    }

    @Test
    void gobackFromASubprogramReturnsToTheCallerWithoutStoppingTheRun() throws Exception {
        CobolProgram sub = program("SUBPGM");
        sub.getLinkage().add("LK-VALUE");
        para(sub, "SUB-PARA",
                "out.add(\"sub:\" + num(vars.get(\"LK-VALUE\")));",
                "vars.put(\"LK-VALUE\", num(vars.get(\"LK-VALUE\")) * 2);",
                "goback();");
        para(sub, "SUB-TAIL", "out.add(\"must-not-appear\");");

        CobolProgram main = program("MAINPGM");
        para(main, "MAIN-PARA",
                "generated.SUBPGM.call(vars, out, \"WS-AMOUNT\");",
                "out.add(\"after:\" + num(vars.get(\"WS-AMOUNT\")));");

        Result result = run(List.of(main, sub), "MAINPGM", Map.of("WS-AMOUNT", 21));

        assertEquals(List.of("sub:21.0", "after:42.0"), result.display(),
                "GOBACK は呼び出し元へ戻るだけで、実行全体は止めないこと");
        assertEquals(42.0, numberOf(result.vars().get("WS-AMOUNT")), 1e-9);
    }

    @Test
    void callBindsLinkageByPositionAndIsolatesWorkingStorage() throws Exception {
        CobolProgram sub = program("SUBCALC");
        sub.getLinkage().add("LK-A");
        sub.getLinkage().add("LK-RESULT");
        sub.getWorkingStorage().put("WS-TEMP", "999d");
        para(sub, "CALC-PARA",
                "vars.put(\"WS-TEMP\", num(vars.get(\"LK-A\")) + 1);",
                "vars.put(\"LK-RESULT\", num(vars.get(\"WS-TEMP\")) * 10);");

        CobolProgram main = program("MAINPGM");
        main.getWorkingStorage().put("WS-TEMP", "7d");
        para(main, "MAIN-PARA",
                "generated.SUBCALC.call(vars, out, \"WS-IN\", \"WS-OUT\");",
                "out.add(\"temp=\" + num(vars.get(\"WS-TEMP\")));");

        Result result = run(List.of(main, sub), "MAINPGM", Map.of("WS-IN", 4, "WS-OUT", 0));

        assertEquals(50.0, numberOf(result.vars().get("WS-OUT")), 1e-9,
                "LINKAGE は位置で束縛され、結果は呼び出し元へ書き戻されること");
        assertEquals(List.of("temp=7.0"), result.display(),
                "同名の WS-TEMP があっても呼び出し元の値が壊れないこと");
    }

    @Test
    void callWithWrongArgumentCountFailsLoudly() {
        CobolProgram sub = program("SUBPGM");
        sub.getLinkage().add("LK-A");
        sub.getLinkage().add("LK-B");
        para(sub, "SUB-PARA", "out.add(\"never\");");

        CobolProgram main = program("MAINPGM");
        para(main, "MAIN-PARA", "generated.SUBPGM.call(vars, out, \"WS-ONLY\");");

        Exception thrown = assertThrows(Exception.class,
                () -> run(List.of(main, sub), "MAINPGM", Map.of("WS-ONLY", 1)));
        assertInstanceOf(IllegalStateException.class, thrown);
        assertTrue(thrown.getMessage().contains("expected 2 argument(s) but got 1"), thrown.getMessage());
    }

    @Test
    void unknownParagraphLabelFailsInsteadOfSilentlyReturning() {
        CobolProgram main = program("MAINPGM");
        para(main, "MAIN-PARA", "return \"TYPO-PARA\";");

        Exception thrown = assertThrows(Exception.class,
                () -> run(List.of(main), "MAINPGM", Map.of()));
        assertInstanceOf(IllegalStateException.class, thrown);
        assertTrue(thrown.getMessage().contains("unknown paragraph: TYPO-PARA"), thrown.getMessage());
    }

    @Test
    void performThruWithABackwardsRangeFailsLoudly() {
        CobolProgram main = program("MAINPGM");
        para(main, "MAIN-PARA", "perform(vars, out, \"B-PARA\", \"A-PARA\");");
        para(main, "A-PARA", "out.add(\"a\");");
        para(main, "B-PARA", "out.add(\"b\");");

        Exception thrown = assertThrows(Exception.class,
                () -> run(List.of(main), "MAINPGM", Map.of()));
        assertInstanceOf(IllegalStateException.class, thrown);
        assertTrue(thrown.getMessage().contains("range runs backwards"), thrown.getMessage());
    }

    @Test
    void runawayLoopIsStoppedByTheSharedStepCounter() {
        CobolProgram main = program("MAINPGM");
        // WS-I を増やし忘れた PERFORM UNTIL。歩数計が static でないと永久に止まらない。
        main.getWorkingStorage().put("WS-I", "0d");
        para(main, "MAIN-PARA",
                "while (!(num(vars.get(\"WS-I\")) > 10)) "
                        + "{ perform(vars, out, \"NOOP-PARA\", \"NOOP-PARA\"); }");
        para(main, "NOOP-PARA", "vars.put(\"WS-DUMMY\", 1);");

        Exception thrown = assertThrows(Exception.class,
                () -> run(List.of(main), "MAINPGM", Map.of()));
        assertInstanceOf(IllegalStateException.class, thrown);
        assertTrue(thrown.getMessage().contains("runaway execution"), thrown.getMessage());
    }

    @Test
    void workingStorageValuesDoNotClobberSuppliedInputs() throws Exception {
        CobolProgram main = program("MAINPGM");
        main.getWorkingStorage().put("WS-A", "1d");
        main.getWorkingStorage().put("WS-B", "2d");
        para(main, "MAIN-PARA",
                "out.add(\"a=\" + num(vars.get(\"WS-A\")) + \",b=\" + num(vars.get(\"WS-B\")));");

        Result result = run(List.of(main), "MAINPGM", Map.of("WS-A", 99));

        assertEquals(List.of("a=99.0,b=2.0"), result.display(),
                "VALUE 句は putIfAbsent。given が渡された項目は上書きしないこと");
    }

    @Test
    void evaluateLowersToAnIfElseChainThatCompiles() throws Exception {
        // EVALUATE は switch にできない（Javaは double で switch できず、WHEN に
        // フォールスルーも無い）。if(false) を種にした else-if 連鎖で表現する。
        CobolProgram main = program("MAINPGM");
        para(main, "MAIN-PARA",
                "{ double _e0 = num(vars.get(\"WS-STATUS\")); if (false) {}",
                "else if (_e0 == num(1)) {",
                "vars.put(\"WS-MSG\", \"ONE\");",
                "}",
                "else if (_e0 == num(2)) {",
                "vars.put(\"WS-MSG\", \"TWO\");",
                "}",
                "else {",
                "vars.put(\"WS-MSG\", \"OTHER\");",
                "}",
                "}",
                "out.add(String.valueOf(vars.get(\"WS-MSG\")));");

        assertEquals(List.of("TWO"), run(List.of(main), "MAINPGM", Map.of("WS-STATUS", 2)).display());
        assertEquals(List.of("OTHER"), run(List.of(main), "MAINPGM", Map.of("WS-STATUS", 9)).display());
    }
}
