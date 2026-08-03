package jp.co.softroad.liteflow.transform;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * プロファイルを指定しないリクエスト向けの、テンプレート表だけによる変換。
 *
 * <p>{@code /api/flows/{chain}/execute} に {@code templates} を直接渡す経路
 * （{@code demo-transform.ps1} が使う「テンプレートを差し替えると出力が変わる」の実演）と、
 * どのルールにもマッチしなかった行の {@code unknown} フォールバックがこれを使う。
 *
 * <p>{@link TemplateRenderer} とは<b>意味が違う</b>ので統合してはいけない。
 * こちらは {@code $\{} のエスケープを解釈せず、名前付きグループの派生変数も作らない。
 * {@link jp.co.softroad.liteflow.model.MigrationContext#render} が Rule-DB の Groovy
 * スクリプトへ公開している描画規則そのものであり、勝手に変えると保存済みの本文が壊れる。
 */
public final class InlineTemplates {
    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{([A-Za-z0-9_]+)}");

    private InlineTemplates() {
    }

    /**
     * {@code ${name}} を置換する。
     *
     * <p>未知のテンプレートキーや未解決のプレースホルダは黙って捨てず出力に残す。
     * 設定ミスのあるルールが生成コード上で一目で分かるようにするためである。
     *
     * @param template 本文。null なら「テンプレートが無い」ことを示すコメントを返す
     * @param key      テンプレートキー。エラー表示にのみ使う
     */
    public static String render(String template, String key, Map<String, String> variables) {
        if (template == null) {
            return "/* missing template: " + key + " */";
        }
        Matcher matcher = PLACEHOLDER.matcher(template);
        StringBuilder result = new StringBuilder();
        while (matcher.find()) {
            String name = matcher.group(1);
            String value = variables == null ? null : variables.get(name);
            matcher.appendReplacement(result,
                    Matcher.quoteReplacement(value == null ? "${" + name + "}" : value));
        }
        matcher.appendTail(result);
        return result.toString();
    }

    /** インラインテンプレート経路が解釈する3形式。<b>宣言順がマッチ順</b>である。 */
    public enum Form {
        MOVE("move", "^MOVE\\s+(\\S+)\\s+TO\\s+(\\S+?)\\.?$", "source", "target"),
        ADD("add", "^ADD\\s+(\\S+)\\s+TO\\s+(\\S+?)\\.?$", "source", "target"),
        DISPLAY("display", "^DISPLAY\\s+(.+?)\\.?$", "value");

        private final String key;
        private final Pattern pattern;
        private final String[] names;

        Form(String key, String regex, String... names) {
            this.key = key;
            this.pattern = Pattern.compile(regex, Pattern.CASE_INSENSITIVE);
            this.names = names;
        }

        public String key() {
            return key;
        }

        public Matcher matcher(String line) {
            return pattern.matcher(line);
        }

        public Map<String, String> variables(Matcher matcher) {
            Map<String, String> variables = new LinkedHashMap<>();
            for (int i = 0; i < names.length; i++) {
                variables.put(names[i], matcher.group(i + 1));
            }
            return variables;
        }
    }
}
