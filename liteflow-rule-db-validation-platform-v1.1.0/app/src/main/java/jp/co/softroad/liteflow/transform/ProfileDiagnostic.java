package jp.co.softroad.liteflow.transform;

/**
 * ルール表の書き方の誤り1件。
 *
 * <p>このPoCの入口は「JSONにエントリを1件足す」である。つまり<b>ルール表が利用者向けの
 * インターフェース</b>にあたる。ところがそのインターフェースには診断が無く、
 * 綴り間違い（{@code appliesToFiles}）や未対応の組み合わせは例外にならないまま
 * <b>静かに違う出力</b>になっていた。原因が分かるのはコーパスの差分を人が読んだ後だった。
 * ここはその「読めば分かること」を機械に言わせるためにある。
 *
 * @param level   {@code ERROR}（ルール表が確実に意図どおり動かない）／
 *                {@code WARN}（怪しいが動く）／{@code INFO}（情報）
 * @param code    種別。安定した識別子なのでテストとレポートが依存してよい
 * @param target  どこの話か（{@code rules[3] id=move} のような位置）
 * @param message 日本語の説明
 */
public record ProfileDiagnostic(String level, String code, String target, String message) {
    public static final String ERROR = "ERROR";
    public static final String WARN = "WARN";
    public static final String INFO = "INFO";

    public static ProfileDiagnostic error(String code, String target, String message) {
        return new ProfileDiagnostic(ERROR, code, target, message);
    }

    public static ProfileDiagnostic warn(String code, String target, String message) {
        return new ProfileDiagnostic(WARN, code, target, message);
    }

    public static ProfileDiagnostic info(String code, String target, String message) {
        return new ProfileDiagnostic(INFO, code, target, message);
    }

    public boolean isError() {
        return ERROR.equals(level);
    }

    @Override
    public String toString() {
        return level + " " + code + " [" + target + "] " + message;
    }
}
