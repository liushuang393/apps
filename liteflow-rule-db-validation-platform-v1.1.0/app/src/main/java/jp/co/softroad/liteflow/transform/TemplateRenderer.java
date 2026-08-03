package jp.co.softroad.liteflow.transform;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 正規表現のマッチ結果をテンプレート変数へ変換し、テンプレートを描画する。
 *
 * <p>ルールのパターンに含まれる名前付きグループ {@code g} ごとに、4つの変数が使える。
 * <ul>
 *   <li>{@code ${g}} - マッチした文字列そのまま</li>
 *   <li>{@code ${gJava}} - Java安全形式。識別子は非単語文字を {@code _} に置換し、
 *       数値リテラルはそのまま、引用符付きCOBOLリテラルはJava文字列リテラルにする</li>
 *   <li>{@code ${gExpr}} - 値を返すJava式。リテラルはそのまま、識別子は
 *       {@code vars.get("NAME")} になる</li>
 *   <li>{@code ${gMapped}} - プロファイルの {@code maps.g} で変換した文字列。演算子に使う。
 *       対応表に無い場合は元の文字列を返す</li>
 *   <li>{@code ${gList}} - 空白区切りのトークン列をJava文字列リテラルのカンマ区切りにしたもの。
 *       {@code A B C} なら {@code "A", "B", "C"}。{@code CALL 'SUB' USING A B C} のように
 *       オペランド数が可変の構文で使う。これが無いと可変長オペランドをJavaに
 *       ハードコードするしかなくなり、本PoCの主張（ルール表だけで変換できる）が崩れる</li>
 *   <li>{@code ${gExprList}} - 同じくトークン列だが、各トークンを {@code ${gExpr}} と同じ
 *       「値を返すJava式」に変換したもの</li>
 * </ul>
 *
 * <p>解決できなかったプレースホルダは意図的に出力へ残す。設定ミスのあるルールが
 * 生成コードに現れ（そしてコンパイルゲートで落ち）、それらしく見える誤った出力を
 * 黙って生むことがないようにするためである。
 */
public final class TemplateRenderer {
    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{([A-Za-z0-9_]+)}");
    private static final Pattern GROUP_NAME = Pattern.compile("\\(\\?<([A-Za-z][A-Za-z0-9]*)>");
    private static final Pattern NUMERIC = Pattern.compile("^[+-]?\\d+(?:\\.\\d+)?$");

    private TemplateRenderer() {
    }

    /** パターン文字列から名前付きグループ名を抽出する。{@link Pattern} は名前を公開しないため。 */
    public static List<String> groupNames(String pattern) {
        Matcher matcher = GROUP_NAME.matcher(pattern);
        List<String> names = new java.util.ArrayList<>();
        while (matcher.find()) {
            names.add(matcher.group(1));
        }
        return names;
    }

    public static Map<String, String> variables(TransformRule rule, Matcher matcher,
                                                Map<String, Map<String, String>> maps) {
        return variables(rule.getPattern(), matcher, maps);
    }

    /** ルールを持たない呼び出し元（{@code structure} / {@code facts} 規則）向けの同じ処理。 */
    public static Map<String, String> variables(String pattern, Matcher matcher,
                                                Map<String, Map<String, String>> maps) {
        Map<String, String> variables = new LinkedHashMap<>();
        for (String name : groupNames(pattern)) {
            String raw;
            try {
                raw = matcher.group(name);
            } catch (IllegalArgumentException | IllegalStateException e) {
                continue;
            }
            if (raw == null) {
                continue;
            }
            raw = raw.trim();
            variables.put(name, raw);
            variables.put(name + "Java", javaForm(raw));
            variables.put(name + "Expr", javaExpression(raw));
            variables.put(name + "Mapped", mapped(name, raw, maps));
            variables.put(name + "List", tokenList(raw, false));
            variables.put(name + "ExprList", tokenList(raw, true));
        }
        return variables;
    }

    /**
     * 空白区切りのトークン列を、カンマ区切りのJava式リストにする。
     *
     * @param asExpression true なら各トークンを {@link #javaExpression} に通す。
     *                     false なら Java文字列リテラルにする（引数名をそのまま渡す用途）
     */
    private static String tokenList(String raw, boolean asExpression) {
        StringBuilder sb = new StringBuilder();
        for (String token : raw.trim().split("\\s+")) {
            if (token.isEmpty()) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append(", ");
            }
            sb.append(asExpression ? javaExpression(token) : javaStringLiteral(token));
        }
        return sb.toString();
    }

    /**
     * テンプレートを描画する。
     *
     * <p>出力側にも {@code ${...}} を使う言語がある（Thymeleaf の {@code th:object="${form}"} など）。
     * そのままだとこちらのプレースホルダと衝突するので、<b>{@code $\{} と書くとリテラルの
     * {@code ${} になる</b>というエスケープを用意してある。置換は先に済ませ、
     * エスケープの解除は最後に行う。
     */
    public static String render(String template, Map<String, String> variables) {
        if (template == null) {
            return "";
        }
        Matcher matcher = PLACEHOLDER.matcher(template);
        StringBuilder result = new StringBuilder();
        while (matcher.find()) {
            String name = matcher.group(1);
            String value = variables.get(name);
            matcher.appendReplacement(result,
                    Matcher.quoteReplacement(value == null ? "${" + name + "}" : value));
        }
        matcher.appendTail(result);
        return result.toString().replace("$\\{", "${");
    }

    public static boolean isNumericLiteral(String text) {
        return NUMERIC.matcher(text).matches();
    }

    public static boolean isQuotedLiteral(String text) {
        return text.length() >= 2
                && ((text.startsWith("'") && text.endsWith("'"))
                || (text.startsWith("\"") && text.endsWith("\"")));
    }

    /** 可読プロファイルが使うJava安全形式への変換。 */
    private static String javaForm(String raw) {
        if (isNumericLiteral(raw)) {
            return raw;
        }
        if (isQuotedLiteral(raw)) {
            return javaStringLiteral(raw.substring(1, raw.length() - 1));
        }
        String identifier = raw.replaceAll("[^A-Za-z0-9_]", "_");
        return identifier.isEmpty() || Character.isDigit(identifier.charAt(0)) ? "_" + identifier : identifier;
    }

    /** 生成ハーネス内でオペランドの値を返すJava式。 */
    private static String javaExpression(String raw) {
        if (isNumericLiteral(raw)) {
            return raw;
        }
        if (isQuotedLiteral(raw)) {
            return javaStringLiteral(raw.substring(1, raw.length() - 1));
        }
        return "vars.get(" + javaStringLiteral(raw) + ")";
    }

    private static String mapped(String name, String raw, Map<String, Map<String, String>> maps) {
        Map<String, String> table = maps == null ? null : maps.get(name);
        if (table == null) {
            return raw;
        }
        // COBOLは "NOT =" のような任意の空白を許すため、照合前に正規化する。
        String key = raw.replaceAll("\\s+", "").toUpperCase(java.util.Locale.ROOT);
        for (Map.Entry<String, String> entry : table.entrySet()) {
            if (entry.getKey().replaceAll("\\s+", "").toUpperCase(java.util.Locale.ROOT).equals(key)) {
                return entry.getValue();
            }
        }
        return raw;
    }

    private static String javaStringLiteral(String value) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : value.toCharArray()) {
            switch (c) {
                case '\\' -> sb.append("\\\\");
                case '"' -> sb.append("\\\"");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
