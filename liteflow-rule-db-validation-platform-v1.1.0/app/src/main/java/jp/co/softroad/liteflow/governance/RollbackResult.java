package jp.co.softroad.liteflow.governance;

/**
 * ロールバックの結果。
 *
 * <p>{@code newVersion} が {@code restoredFromVersion} より大きいことに注意。
 * LiteFlow に版を戻す原語は無いので、古い本文を<b>前向きに</b>再発行している。
 * v3 の状態で v2 へ戻すと v4 になる。
 */
public record RollbackResult(String targetType, String targetId, long restoredFromVersion,
                             long previousVersion, long newVersion, String restoredBody) {
}
