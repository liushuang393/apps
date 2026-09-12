"""
TTS 音色クローンの同意判定（改善案 §4.4 / §5.2 / P4-B）。

個人の声を模した音色クローンは「本人同意 + 用途限定 + 透かし必須」を絶対要件とし、
**無同意のデフォルト参会者クローンを禁じる**。本モジュールは TTSConsent テーブルを
参照して 1 件のクローン要求が許可されるか（および透かし必須か）を判定する。

設計原則:
    - 既定拒否（fail-closed）: 同意が確認できない・DB 障害時は allowed=False を返す。
      合成音の出所不明なクローンを絶対に通さない（安全側）。
    - 有効な同意 = granted=True かつ revoked_at 未設定（失効していない）かつ scope 一致。
    - セッションは app.db.database.async_session を用いる（テストは差し替え可能）。
"""

import logging
from dataclasses import dataclass

from sqlalchemy import select

from app.db.database import async_session
from app.db.models import TTSConsent

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ConsentDecision:
    """クローン許可の判定結果。

    allowed: 許可されたか（False なら絶対にクローンしない）。
    watermark_required: 許可時に透かしを必須とするか（既定 True）。
    reason: 判定理由（監査・ログ用の短い説明）。
    """

    allowed: bool
    watermark_required: bool
    reason: str


# 拒否時の既定（透かしは常に必須側へ倒す。安全側の既定）。
_DENY = ConsentDecision(allowed=False, watermark_required=True, reason="no_consent")


async def check_clone_consent(
    user_id: str, voice_id: str, scope: str = "meeting"
) -> ConsentDecision:
    """(user_id, voice_id, scope) のクローン同意を判定する（既定拒否）。

    入力: 対象話者 user_id・音色 voice_id・用途 scope。
    出力: ConsentDecision（allowed / watermark_required / reason）。
    注意点: 有効な同意が無ければ allowed=False。DB 障害時も allowed=False（fail-closed）。
        watermark_required は同意レコードの値を尊重し、既定は True。
    """
    if not user_id or not voice_id:
        return ConsentDecision(False, True, "missing_identifiers")
    try:
        async with async_session() as db:
            row = (
                await db.execute(
                    select(TTSConsent).where(
                        TTSConsent.user_id == user_id,
                        TTSConsent.voice_id == voice_id,
                        TTSConsent.scope == scope,
                        TTSConsent.granted.is_(True),
                        TTSConsent.revoked_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return _DENY
            return ConsentDecision(
                allowed=True,
                # 明示的に False の時のみ透かし任意。NULL/未設定は安全側（必須）へ倒す。
                watermark_required=row.watermark_required is not False,
                reason="granted",
            )
    except Exception as e:  # noqa: BLE001 - 判定不能は fail-closed（拒否）
        logger.warning(
            "[VOICE] クローン同意判定エラー(user=%s, voice=%s): %s",
            user_id,
            voice_id,
            e,
        )
        return ConsentDecision(False, True, "consent_check_error")
