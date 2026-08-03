package jp.co.softroad.liteflow.transform;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 生成コードに対する振る舞い検査1件。これらのデータ項目値を入力として生成文を実行したとき、
 * 期待どおりの値（および任意でDISPLAY出力）になることを要求する。
 *
 * <p>この閉ループを意味あるものにしているのがこの検査である。生成テキストを正解テキストと
 * 比較しても「生成器が変わっていない」ことしか示せないが、実行すれば「正しく動く」ことを示せる。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class BehaviourExpectation {
    private String name;
    private Map<String, Object> given = new LinkedHashMap<>();
    private Map<String, Object> expect = new LinkedHashMap<>();
    /** 期待するDISPLAY出力行（順序どおり）。null は「検査しない」を意味する。 */
    private List<String> expectDisplay;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Map<String, Object> getGiven() {
        return given;
    }

    public void setGiven(Map<String, Object> given) {
        this.given = given == null ? new LinkedHashMap<>() : given;
    }

    public Map<String, Object> getExpect() {
        return expect;
    }

    public void setExpect(Map<String, Object> expect) {
        this.expect = expect == null ? new LinkedHashMap<>() : expect;
    }

    public List<String> getExpectDisplay() {
        return expectDisplay;
    }

    public void setExpectDisplay(List<String> expectDisplay) {
        this.expectDisplay = expectDisplay;
    }

    /** 期待値1件をコンパイル済みコードに対して実行した結果。 */
    public static class Result {
        private final String name;
        private final boolean passed;
        private final List<String> mismatches = new ArrayList<>();
        private final Map<String, Object> actual = new LinkedHashMap<>();
        private final List<String> actualDisplay = new ArrayList<>();
        private String error;

        public Result(String name, boolean passed) {
            this.name = name;
            this.passed = passed;
        }

        public String getName() {
            return name;
        }

        public boolean isPassed() {
            return passed;
        }

        public List<String> getMismatches() {
            return mismatches;
        }

        public Map<String, Object> getActual() {
            return actual;
        }

        public List<String> getActualDisplay() {
            return actualDisplay;
        }

        public String getError() {
            return error;
        }

        public void setError(String error) {
            this.error = error;
        }
    }
}
