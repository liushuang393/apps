package jp.co.softroad.liteflow.governance;

import java.util.List;

/**
 * 2版の差分。
 *
 * @param lines        {@code  } 変更なし / {@code -} 旧 / {@code +} 新 を先頭に付けた行
 * @param changedLines 変更のあった行数
 * @param notes        履歴に無い版を指定した等の注意。空の差分を「同一」と誤読させないため
 */
public record RuleDiff(String targetType, String targetId, Long fromVersion, Long toVersion,
                       String fromBody, String toBody, List<String> lines, int changedLines,
                       List<String> notes) {
}
