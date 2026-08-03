package jp.co.softroad.liteflow.governance;

/**
 * LiteFlow のテーブルにある「いま有効なルール」1件。
 *
 * @param targetType   {@code CHAIN} または {@code SCRIPT}
 * @param targetId     chainId または nodeId
 * @param version      現行版。次に発行するときの {@code expectedVersion} になる
 * @param body         chain なら EL、script ならスクリプト本文
 * @param attrs        script のみ。{@code 言語/種別}
 * @param enabled      LiteFlow 側の有効フラグ
 * @param modifiedAt   最終更新時刻
 */
public record RuleSummary(String targetType, String targetId, long version, String body,
                          String attrs, boolean enabled, String modifiedAt) {
}
