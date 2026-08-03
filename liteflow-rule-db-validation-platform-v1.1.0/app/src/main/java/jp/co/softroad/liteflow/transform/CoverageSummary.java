package jp.co.softroad.liteflow.transform;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * ルールセットが入力のどれだけを実際に認識できたか。
 *
 * <p>認識できなかった行は捨てずに計数・サンプリングする。正直な未カバー率こそが、
 * ルールライブラリがあとどれだけ足りないかを示す唯一の数字だからである。
 */
public class CoverageSummary {
    private int totalLines;
    private int recognisedLines;
    private int unrecognisedLines;
    private final Map<String, Integer> byRule = new LinkedHashMap<>();
    private final List<String> unrecognisedSamples = new ArrayList<>();

    public void recordRecognised(String ruleId) {
        totalLines++;
        recognisedLines++;
        byRule.merge(ruleId, 1, Integer::sum);
    }

    public void recordUnrecognised(String line) {
        totalLines++;
        unrecognisedLines++;
        if (unrecognisedSamples.size() < 50) {
            unrecognisedSamples.add(line);
        }
    }

    public int getTotalLines() {
        return totalLines;
    }

    public int getRecognisedLines() {
        return recognisedLines;
    }

    public int getUnrecognisedLines() {
        return unrecognisedLines;
    }

    public Map<String, Integer> getByRule() {
        return byRule;
    }

    public List<String> getUnrecognisedSamples() {
        return unrecognisedSamples;
    }

    public double getUncoveredRate() {
        return totalLines == 0 ? 0.0 : (double) unrecognisedLines / (double) totalLines;
    }
}
