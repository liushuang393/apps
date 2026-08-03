package jp.co.softroad.liteflow.transform;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;

/**
 * 変換前の下ごしらえを、<b>Spring も LiteFlow も無しで</b>行う純粋な処理。
 *
 * <p>2つのルール表を評価する。
 * <ul>
 *   <li>{@code structure} — COBOLソースをプログラム／区画／段落へ切り分ける</li>
 *   <li>{@code facts} — 全入力ファイルを事前に1周し、ファイルをまたいで使う変数を集める</li>
 * </ul>
 *
 * <p>どちらのルール表も持たないプロファイル（{@code compilable-v1} など）では<b>何もしない</b>。
 * 段落見出しが1つも見つからなかった場合もプログラムを積まない。
 * これにより既存の平坦な生成経路が完全にそのまま残る。
 *
 * <p>{@code AnalyzeNode} はこのクラスを呼ぶだけの <b>adapter</b> である。
 * 解析の意味を確かめたいテストはこちらを直接呼ぶこと（起動が要らないので数ミリ秒で済む）。
 */
public final class SourceAnalyzer {

    private SourceAnalyzer() {
    }

    /**
     * 解析結果。
     *
     * @param programs 認識したCOBOLプログラム。段落が見つからなければ空
     * @param facts    ファイル横断の変数。宣言順を保つ
     */
    public record Analysis(List<CobolProgram> programs, Map<String, String> facts) {
        public boolean isEmpty() {
            return programs.isEmpty() && facts.isEmpty();
        }
    }

    public static Analysis analyse(TemplateProfile profile, List<String> sourceLines,
                                   Map<String, List<String>> sourceFiles) {
        Map<String, String> facts = new LinkedHashMap<>();
        List<CobolProgram> programs = new ArrayList<>();
        if (profile == null) {
            return new Analysis(programs, facts);
        }
        List<String> lines = sourceLines == null ? List.of() : sourceLines;
        Map<String, List<String>> files = sourceFiles == null ? Map.of() : sourceFiles;
        collectFacts(profile, lines, files, facts);
        analyseStructure(profile, files, programs);
        return new Analysis(programs, facts);
    }

    // ---- facts ------------------------------------------------------------------

    private static void collectFacts(TemplateProfile profile, List<String> sourceLines,
                                     Map<String, List<String>> sourceFiles,
                                     Map<String, String> facts) {
        if (profile.getFacts().isEmpty()) {
            return;
        }
        Map<String, List<String>> files = sourceFiles;
        if (files.isEmpty() && !sourceLines.isEmpty()) {
            files = Map.of("", sourceLines);
        }
        files.forEach((fileName, lines) -> {
            for (FactRule rule : profile.getFacts()) {
                if (!rule.appliesToFileName(fileName)) {
                    continue;
                }
                for (String raw : lines) {
                    String line = raw.trim();
                    if (line.isEmpty()) {
                        continue;
                    }
                    Matcher matcher = rule.compiledPattern().matcher(line);
                    if (!matcher.matches()) {
                        continue;
                    }
                    Map<String, String> variables =
                            TemplateRenderer.variables(rule.getPattern(), matcher, profile.getMaps());
                    rule.getSet().forEach((name, template) -> {
                        if (name != null) {
                            String value = TemplateRenderer.render(template, variables);
                            if (value != null) {
                                facts.put(name, value);
                            }
                        }
                    });
                }
            }
        });
    }

    // ---- structure --------------------------------------------------------------

    private static void analyseStructure(TemplateProfile profile,
                                         Map<String, List<String>> sourceFiles,
                                         List<CobolProgram> programs) {
        if (profile.getStructure().isEmpty()) {
            return;
        }
        if (sourceFiles.isEmpty()) {
            return;  // 単一ファイル方式は従来どおり平坦経路のまま
        }

        List<CobolProgram> found = new ArrayList<>();
        sourceFiles.forEach((fileName, lines) -> {
            CobolProgram program = analyseFile(profile, fileName, lines);
            if (program != null && !program.getSourceParagraphs().isEmpty()) {
                found.add(program);
            }
        });
        if (found.isEmpty()) {
            return;  // 段落が1つも見つからない。平坦経路へ委ねる
        }
        programs.addAll(found);
    }

