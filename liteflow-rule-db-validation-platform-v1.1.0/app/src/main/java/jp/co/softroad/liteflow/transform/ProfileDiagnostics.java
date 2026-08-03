package jp.co.softroad.liteflow.transform;

import java.util.List;

/**
 * プロファイル1件の診断結果。
 *
 * @param profile プロファイル名。読み込み時点で名前が無い場合はファイル名
 * @param source  読み込み元（同梱かどこかの外部ファイルか）
 */
public record ProfileDiagnostics(String profile, String source, List<ProfileDiagnostic> items) {

    public static ProfileDiagnostics empty(String profile, String source) {
        return new ProfileDiagnostics(profile, source, List.of());
    }

    public List<ProfileDiagnostic> errors() {
        return items.stream().filter(ProfileDiagnostic::isError).toList();
    }

    public boolean hasErrors() {
        return items.stream().anyMatch(ProfileDiagnostic::isError);
    }

    /** 起動ログや preflight のレポートに1行で出す形。 */
    public String summary() {
        long errors = items.stream().filter(ProfileDiagnostic::isError).count();
        long warnings = items.stream()
                .filter(item -> ProfileDiagnostic.WARN.equals(item.level())).count();
        return profile + ": ERROR " + errors + " / WARN " + warnings;
    }
}
