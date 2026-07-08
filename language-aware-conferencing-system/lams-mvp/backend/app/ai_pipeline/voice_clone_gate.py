"""
音色クローン合成のゲート（改善案 §4.4 / P4-B）。

「無同意ではクローンしない・同意時も透かしを必須にする」を1点で強制する境界。
将来クローン対応 TTS エンジンを差し込む際は必ず本ゲート経由で合成させることで、
§4.4 の倫理・法務要件（本人同意 + 用途限定 + 透かし）をコードで担保する。

設計原則:
    - 同意ゲート優先: consent が無ければクローン合成関数を**呼ばない**（return None）。
      呼び出し側は既定（非クローン）音色へフォールバックする。
    - 透かし必須: 同意が watermark_required=True なら合成音へ必ず透かしを適用する。
      透かし適用に失敗しても無透かしのクローン音は配信しない（None を返す）。
    - クローン合成関数は注入（テスト・エンジン差し替え可能）。
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.ai_pipeline.voice_consent import ConsentDecision, check_clone_consent
from app.audio.watermark import apply_watermark, is_watermarked

logger = logging.getLogger(__name__)

# クローン合成関数: (text, language, voice_id) -> WAV バイト列（失敗・空は None）。
CloneSynthFn = Callable[[str, str, str], Awaitable[bytes | None]]
# 同意判定関数: (user_id, voice_id, scope) -> ConsentDecision。
ConsentChecker = Callable[[str, str, str], Awaitable[ConsentDecision]]


@dataclass(frozen=True)
class CloneResult:
    """クローン合成の結果。

    audio: 合成音（許可+成功時のみ非 None。透かし必須なら透かし済み）。
    allowed: 同意により合成が許可されたか。
    watermarked: 透かしが適用されたか。
    reason: 判定/失敗理由（監査・ログ用）。
    """

    audio: bytes | None
    allowed: bool
    watermarked: bool
    reason: str


class VoiceCloneGate:
    """同意確認 + 透かし必須を強制して音色クローンを合成するゲート。"""

    def __init__(
        self,
        clone_synth_fn: CloneSynthFn,
        *,
        consent_checker: ConsentChecker = check_clone_consent,
    ) -> None:
        self._synth = clone_synth_fn
        self._check = consent_checker

    async def synthesize(
        self,
        *,
        user_id: str,
        voice_id: str,
        text: str,
        language: str,
        scope: str = "meeting",
    ) -> CloneResult:
        """同意を確認し、許可時のみ（透かし付きで）クローン音を合成する。

        入力: 対象話者 user_id・音色 voice_id・原稿 text・言語・用途 scope。
        出力: CloneResult。未同意なら audio=None（呼び出し側は既定音色へ縮退）。
        注意点: 未同意ではクローン合成関数を呼ばない。透かし必須で透かし不成立なら
            無透かしのクローン音は配信せず audio=None を返す（安全側）。
        """
        decision = await self._check(user_id, voice_id, scope)
        if not decision.allowed:
            logger.warning(
                "[VOICE] 無同意のクローンを拒否(user=%s, voice=%s, reason=%s)",
                user_id,
                voice_id,
                decision.reason,
            )
            return CloneResult(None, False, False, decision.reason)

        audio = await self._synth(text, language, voice_id)
        if not audio:
            return CloneResult(None, True, False, "synth_failed")

        if not decision.watermark_required:
            return CloneResult(audio, True, False, "granted_no_watermark")

        marked = apply_watermark(audio)
        # 透かしが実際に付いたことを検証。付かなければクローン音を配信しない。
        if not is_watermarked(marked):
            logger.error(
                "[VOICE] 透かし適用に失敗したためクローン音を破棄(user=%s, voice=%s)",
                user_id,
                voice_id,
            )
            return CloneResult(None, True, False, "watermark_failed")
        return CloneResult(marked, True, True, "granted_watermarked")
