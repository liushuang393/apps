package jp.co.softroad.liteflow.model;

import jp.co.softroad.liteflow.transform.BehaviourExpectation;

import java.util.List;
import java.util.Map;

public class ExecutionRequest {
    private String payload;

    /** 変換対象のソース行。任意。オーケストレーションのみを試すチェーンでは省略する。 */
    private List<String> sourceLines;

    /** ルール名をキーとするテンプレート表。例: {@code {"move": "${target} = ${source};"}}。 */
    private Map<String, String> templates;

    /** 使用する版数付きルールプロファイル。{@link #templates} より優先される。 */
    private String templateProfile;

    /** 生成コードが満たすべき振る舞い検査。 */
    private List<BehaviourExpectation> expectations;

    /** 未カバー行率がこの値を超えると品質ゲートを失敗させる。null で検査を無効化。 */
    private Double maxUncoveredRate;

    /**
     * 変換元ファイル名 → 行。複数ファイルを一度に変換する場合に使う。
     * {@link #sourceLines} と同時に指定しないこと。
     */
    private Map<String, List<String>> sourceFiles;

    /** 実行開始プログラム名。複数のCOBOLプログラムを渡したとき、どれを走らせるか。 */
    private String entryProgram;

    /** 成果物名 → 期待する正解テキスト。ゴールデン差分に使う。 */
    private Map<String, String> goldenArtifacts;

    public String getPayload() {
        return payload;
    }

    public void setPayload(String payload) {
        this.payload = payload;
    }

    public List<String> getSourceLines() {
        return sourceLines;
    }

    public void setSourceLines(List<String> sourceLines) {
        this.sourceLines = sourceLines;
    }

    public Map<String, String> getTemplates() {
        return templates;
    }

    public void setTemplates(Map<String, String> templates) {
        this.templates = templates;
    }

    public String getTemplateProfile() {
        return templateProfile;
    }

    public void setTemplateProfile(String templateProfile) {
        this.templateProfile = templateProfile;
    }

    public List<BehaviourExpectation> getExpectations() {
        return expectations;
    }

    public void setExpectations(List<BehaviourExpectation> expectations) {
        this.expectations = expectations;
    }

    public Double getMaxUncoveredRate() {
        return maxUncoveredRate;
    }

    public void setMaxUncoveredRate(Double maxUncoveredRate) {
        this.maxUncoveredRate = maxUncoveredRate;
    }

    public Map<String, List<String>> getSourceFiles() {
        return sourceFiles;
    }

    public void setSourceFiles(Map<String, List<String>> sourceFiles) {
        this.sourceFiles = sourceFiles;
    }

    public String getEntryProgram() {
        return entryProgram;
    }

    public void setEntryProgram(String entryProgram) {
        this.entryProgram = entryProgram;
    }

    public Map<String, String> getGoldenArtifacts() {
        return goldenArtifacts;
    }

    public void setGoldenArtifacts(Map<String, String> goldenArtifacts) {
        this.goldenArtifacts = goldenArtifacts;
    }
}
