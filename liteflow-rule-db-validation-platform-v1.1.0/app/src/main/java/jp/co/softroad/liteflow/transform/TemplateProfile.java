package jp.co.softroad.liteflow.transform;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 版数と所有者を持つ変換ルールの集合。プロファイルは {@code classpath:templates/*.json} と、
 * 指定があれば外部ディレクトリ（{@code transform.template-dir}）から読み込む。
 * これによりルールライブラリをアプリjarとは独立に配布・レビューできる。
 *
 * <p>ルール表は3種類ある。いずれも省略可能で、省略すれば従来どおり {@code rules} だけで動く。
 * <ul>
 *   <li>{@code structure} — COBOLソースをプログラム／DIVISION／段落へ切り分ける規則。
 *       {@code AnalyzeNode} が使う</li>
 *   <li>{@code facts} — 全入力ファイルを事前走査して「ファイルをまたいで使う変数」を作る規則。
 *       Struts の Action クラス名やURLパスのように、成果物名や preamble の描画に必要な値を集める</li>
 *   <li>{@code artifacts} — 1入力から複数の成果物を作るときの、成果物ごとの骨組み
 *       （名前・区画順・前導・後尾）</li>
 * </ul>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class TemplateProfile {
    private String profile;
    private int version;
    private String owner;
    private String targetStyle;
    private String notes;
    /** グループ名をキーとする値マップ。例: {@code maps.op} はCOBOL演算子を変換する。 */
    private Map<String, Map<String, String>> maps = new LinkedHashMap<>();
    private List<TransformRule> rules = new ArrayList<>();
    /** プログラム構造の認識規則。COBOL複数ファイル方式でのみ使う。 */
    private List<StructureRule> structure = new ArrayList<>();
    /** ファイル横断の変数を集める規則。 */
    private List<FactRule> facts = new ArrayList<>();
    /** 成果物の骨組み。 */
    private List<ArtifactSpec> artifacts = new ArrayList<>();
    /** 読み込み元。外部ファイルが同梱プロファイルを上書きした場合の判別に使う。 */
    private String source;

    public String getProfile() {
        return profile;
    }

    public void setProfile(String profile) {
        this.profile = profile;
    }

    public int getVersion() {
        return version;
    }

    public void setVersion(int version) {
        this.version = version;
    }

    public String getOwner() {
        return owner;
    }

    public void setOwner(String owner) {
        this.owner = owner;
    }

    public String getTargetStyle() {
        return targetStyle;
    }

    public void setTargetStyle(String targetStyle) {
        this.targetStyle = targetStyle;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }

    public Map<String, Map<String, String>> getMaps() {
        return maps;
    }

    public void setMaps(Map<String, Map<String, String>> maps) {
        this.maps = maps == null ? new LinkedHashMap<>() : maps;
    }

    public List<TransformRule> getRules() {
        return rules;
    }

    public void setRules(List<TransformRule> rules) {
        this.rules = rules == null ? new ArrayList<>() : rules;
    }

    public List<StructureRule> getStructure() {
        return structure;
    }

    public void setStructure(List<StructureRule> structure) {
        this.structure = structure == null ? new ArrayList<>() : structure;
    }

    public List<FactRule> getFacts() {
        return facts;
    }

    public void setFacts(List<FactRule> facts) {
        this.facts = facts == null ? new ArrayList<>() : facts;
    }

    public List<ArtifactSpec> getArtifacts() {
        return artifacts;
    }

    public void setArtifacts(List<ArtifactSpec> artifacts) {
        this.artifacts = artifacts == null ? new ArrayList<>() : artifacts;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }
}
