package jp.co.softroad.liteflow.governance;

/**
 * 職務分離の違反。<b>申請した本人が同じ申請を承認しようとした</b>ときに投げる。
 *
 * <p>これが無いと承認フローは権限の境界にならない。発行そのものは
 * {@code POST /api/rules/**} が {@code ADMIN} に限られているが、
 * 申請は認証済みなら誰でも出せて、承認は {@code APPROVER} が通せる。
 * つまり {@code APPROVER} を持つ利用者は「自分で申請して自分で承認する」だけで
 * <b>ADMIN を持たないまま任意の本文を全 Executor へ発行できてしまう</b>。
 *
 * <p>却下は自分の申請に対しても許す（自分の申請の取り下げにあたるため）。
 *
 * <p>HTTP 403 へ対応させる（{@code ApiExceptionHandler}）。400 ではない —
 * リクエストの形は正しく、<b>その人が行ってよい操作ではない</b>という意味だからである。
 */
public class SeparationOfDutiesException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    public SeparationOfDutiesException(String message) {
        super(message);
    }
}