    private static CobolProgram analyseFile(TemplateProfile profile, String fileName,
                                            List<String> lines) {
        // プログラム名が見つかるまではファイル名（拡張子なし）を仮の名前にしておく。
        String fallbackId = fileName.replaceAll("\\.[^.]*$", "");
        CobolProgram program = new CobolProgram(fallbackId);
        program.setSourceFile(fileName);
        String section = "";
        String currentParagraph = null;
        boolean sawProgramId = false;

        for (String raw : lines) {
            String line = raw.trim();
            if (line.isEmpty()) {
                continue;
            }
            StructureRule matchedRule = null;
            Matcher matched = null;
            for (StructureRule rule : profile.getStructure()) {
                if (rule.getInSection() != null && !rule.getInSection().equals(section)) {
                    continue;
                }
                Matcher matcher = rule.compiledPattern().matcher(line);
                if (matcher.matches()) {
                    matchedRule = rule;
                    matched = matcher;
                    break;
                }
            }
            if (matchedRule == null) {
                // 構造規則にマッチしない行は、いま開いている段落の本文として扱う。
                // 段落の外なら捨てる（IDENTIFICATION DIVISION の飾りなど）。
                if (currentParagraph != null) {
                    program.declareSourceParagraph(currentParagraph).add(line);
                }
                continue;
            }

            String kind = matchedRule.getKind() == null ? "ignore" : matchedRule.getKind();
            switch (kind) {
                case "program" -> {
                    String name = group(matched, "name");
                    if (name != null) {
                        CobolProgram renamed = new CobolProgram(name);
                        renamed.setSourceFile(fileName);
                        renamed.getWorkingStorage().putAll(program.getWorkingStorage());
                        renamed.getLinkage().addAll(program.getLinkage());
                        program = renamed;
                        sawProgramId = true;
                    }
                }
                case "section" -> {
                    section = matchedRule.getTo() != null ? matchedRule.getTo()
                            : String.valueOf(group(matched, "name")).toLowerCase(Locale.ROOT);
                    currentParagraph = null;
                }
                case "dataItem" -> {
                    String name = group(matched, "name");
                    if (name != null) {
                        String value = group(matched, "value");
                        program.getWorkingStorage().put(name, javaLiteral(value, matchedRule));
                    }
                }
                case "linkageItem" -> {
                    String name = group(matched, "name");
                    if (name != null && !program.getLinkage().contains(name)) {
                        program.getLinkage().add(name);
                    }
                }
                case "using" -> {
                    String args = group(matched, "args");
                    if (args != null) {
                        List<String> ordered = new ArrayList<>();
                        for (String token : args.trim().split("[\\s,]+")) {
                            if (!token.isBlank()) {
                                ordered.add(token);
                            }
                        }
                        // USING の並びが LINKAGE の宣言順より優先する。CALL は位置で束縛するため。
                        program.getLinkage().clear();
                        program.getLinkage().addAll(ordered);
                    }
                    // PROCEDURE DIVISION USING は区画の切り替えでもある。
                    // ここで procedure へ移らないと、以降の段落見出しが1つも認識されず、
                    // 副プログラムがまるごと消える（呼び出し側が「クラスが無い」で落ちる）。
                    section = matchedRule.getTo() != null ? matchedRule.getTo() : "procedure";
                    currentParagraph = null;
                }
                case "paragraph" -> {
                    String name = group(matched, "name");
                    if (name != null) {
                        currentParagraph = name;
                        program.declareSourceParagraph(name);
                    }
                }
                case "statement" -> {
                    // 段落見出しと紛らわしい単語文（GOBACK. など）を、段落本文として明示的に残す。
                    if (currentParagraph != null) {
                        program.declareSourceParagraph(currentParagraph).add(line);
                    }
                }
                default -> {
                    // ignore: 認識するが何もしない
                }
            }
        }
        if (!sawProgramId && program.getSourceParagraphs().isEmpty()) {
            return null;
        }
        return program;
    }

    private static String group(Matcher matcher, String name) {
        try {
            String value = matcher.group(name);
            return value == null ? null : value.trim();
        } catch (IllegalArgumentException | IllegalStateException e) {
            return null;
        }
    }

    /** VALUE 句をJavaリテラルへ。数値はそのまま double、引用符付きは文字列、無ければ既定値。 */
    private static String javaLiteral(String value, StructureRule rule) {
        if (value == null || value.isBlank()) {
            return rule.getDefaultValue() == null ? "0d" : rule.getDefaultValue();
        }
        String trimmed = value.trim();
        if (TemplateRenderer.isNumericLiteral(trimmed)) {
            return trimmed + "d";
        }
        if (TemplateRenderer.isQuotedLiteral(trimmed)) {
            return "\"" + trimmed.substring(1, trimmed.length() - 1).replace("\\", "\\\\")
                    .replace("\"", "\\\"") + "\"";
        }
        if ("ZERO".equalsIgnoreCase(trimmed) || "ZEROS".equalsIgnoreCase(trimmed)
                || "ZEROES".equalsIgnoreCase(trimmed)) {
            return "0d";
        }
        if ("SPACE".equalsIgnoreCase(trimmed) || "SPACES".equalsIgnoreCase(trimmed)) {
            return "\" \"";
        }
        return rule.getDefaultValue() == null ? "0d" : rule.getDefaultValue();
    }
}
