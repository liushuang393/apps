package jp.co.softroad.liteflow.transform;

import com.fasterxml.jackson.databind.JsonNode;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * ルール表の書き方を検証する。
 *
 * <p><b>なぜ要るのか。</b> プロファイルは
 * {@code @JsonIgnoreProperties(ignoreUnknown = true)} で読み込まれる。ここに
 * 「配列順に評価され最初にマッチしたものが勝つ」「{@code appliesToFile} 未指定は全ファイル」
 * 「未解決の {@code ${...}} はそのまま出力に残す」が重なると、<b>綴り間違いが例外にならず、
 * 静かに違う出力になる</b>という組み合わせが成立する。実際にこの型の不具合を何件も踏んだ。
 *
 * <p>読み込みの寛容さ（{@code notes} のような自由記述を許す）は<b>そのまま残す</b>。
 * 生の JSON を別に1回見て<b>報告する</b>だけにしてあり、既存プロファイルを壊さない。
 *
 * <p>既知フィールドの一覧は<b>模型クラスの setter から反射で取る</b>。
 * ここに手書きの名簿を置くと、フィールドを1つ足すたびに2か所を直すことになり、
 * ずれた瞬間に誤検知を出す仕組みになってしまう。
 */
public final class ProfileValidator {
    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{([A-Za-z0-9_]+)}");
    /** {@code ${g}} から派生する変数の接尾辞。{@link TemplateRenderer} と対応させる。 */
    private static final List<String> DERIVED_SUFFIXES =
            List.of("", "Java", "Expr", "Mapped", "List", "ExprList");
    /** 枠の深さから来る組み込み変数。 */
    private static final Set<String> BUILT_IN = Set.of("_indent", "_depth");

    private ProfileValidator() {
    }

    /**
     * @param profile 読み込み済みのプロファイル
     * @param raw     同じ内容の生のJSONツリー。未知フィールドの検出に使う。null なら省略
     */
    public static ProfileDiagnostics validate(TemplateProfile profile, JsonNode raw) {
        List<ProfileDiagnostic> items = new ArrayList<>();
        if (profile == null) {
            return new ProfileDiagnostics("(unnamed)", null, items);
        }
        checkUnknownFields(raw, items);
        checkRules(profile, items);
        checkFrames(profile, items);
        checkArtifacts(profile, items);
        checkStructure(profile, items);
        checkFacts(profile, items);
        return new ProfileDiagnostics(profile.getProfile(), profile.getSource(), items);
    }

    // ---- 未知フィールド ---------------------------------------------------------

    private static void checkUnknownFields(JsonNode raw, List<ProfileDiagnostic> items) {
        if (raw == null || !raw.isObject()) {
            return;
        }
        compareFields(raw, TemplateProfile.class, "(profile)", items);
        checkArrayFields(raw, "rules", TransformRule.class, items);
        checkArrayFields(raw, "structure", StructureRule.class, items);
        checkArrayFields(raw, "facts", FactRule.class, items);
        checkArrayFields(raw, "artifacts", ArtifactSpec.class, items);
    }

    private static void checkArrayFields(JsonNode raw, String field, Class<?> type,
                                         List<ProfileDiagnostic> items) {
        JsonNode array = raw.get(field);
        if (array == null || !array.isArray()) {
            return;
        }
        for (int i = 0; i < array.size(); i++) {
            JsonNode entry = array.get(i);
            String id = entry.hasNonNull("id") ? entry.get("id").asText()
                    : entry.hasNonNull("name") ? entry.get("name").asText() : "?";
            compareFields(entry, type, field + "[" + i + "] " + id, items);
        }
    }

