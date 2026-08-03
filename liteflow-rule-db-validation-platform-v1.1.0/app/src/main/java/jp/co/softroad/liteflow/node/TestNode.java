package jp.co.softroad.liteflow.node;

import com.yomahub.liteflow.annotation.LiteflowComponent;
import jp.co.softroad.liteflow.model.MigrationContext;
import jp.co.softroad.liteflow.transform.BehaviourExpectation;
import jp.co.softroad.liteflow.transform.CompileOutcome;
import jp.co.softroad.liteflow.transform.GeneratedProgramCompiler;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * コンパイル済みコードを振る舞い期待値に対して実行する。
 *
 * <p>生成テキストを正解テキストと比較しても「生成器が変わっていない」ことしか示せない。
 * 実際の入力で動かして結果のデータ項目を検査して初めて正しさについて何か言える。
 * ここで行っているのはその検査である。
 *
 * <p>数値は数値として比較する（COBOLの 1 とJavaの 1.0 は同じ値）。それ以外は文字列として比較する。
 *
 * <p><b>実行は必ず別スレッドで時間制限をかける。</b> 生成コードは信頼できない。
 * ルール表の書き間違いで {@code while (true) {}} が出てしまえば、リクエストスレッドが
 * 永久に戻らなくなる。生成ハーネスの歩数計は段落を跨いだときしか進まないので、
 * 段落を活性化しない無限ループは歩数計では止まらない。ここが最後の砦である。
 */
@LiteflowComponent("test")
public class TestNode extends AbstractTraceNode {
    private static final double EPSILON = 1e-9;
    /** 1ケースあたりの実行時間の上限。超えたらそのケースを失敗として記録する。 */
    private static final long EXECUTION_TIMEOUT_SECONDS = 10L;

    @Override
    public void process() throws Exception {
        mark("test");

        MigrationContext context = getContextBean(MigrationContext.class);
        List<BehaviourExpectation> expectations = context.getExpectations();
        CompileOutcome compiled = context.getCompileOutcome();
        if (expectations.isEmpty() || compiled == null || !compiled.isSuccess()) {
            return;  // 実行対象が無いか、既にコンパイルが失敗している。報告は品質ゲートが行う
        }

        // 入口クラスとメソッド。段落方式のプログラムは runAsMain、従来の平坦方式は run。
        String entryClass = context.getEntryClassName() != null
                ? context.getEntryClassName() : GeneratedProgramCompiler.CLASS_NAME;
        URL classesUrl = context.getWorkDir().resolve("classes").toUri().toURL();
        try (URLClassLoader loader = new URLClassLoader(new URL[]{classesUrl},
                GeneratedProgramCompiler.class.getClassLoader())) {
            Class<?> clazz = loader.loadClass(entryClass);
            Method run;
            try {
                run = clazz.getMethod("runAsMain", Map.class, List.class);
            } catch (NoSuchMethodException e) {
                run = clazz.getMethod("run", Map.class, List.class);
            }
            for (BehaviourExpectation expectation : expectations) {
                context.addTestResult(evaluate(run, expectation));
            }
        }
    }

    private BehaviourExpectation.Result evaluate(Method run, BehaviourExpectation expectation) {
        Map<String, Object> vars = new LinkedHashMap<>(expectation.getGiven());
        List<String> display = new ArrayList<>();
        List<String> mismatches = new ArrayList<>();

        try {
            invokeWithTimeout(run, vars, display);
        } catch (ReflectiveOperationException | RuntimeException | TimeoutException e) {
            BehaviourExpectation.Result failure =
                    new BehaviourExpectation.Result(expectation.getName(), false);
            Throwable cause = e instanceof InvocationTargetException ite && ite.getCause() != null
                    ? ite.getCause() : e;
            failure.setError(cause.toString());
            failure.getActual().putAll(vars);
            failure.getActualDisplay().addAll(display);
            return failure;
        }

        expectation.getExpect().forEach((key, expected) -> {
            Object actual = vars.get(key);
            if (!valuesMatch(expected, actual)) {
                mismatches.add(key + ": expected " + expected + " but was " + actual);
            }
        });
        if (expectation.getExpectDisplay() != null
                && !expectation.getExpectDisplay().equals(display)) {
            mismatches.add("DISPLAY output: expected " + expectation.getExpectDisplay()
                    + " but was " + display);
        }

        BehaviourExpectation.Result result =
                new BehaviourExpectation.Result(expectation.getName(), mismatches.isEmpty());
        result.getMismatches().addAll(mismatches);
        result.getActual().putAll(vars);
        result.getActualDisplay().addAll(display);
        return result;
    }

    /**
     * 生成コードを使い捨てスレッドで実行し、時間制限をかける。
     *
     * <p>タイムアウトしたスレッドは {@code Thread.interrupt()} では止まらない
     * （生成コードは割り込みを見ない）。デーモンスレッドにしてあるので、
     * 最悪でもJVMの終了を妨げることはない。呼び出し側にはケース失敗として返る。
     */
    private void invokeWithTimeout(Method run, Map<String, Object> vars, List<String> display)
            throws ReflectiveOperationException, TimeoutException {
        ExecutorService executor = Executors.newSingleThreadExecutor(task -> {
            Thread thread = new Thread(task, "generated-code-runner");
            thread.setDaemon(true);
            return thread;
        });
        try {
            Future<?> future = executor.submit(() -> {
                run.invoke(null, vars, display);
                return null;
            });
            try {
                future.get(EXECUTION_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            } catch (TimeoutException e) {
                future.cancel(true);
                throw new TimeoutException("generated code did not finish within "
                        + EXECUTION_TIMEOUT_SECONDS + "s; suspected infinite loop in the generated program");
            } catch (java.util.concurrent.ExecutionException e) {
                Throwable cause = e.getCause();
                if (cause instanceof ReflectiveOperationException reflective) {
                    throw reflective;
                }
                if (cause instanceof RuntimeException runtime) {
                    throw runtime;
                }
                throw new IllegalStateException(cause);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("interrupted while running generated code", e);
            }
        } finally {
            executor.shutdownNow();
        }
    }

    private boolean valuesMatch(Object expected, Object actual) {
        Double expectedNumber = asNumber(expected);
        Double actualNumber = asNumber(actual);
        if (expectedNumber != null && actualNumber != null) {
            return Math.abs(expectedNumber - actualNumber) < EPSILON;
        }
        return String.valueOf(expected).equals(String.valueOf(actual));
    }

    private Double asNumber(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        if (value == null) {
            return null;
        }
        try {
            return Double.valueOf(String.valueOf(value).trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
