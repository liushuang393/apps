"""
Mode Router（README §0 / Phase 3 ハイブリッド 2 主線の主線選択）

目的:
    会議モード（a/b/hybrid）・会議レベルの S2S 許可・言語ペア単位の上書き
    （language_routes）・各主線の可用性から、ある (source, target) ペアに対して
    「聞く主線（S2S→翻訳音声）」と「読む主線（ASR+MT→字幕/記録）」のどちらを
    駆動するかを決定する単一責務クラス。

設計原則:
    - 純ロジック（I/O・DB・ネットワーク非依存）。transport にも依存しない。
    - 2 主線を混ぜない。ここでは「どの主線を動かすか」と provider 上書きのみ決める。
      実際の音声複製・実行は Gateway/Orchestrator（B3）が担う。
    - 可用性に基づく縮退（S2S 不可→読む主線、読む不可→聞く主線）も決定する。
入力 / 出力:
    RouteContext を受け取り RouteDecision を返す（decide）。
"""

from dataclasses import dataclass, field

from app.db.models import MeetingMode


@dataclass(frozen=True)
class RouteContext:
    """主線選択の入力。"""

    mode: str  # 会議/セッションのモード（a / b / hybrid）
    source_language: str  # 発話言語（基底コード）
    target_language: str  # 受聴者の目標言語（基底コード）
    enable_openai_s2s: bool = True  # 会議レベルの S2S 許可
    language_routes: dict = field(default_factory=dict)  # 言語ペア上書き
    s2s_available: bool = True  # 聞く主線（S2S）が利用可能か
    reading_available: bool = True  # 読む主線（ASR+MT）が利用可能か


@dataclass(frozen=True)
class RouteDecision:
    """主線選択の結果。"""

    run_hearing: bool  # 聞く主線（S2S → 翻訳音声）を駆動するか
    run_reading: bool  # 読む主線（ASR+MT → 字幕/記録）を駆動するか
    s2s_provider: str | None  # S2S provider 上書き（None=設定既定を使用）
    needs_translation: bool  # 翻訳が必要か（source != target）
    reason: str  # 決定理由（観測・ログ用）


def _route_key(source: str, target: str) -> str:
    """言語ペアの上書きキー（基底コードで照合）。"""
    src = (source or "").split("-")[0]
    tgt = (target or "").split("-")[0]
    return f"{src}->{tgt}"


class ModeRouter:
    """会議/言語ペア単位に主線を選ぶ単一責務クラス（純ロジック）。"""

    def decide(self, ctx: RouteContext) -> RouteDecision:
        """RouteContext から RouteDecision を導出する（副作用なし）。"""
        override = (ctx.language_routes or {}).get(
            _route_key(ctx.source_language, ctx.target_language), {}
        )
        mode = override.get("mode", ctx.mode)
        s2s_enabled = ctx.enable_openai_s2s and override.get("enable_openai_s2s", True)
        s2s_provider = override.get("s2s_provider")

        needs_translation = (ctx.source_language or "").split("-")[0] != (
            ctx.target_language or ""
        ).split("-")[0]

        # 翻訳不要（同一言語）: どちらの主線も翻訳は走らせない。
        # 読む主線は記録目的で transcribe を継続し得るため mode に従う。
        if not needs_translation:
            run_reading = mode in (MeetingMode.B.value, MeetingMode.HYBRID.value)
            return RouteDecision(
                run_hearing=False,
                run_reading=run_reading and ctx.reading_available,
                s2s_provider=None,
                needs_translation=False,
                reason="same_language_no_translation",
            )

        want_hearing = (
            mode in (MeetingMode.A.value, MeetingMode.HYBRID.value) and s2s_enabled
        )
        want_reading = mode in (MeetingMode.B.value, MeetingMode.HYBRID.value)

        # 可用性に基づく縮退（§9/§10 の主線間フォールバックのルーティング層）。
        run_hearing = want_hearing and ctx.s2s_available
        run_reading = want_reading and ctx.reading_available

        reason = mode
        if want_hearing and not ctx.s2s_available:
            # 聞く主線が不可: 読む主線（字幕）へ縮退して可聴性を担保する。
            if ctx.reading_available:
                run_reading = True
            reason = "s2s_unavailable_fallback_reading"
        if want_reading and not ctx.reading_available and run_hearing:
            # 読む主線が不可: 字幕は聞く主線の transcript delta で代替する。
            reason = "reading_unavailable_fallback_hearing"

        return RouteDecision(
            run_hearing=run_hearing,
            run_reading=run_reading,
            s2s_provider=s2s_provider,
            needs_translation=True,
            reason=reason,
        )


# モジュール唯一の既定インスタンス（純ロジックのため共有して安全）
mode_router = ModeRouter()