    private static void compareFields(JsonNode node, Class<?> type, String target,
                                      List<ProfileDiagnostic> items) {
        if (!node.isObject()) {
            return;
        }
        Set<String> known = settableFields(type);
        for (Iterator<String> names = node.fieldNames(); names.hasNext(); ) {
            String name = names.next();
            if (known.contains(name)) {
                continue;
            }
            items.add(ProfileDiagnostic.error("unknown-field", target,
                    "'" + name + "' は " + type.getSimpleName()
                            + " に無いフィールドである。読み込みは寛容なので黙って無視され、"
                            + "宣言したつもりの効果が一切効かない。綴りを確認すること。"
                            + "使えるのは: " + String.join(", ", known)));
        }
    }

    /** 模型クラスの1引数 setter からJSONで指定できる名前を作る。 */
    private static Set<String> settableFields(Class<?> type) {
        Set<String> names = new LinkedHashSet<>();
        for (Method method : type.getMethods()) {
            if (method.getParameterCount() != 1 || !method.getName().startsWith("set")
                    || method.getName().length() < 4) {
                continue;
            }
            String name = method.getName().substring(3);
            names.add(Character.toLowerCase(name.charAt(0)) + name.substring(1));
        }
        return names;
    }

    // ---- ルール ----------------------------------------------------------------

    private static void checkRules(TemplateProfile profile, List<ProfileDiagnostic> items) {
        Set<String> factNames = factNames(profile);
        Set<String> boundNames = boundNames(profile);
        Map<String, Integer> seenIds = new TreeMap<>();
        List<TransformRule> rules = profile.getRules();

        for (int i = 0; i < rules.size(); i++) {
            TransformRule rule = rules.get(i);
            String target = "rules[" + i + "] " + (rule.getId() == null ? "(id無し)" : rule.getId());

            if (rule.getId() == null || rule.getId().isBlank()) {
                items.add(ProfileDiagnostic.error("missing-field", target,
                        "id が無い。カバレッジの内訳がルール単位で追えなくなる"));
            } else {
                Integer previous = seenIds.put(rule.getId(), i);
                if (previous != null) {
                    items.add(ProfileDiagnostic.error("duplicate-id", target,
                            "id '" + rule.getId() + "' は rules[" + previous
                                    + "] と重複している。カバレッジの計数が合算されて混ざる"));
                }
            }
            if (rule.getTemplate() == null) {
                items.add(ProfileDiagnostic.error("missing-field", target,
                        "template が無い。認識して捨てたいなら \"\"（空文字）を明示すること"));
            }
            Pattern compiled = compile(rule.getPattern(), target, "pattern", items);
            compile(rule.getAppliesToFile(), target, "appliesToFile", items);

            Set<String> resolvable = new LinkedHashSet<>(BUILT_IN);
            resolvable.addAll(factNames);
            resolvable.addAll(boundNames);
            if (rule.getPattern() != null) {
                for (String group : TemplateRenderer.groupNames(rule.getPattern())) {
                    DERIVED_SUFFIXES.forEach(suffix -> resolvable.add(group + suffix));
                }
            }
            checkPlaceholders(rule.getTemplate(), resolvable, target, "template", items);
            checkPlaceholders(rule.getEmitTo(), resolvable, target, "emitTo", items);
            if (rule.getBinds() != null) {
                rule.getBinds().forEach((name, template) ->
                        checkPlaceholders(template, resolvable, target, "binds." + name, items));
            }
            if (rule.getContinueWith() != null && compiled != null
                    && !TemplateRenderer.groupNames(rule.getPattern()).contains(rule.getContinueWith())) {
                items.add(ProfileDiagnostic.error("unknown-group", target,
                        "continueWith が指す '" + rule.getContinueWith()
                                + "' は pattern の名前付きグループに無い。再投入は黙って行われない"));
            }
            if (rule.getBinds() != null && !rule.getBinds().isEmpty() && rule.getOpens() == null) {
                items.add(ProfileDiagnostic.warn("binds-without-opens", target,
                        "binds は opens と併用しないと効かない（束縛先の枠が無い）"));
            }
            checkShadowing(rules, i, rule, target, items);
        }
    }

