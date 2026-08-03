package jp.co.softroad.liteflow.controller;

import jp.co.softroad.liteflow.transform.ProfileDiagnostics;
import jp.co.softroad.liteflow.transform.TemplateLibrary;
import jp.co.softroad.liteflow.transform.TemplateProfile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * ルールライブラリの参照専用ビュー。移行実行の結果を信用する前に、
 * どのプロファイル版が有効でどこから読み込まれたかを運用者が確認できるようにする。
 */
@RestController
@RequestMapping("/api/templates")
public class TemplateController {
    private final TemplateLibrary templateLibrary;

    public TemplateController(TemplateLibrary templateLibrary) {
        this.templateLibrary = templateLibrary;
    }

    @GetMapping
    public Map<String, Object> list() {
        List<Map<String, Object>> profiles = templateLibrary.all().stream()
                .map(profile -> {
                    Map<String, Object> summary = new LinkedHashMap<>();
                    summary.put("profile", profile.getProfile());
                    summary.put("version", profile.getVersion());
                    summary.put("owner", profile.getOwner());
                    summary.put("ruleCount", profile.getRules().size());
                    summary.put("source", profile.getSource());
                    summary.put("targetStyle", profile.getTargetStyle());
                    return summary;
                })
                .toList();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("profiles", profiles);
        return body;
    }

    @GetMapping("/{name}")
    public TemplateProfile detail(@PathVariable String name) {
        return templateLibrary.require(name);
    }

    /**
     * 全プロファイルの診断。ルール表の書き方の誤りを名指しで返す。
     *
     * <p>{@code /api/templates/**} は無認証のまま（{@code SecurityConfig} 参照）。
     * ルール表の健全性は運用者が真っ先に見たい情報であり、認証を要求すると
     * コーパス実行スクリプトと検証スクリプトを書き換えることになる。
     */
    @GetMapping("/diagnostics")
    public Map<String, Object> diagnostics() {
        List<ProfileDiagnostics> all = templateLibrary.allDiagnostics();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", all.stream().anyMatch(ProfileDiagnostics::hasErrors) ? "FAIL" : "PASS");
        body.put("profiles", all);
        return body;
    }

    @GetMapping("/{name}/diagnostics")
    public ProfileDiagnostics diagnostics(@PathVariable String name) {
        return templateLibrary.diagnostics(name);
    }
}
