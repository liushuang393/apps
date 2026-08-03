package jp.co.softroad.liteflow.transform;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 版数付き変換プロファイルを {@code classpath:templates/*.json} から読み込む。
 * {@code transform.template-dir} が設定されていればそのディレクトリからも読み込み、
 * 同名プロファイルは外部ファイルが同梱ファイルを上書きする。
 * したがってアプリを再ビルドせずにルールライブラリを更新できる。
 *
 * <p>{@link #reload()} で全件を読み直す。通常はキャッシュから返す。
 */
@Service
public class TemplateLibrary {
    private static final Logger LOG = LoggerFactory.getLogger(TemplateLibrary.class);
    private static final String CLASSPATH_PATTERN = "classpath*:templates/*.json";

    /**
     * 意図的にインジェクションではなく自前で生成している。Spring Boot 4 が自動設定するのは
     * Jackson 3（{@code tools.jackson.databind}）だが、プロファイルのモデルは Jackson 2 の
     * アノテーションを使っており、両方がクラスパス上に存在する。自前で持つことで、
     * Web層がどちらを使うかにプロファイル解析を依存させない。
     */
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private final String externalDir;
    private final Map<String, TemplateProfile> profiles = new ConcurrentHashMap<>();
    /** プロファイル名 → 読み込み時に取った診断。{@link ProfileValidator} が作る。 */
    private final Map<String, ProfileDiagnostics> diagnostics = new ConcurrentHashMap<>();

    public TemplateLibrary(@Value("${transform.template-dir:}") String externalDir) {
        this.externalDir = externalDir;
        reload();
    }

    public final synchronized void reload() {
        Map<String, TemplateProfile> loaded = new LinkedHashMap<>();
        Map<String, ProfileDiagnostics> checked = new LinkedHashMap<>();
        loadFromClasspath(loaded, checked);
        loadFromExternalDir(loaded, checked);
        profiles.keySet().retainAll(loaded.keySet());
        profiles.putAll(loaded);
        diagnostics.keySet().retainAll(checked.keySet());
        diagnostics.putAll(checked);
        LOG.info("transform profiles loaded: {}", profiles.keySet());
        reportDiagnostics();
    }

    /**
     * 診断を起動ログへ出す。
     *
     * <p><b>例外は投げない。</b> 誤ったルール表でアプリが起動しなくなるほうが運用上は困る
     * （コーパスも42項目も動かせなくなる）。ビルドを止める役目は
     * {@code ProfileDiagnosticsTest}（同梱プロファイルは ERROR 0 件）と
     * {@code tools/preflight.py} が負う。
     */
    private void reportDiagnostics() {
        for (ProfileDiagnostics result : diagnostics.values()) {
            if (result.items().isEmpty()) {
                continue;
            }
            if (result.hasErrors()) {
                LOG.error("ルール表に誤りがある {} <- {}", result.summary(), result.source());
            } else {
                LOG.warn("ルール表に注意点がある {} <- {}", result.summary(), result.source());
            }
            result.items().forEach(item -> LOG.warn("  {}", item));
        }
    }

    private void loadFromClasspath(Map<String, TemplateProfile> target,
                                   Map<String, ProfileDiagnostics> checked) {
        try {
            Resource[] resources = new PathMatchingResourcePatternResolver()
                    .getResources(CLASSPATH_PATTERN);
            for (Resource resource : resources) {
                try (InputStream in = resource.getInputStream()) {
                    register(target, checked, in.readAllBytes(),
                            "classpath:templates/" + resource.getFilename());
                } catch (IOException e) {
                    LOG.warn("skipping unreadable packaged profile {}: {}", resource.getFilename(), e.toString());
                }
            }
        } catch (IOException e) {
            LOG.warn("no packaged transform profiles found: {}", e.toString());
        }
    }

    private void loadFromExternalDir(Map<String, TemplateProfile> target,
                                     Map<String, ProfileDiagnostics> checked) {
        if (externalDir == null || externalDir.isBlank()) {
            return;
        }
        Path dir = Paths.get(externalDir);
        if (!Files.isDirectory(dir)) {
            LOG.warn("transform.template-dir is not a directory: {}", dir);
            return;
        }
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.json")) {
            List<Path> files = new ArrayList<>();
            stream.forEach(files::add);
            files.sort(Comparator.comparing(Path::getFileName));
            for (Path file : files) {
                try {
                    register(target, checked, Files.readAllBytes(file),
                            file.toAbsolutePath().toString());
                } catch (IOException e) {
                    LOG.warn("skipping unreadable external profile {}: {}", file, e.toString());
                }
            }
        } catch (IOException e) {
            LOG.warn("cannot list {}: {}", dir, e.toString());
        }
    }

    /**
     * 1件のプロファイルを登録する。
     *
     * <p>同じバイト列を<b>2回</b>読む。1回は模型へ、もう1回は生のツリーへ。
     * 模型側は {@code @JsonIgnoreProperties(ignoreUnknown = true)} なので、
     * 綴り間違いを見つけるには生のツリーが要る。
     */
    private void register(Map<String, TemplateProfile> target,
                          Map<String, ProfileDiagnostics> checked, byte[] content, String source)
            throws IOException {
        TemplateProfile profile = objectMapper.readValue(content, TemplateProfile.class);
        if (profile == null || profile.getProfile() == null || profile.getProfile().isBlank()) {
            LOG.warn("ignoring profile without a name from {}", source);
            return;
        }
        profile.setSource(source);
        TemplateProfile previous = target.put(profile.getProfile(), profile);
        if (previous != null) {
            LOG.info("profile '{}' from {} shadows {}", profile.getProfile(), source, previous.getSource());
        }
        checked.put(profile.getProfile(),
                ProfileValidator.validate(profile, objectMapper.readTree(content)));
    }

    public List<String> profileNames() {
        List<String> names = new ArrayList<>(profiles.keySet());
        names.sort(Comparator.naturalOrder());
        return names;
    }

    public List<TemplateProfile> all() {
        List<TemplateProfile> result = new ArrayList<>(profiles.values());
        result.sort(Comparator.comparing(TemplateProfile::getProfile));
        return result;
    }

    public TemplateProfile require(String name) {
        TemplateProfile profile = profiles.get(name);
        if (profile == null) {
            throw new IllegalArgumentException(
                    "unknown template profile: " + name + "; available: " + profileNames());
        }
        return profile;
    }

    /** 読み込み時に取った診断。プロファイルが無ければ例外。 */
    public ProfileDiagnostics diagnostics(String name) {
        require(name);
        return diagnostics.getOrDefault(name, ProfileDiagnostics.empty(name, null));
    }

    public List<ProfileDiagnostics> allDiagnostics() {
        List<ProfileDiagnostics> result = new ArrayList<>(diagnostics.values());
        result.sort(Comparator.comparing(ProfileDiagnostics::profile));
        return result;
    }
}