    /**
     * より広い同型のルールが前にあって、絶対にマッチしないルールを見つける。
     *
     * <p>「配列順に評価され最初にマッチしたものが勝つ」の裏側である。
     * 判定は保守的に、pattern が完全一致でファイル絞りと文脈条件も同じ場合に限る。
     *
     * <p>文脈条件は {@code requires} だけではない。<b>{@code closes} も同じだけ絞る</b>
     * （枠の一番上が一致するときしかマッチしない）。同じ {@code ^\}$} に対して
     * {@code closes: block} と {@code closes: method} を並べるのは正しい書き方であり、
     * ここを取り違えると正しいプロファイルを誤って責める。
     */
    private static void checkShadowing(List<TransformRule> rules, int index, TransformRule rule,
                                       String target, List<ProfileDiagnostic> items) {
        if (rule.getPattern() == null) {
            return;
        }
        for (int j = 0; j < index; j++) {
            TransformRule earlier = rules.get(j);
            if (!rule.getPattern().equals(earlier.getPattern())) {
                continue;
            }
            if (!java.util.Objects.equals(earlier.getAppliesToFile(), rule.getAppliesToFile())) {
                continue;
            }
            String earlierFrame = frameRequirement(earlier);
            boolean earlierIsAtLeastAsBroad = earlierFrame == null
                    || java.util.Objects.equals(earlierFrame, frameRequirement(rule));
            if (earlierIsAtLeastAsBroad) {
                items.add(ProfileDiagnostic.error("shadowed-rule", target,
                        "rules[" + j + "] " + earlier.getId()
                                + " が同じ pattern を先に持っているため、このルールは一度も発火しない"));
                return;
            }
        }
    }

    /**
     * ルールが要求する枠の種別。{@code RuleEngine.frameAllows} と同じ規則で求める
     * （{@code requires} が優先し、無ければ {@code closes}）。
     */
    private static String frameRequirement(TransformRule rule) {
        return rule.getRequires() != null ? rule.getRequires() : rule.getCloses();
    }

    // ---- 枠（opens / closes / requires） ------------------------------------------

    private static void checkFrames(TemplateProfile profile, List<ProfileDiagnostic> items) {
        Set<String> opened = new LinkedHashSet<>();
        Set<String> closed = new LinkedHashSet<>();
        Set<String> required = new LinkedHashSet<>();
        for (TransformRule rule : profile.getRules()) {
            if (rule.getOpens() != null) {
                opened.add(rule.getOpens());
            }
            if (rule.getCloses() != null) {
                closed.add(rule.getCloses());
            }
            if (rule.getRequires() != null) {
                required.add(rule.getRequires());
            }
        }
        opened.stream().filter(kind -> !closed.contains(kind)).forEach(kind ->
                items.add(ProfileDiagnostic.error("unclosed-frame", "(profile)",
                        "枠 '" + kind + "' を開くルールはあるが閉じるルールが無い。"
                                + "生成物の括弧が閉じず、実行ごとに structure の指摘が出る")));
        closed.stream().filter(kind -> !opened.contains(kind)).forEach(kind ->
                items.add(ProfileDiagnostic.error("unopened-frame", "(profile)",
                        "枠 '" + kind + "' を閉じるルールはあるが開くルールが無い。"
                                + "closes は枠の一番上が一致するときだけマッチするので、このルールは発火しない")));
        required.stream().filter(kind -> !opened.contains(kind)).forEach(kind ->
                items.add(ProfileDiagnostic.error("unopened-frame", "(profile)",
                        "枠 '" + kind + "' を requires するルールはあるが開くルールが無い。"
                                + "そのルールは一度も発火しない")));
    }

    // ---- 成果物 ----------------------------------------------------------------

