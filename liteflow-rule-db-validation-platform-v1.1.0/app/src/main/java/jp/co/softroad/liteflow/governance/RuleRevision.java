package jp.co.softroad.liteflow.governance;

/**
 * 発行1回分の記録（post-image）。
 *
 * <p>LiteFlow 側は上書きしてしまうので、発行のたびにここへ「発行後の本文」を残す。
 * 履歴＝この行の並び、差分＝2版の {@code body} 比較、ロールバック＝古い版の {@code body} を
 * 現行版に対して<b>前向きに</b>再発行、という組み立てになる。
 * LiteFlow に版を戻す原語は無い。
 */
public record RuleRevision(long id, String targetType, String targetId, long version,
                           String body, String attrs, String actor, String comment,
                           String createdAt) {
}