    private static void checkArtifacts(TemplateProfile profile, List<ProfileDiagnostic> items) {
        Set<String> factNames = factNames(profile);
        Set<String> names = new LinkedHashSet<>();
        for (int i = 0; i < profile.getArtifacts().size(); i++) {
            ArtifactSpec spec = profile.getArtifacts().get(i);
            String target = "artifacts[" + i + "] " + spec.getName();
            if (spec.getName() == null || spec.getName().isBlank()) {
                items.add(ProfileDiagnostic.error("missing-field", target, "name が無い"));
                continue;
            }
            if (!names.add(spec.getName())) {
                items.add(ProfileDiagnostic.error("duplicate-id", target,
                        "同じ成果物名が2回宣言されている。後の宣言が前を上書きする"));
            }
            checkPlaceholders(spec.getName(), factNames, target, "name", items);
            checkPlaceholders(spec.getClassName(), factNames, target, "className", items);
            spec.getPreamble().forEach(line ->
                    checkPlaceholders(line, factNames, target, "preamble", items));
            spec.getEpilogue().forEach(line ->
                    checkPlaceholders(line, factNames, target, "epilogue", items));
            if ("java".equals(spec.getKind()) && spec.getClassName() == null) {
                items.add(ProfileDiagnostic.error("missing-field", target,
                        "kind=java なのに className が無い。コンパイル対象にできない"));
            }
        }
        if (names.isEmpty()) {
            return;
        }
        for (int i = 0; i < profile.getRules().size(); i++) {
            TransformRule rule = profile.getRules().get(i);
            String target = "rules[" + i + "] " + rule.getId();
            if (rule.getEmitTo() != null && !names.contains(rule.getEmitTo())) {
                items.add(ProfileDiagnostic.error("unknown-artifact", target,
                        "emitTo '" + rule.getEmitTo() + "' に対応する artifacts の宣言が無い。"
                                + "骨組み無しの成果物が別に1つ増える。宣言済み: " + names));
            }
            if (rule.getSection() == null) {
                continue;
            }
            String artifactName = rule.getEmitTo() == null
                    ? profile.getArtifacts().get(0).getName() : rule.getEmitTo();
            profile.getArtifacts().stream()
                    .filter(spec -> artifactName.equals(spec.getName()))
                    .findFirst()
                    .filter(spec -> !spec.getSections().contains(rule.getSection()))
                    .ifPresent(spec -> items.add(ProfileDiagnostic.warn("unknown-section", target,
                            "section '" + rule.getSection() + "' は " + spec.getName()
                                    + " の sections に無い。区画順の指定が効かず末尾へ回る")));
        }
    }

    // ---- structure / facts -----------------------------------------------------

    private static final Set<String> STRUCTURE_KINDS = Set.of(
            "program", "section", "dataItem", "linkageItem", "using", "paragraph",
            "statement", "ignore");

    private static void checkStructure(TemplateProfile profile, List<ProfileDiagnostic> items) {
        for (int i = 0; i < profile.getStructure().size(); i++) {
            StructureRule rule = profile.getStructure().get(i);
            String target = "structure[" + i + "] " + (rule.getId() == null ? "?" : rule.getId());
            compile(rule.getPattern(), target, "pattern", items);
            String kind = rule.getKind();
            if (kind != null && !STRUCTURE_KINDS.contains(kind)) {
                items.add(ProfileDiagnostic.error("unknown-kind", target,
                        "kind '" + kind + "' は解析器が知らない。認識されるが何もしない ignore と"
                                + "同じ扱いになる。使えるのは: "
                                + new java.util.TreeSet<>(STRUCTURE_KINDS)));
            }
        }
    }

    private static void checkFacts(TemplateProfile profile, List<ProfileDiagnostic> items) {
        for (int i = 0; i < profile.getFacts().size(); i++) {
            FactRule rule = profile.getFacts().get(i);
            String target = "facts[" + i + "] " + (rule.getId() == null ? "?" : rule.getId());
            compile(rule.getPattern(), target, "pattern", items);
            compile(rule.getAppliesToFile(), target, "appliesToFile", items);
            if (rule.getSet().isEmpty()) {
                items.add(ProfileDiagnostic.warn("empty-set", target,
                        "set が空なので、この規則は何も集めない"));
            }
            Set<String> resolvable = new LinkedHashSet<>();
            if (rule.getPattern() != null) {
                for (String group : TemplateRenderer.groupNames(rule.getPattern())) {
                    DERIVED_SUFFIXES.forEach(suffix -> resolvable.add(group + suffix));
                }
            }
            rule.getSet().forEach((name, template) ->
                    checkPlaceholders(template, resolvable, target, "set." + name, items));
        }
    }

    // ---- 補助 ------------------------------------------------------------------

    private static Set<String> factNames(TemplateProfile profile) {
        Set<String> names = new LinkedHashSet<>();
        profile.getFacts().forEach(rule -> names.addAll(rule.getSet().keySet()));
        return names;
    }

    private static Set<String> boundNames(TemplateProfile profile) {
        Set<String> names = new LinkedHashSet<>();
        profile.getRules().forEach(rule -> {
            if (rule.getBinds() != null) {
                names.addAll(rule.getBinds().keySet());
            }
        });
        return names;
    }

    private static Pattern compile(String regex, String target, String field,
                                   List<ProfileDiagnostic> items) {
        if (regex == null || regex.isBlank()) {
            return null;
        }
        try {
            return Pattern.compile(regex);
        } catch (PatternSyntaxException e) {
            items.add(ProfileDiagnostic.error("bad-regex", target,
                    field + " が正規表現として不正: " + e.getDescription()
                            + "（位置 " + e.getIndex() + "）。このルールは実行時に例外を投げる"));
            return null;
        }
    }

    /**
     * テンプレート内の {@code ${...}} が解決できるかを見る。
     *
     * <p>{@code $\{} は「リテラルの {@code ${} を出す」エスケープなので、走査の前に外す
     * （Thymeleaf の {@code th:object="$\{form}"} を誤検知しないため）。
     */
    private static void checkPlaceholders(String template, Set<String> resolvable, String target,
                                          String field, List<ProfileDiagnostic> items) {
        if (template == null || template.isEmpty()) {
            return;
        }
        String scan = template.replace("$\\{", "");
        Matcher matcher = PLACEHOLDER.matcher(scan);
        while (matcher.find()) {
            String name = matcher.group(1);
            if (resolvable.contains(name)) {
                continue;
            }
            items.add(ProfileDiagnostic.error("unresolved-variable", target,
                    field + " の ${" + name + "} を解決できない。未解決のまま出力へ残るので"
                            + "生成物に ${" + name + "} が現れる。"
                            + "使えるのは: " + sorted(resolvable)));
        }
    }

    private static String sorted(Set<String> names) {
        return String.join(", ", new java.util.TreeSet<>(names));
    }

    /**
     * 実行結果から「一度も発火しなかったルール」を挙げる。
     *
     * <p>静的には見つけられない種類の死んだルールがある（より広いパターンが実質的に
     * 食べてしまう場合など）。実際にコーパスを通した結果と突き合わせるのがいちばん確実である。
     */
    public static List<ProfileDiagnostic> unusedRules(TemplateProfile profile,
                                                      Set<String> firedRuleIds) {
        List<ProfileDiagnostic> items = new ArrayList<>();
        for (int i = 0; i < profile.getRules().size(); i++) {
            TransformRule rule = profile.getRules().get(i);
            if (rule.getId() == null || firedRuleIds.contains(rule.getId())) {
                continue;
            }
            items.add(ProfileDiagnostic.info("unused-rule",
                    "rules[" + i + "] " + rule.getId(),
                    "この実行では一度も発火しなかった。"
                            + "対応するケースが無いか、前のルールに食われている可能性がある"));
        }
        return items;
    }

    /** ログ1行にまとめるための整形。 */
    static String describe(ProfileDiagnostic item) {
        return item.level().toLowerCase(Locale.ROOT) + ":" + item.code();
    }
}
