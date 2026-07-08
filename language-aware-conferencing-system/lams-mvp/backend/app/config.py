"""
LAMS 設定モジュール
アプリケーション全体の設定を管理する

API Key優先順位: 環境変数 > .env > secrets.json
すべての設定は環境変数から読み込み、ハードコードは禁止。
"""

import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode

logger = logging.getLogger(__name__)


def _parse_csv_list(v: object) -> object:
    """カンマ区切り文字列を list へ正規化する（.env のリスト系設定用）。

    pydantic-settings は list 型フィールドの env 値を JSON として解釈するため、
    "ja,en,zh,vi" のようなカンマ区切り記法だと解析に失敗する。本ヘルパで
    カンマ区切り・JSON 配列・既存 list のいずれも受理する（NoDecode と併用）。
    """
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return []
        if s.startswith("["):  # JSON 配列記法はそのまま json で解釈
            return json.loads(s)
        return [item.strip() for item in s.split(",") if item.strip()]
    return v


def _load_secrets_json() -> dict:
    """
    secrets.json からシークレット情報を読み込む

    検索パス:
    1. 環境変数 SECRETS_JSON_PATH で指定されたパス
    2. カレントディレクトリの secrets.json
    3. backend/ ディレクトリの secrets.json
    4. プロジェクトルートの secrets.json

    Returns:
        dict: シークレット情報（見つからない場合は空辞書）
    """
    # 検索パスのリスト
    search_paths = [
        os.environ.get("SECRETS_JSON_PATH"),
        Path.cwd() / "secrets.json",
        Path(__file__).parent.parent.parent / "secrets.json",  # backend/
        Path(__file__).parent.parent.parent.parent / "secrets.json",  # project root
    ]

    for path in search_paths:
        if path is None:
            continue
        path = Path(path)
        if path.exists() and path.is_file():
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                    logger.info("secrets.json を読み込みました: %s", path)
                    return data
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("secrets.json 読み込みエラー (%s): %s", path, e)

    return {}


# secrets.json を先に読み込む（Settings初期化前に必要）
_secrets = _load_secrets_json()


def _get_secret(key: str, default: str | None = None) -> str | None:
    """
    シークレット値を取得（優先順位: 環境変数 > .env > secrets.json）

    Args:
        key: シークレットのキー名
        default: デフォルト値

    Returns:
        シークレット値（見つからない場合はデフォルト値）
    """
    # 環境変数が最優先（.envも含む、pydantic-settingsが処理）
    env_value = os.environ.get(key.upper())
    if env_value:
        return env_value

    # secrets.json から取得
    secrets_value = _secrets.get(key) or _secrets.get(key.lower())
    if secrets_value:
        return secrets_value

    return default


class Settings(BaseSettings):
    """
    アプリケーション設定クラス

    API Key優先順位: 環境変数 > .env
    デフォルト値は開発環境用。本番環境では必ず環境変数で上書きすること。
    """

    # ===========================================
    # データベース設定
    # ローカル開発時はDocker DB（host.docker.internal:5433）を使用
    # ===========================================
    database_url: str = (
        "postgresql://lams:lams_secret_2024@host.docker.internal:5433/lams"
    )

    # ===========================================
    # Redis設定
    # ローカル開発時はDocker Redis（host.docker.internal:6380）を使用
    # ===========================================
    redis_url: str = "redis://host.docker.internal:6380/0"

    # ===========================================
    # JWT認証設定
    # ===========================================
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24時間

    # ===========================================
    # AIプロバイダー設定
    # ===========================================
    # プロバイダー選択: gpt4o_transcribe, gpt_realtime, deepgram, google, gemini_live
    #   google = Mode B（Chirp 3 ASR + Cloud Translation）。認証/ライブラリ未整備時は
    #            起動エラーにせず gpt4o_transcribe へ自動フォールバックする。
    #   gemini_live = Gemini Live API による S2S 翻訳（音声直接翻訳）。GEMINI_API_KEY
    #            未設定時は起動エラーにせず gpt4o_transcribe へ自動フォールバックする。
    ai_provider: Literal[
        "gpt4o_transcribe", "gpt_realtime", "deepgram", "google", "gemini_live"
    ] = "gpt4o_transcribe"

    # -------------------------------------------
    # ステージ別プロバイダースロット（Phase 2-T5.5 / 集中管理）
    # -------------------------------------------
    # ASR / MT / TTS を独立に切替可能にするスロット。registry.py のカタログ名を指定。
    # "auto"（既定）の場合は ai_provider プリセットから既定名を導出し、3スロットとも
    # "auto" なら従来の一体型 provider をそのまま使う（完全な後方互換・非介入）。
    # いずれか1つでも非 "auto" を指定すると CompositeAIProvider が有効化される。
    #   - asr_provider: auto / gpt4o / deepgram / google / local
    #   - mt_provider : auto / openai / google / local
    #   - tts_provider: auto / openai / none / local
    # "local" は Lite 本地栈（faster-whisper / OPUS-MT-CT2 / Kokoro）。ランタイム
    # 未導入時は registry の available() が False を返し雲へ自動フォールバックする。
    asr_provider: Literal["auto", "gpt4o", "deepgram", "google", "local"] = "auto"
    mt_provider: Literal["auto", "openai", "google", "local"] = "auto"
    tts_provider: Literal["auto", "openai", "none", "local"] = "auto"

    # -------------------------------------------
    # Lite 本地モデル設定（改善案 §4 / §6：faster-whisper・OPUS-MT・Kokoro・VAD）
    # -------------------------------------------
    # GPU 予算（MB）。VRAM Broker がこの範囲でモデル常駐を調停する（12GB の目安）。
    vram_budget_mb: int = 11000
    # VAD バックエンド: energy（既定・CPU エネルギー閾値）/ silero（Silero VAD）。
    # silero 指定時にランタイム未導入なら energy へ自動フォールバックする。
    vad_backend: Literal["energy", "silero"] = "energy"

    # 本地 ASR（faster-whisper / CTranslate2）
    local_asr_model: str = "large-v3-turbo"
    local_asr_device: str = "cuda"  # cuda / cpu
    local_asr_compute_type: str = "int8"  # int8 / int8_float16 / float16
    local_asr_size_mb: int = 1600  # VRAM Broker 会計用の概算常駐サイズ

    # 本地 MT（OPUS-MT / Marian + CTranslate2）。model_dir は言語対別モデルの
    # 親ディレクトリ（例: {dir}/opus-mt-ja-en）。未設定なら local MT は利用不可。
    local_mt_model_dir: str | None = None
    local_mt_device: str = "cpu"  # 軽量翻訳は CPU 常駐が既定（§6.1）
    local_mt_compute_type: str = "int8"
    local_mt_size_mb: int = 300  # 1 言語対あたりの概算サイズ

    # 本地 TTS（Kokoro-82M / Piper）。Lite の訳音は任意（字幕優先）。
    local_tts_model: str = "kokoro-82m"
    local_tts_voice: str = "af_heart"
    local_tts_device: str = "cpu"
    local_tts_size_mb: int = 400

    # -------------------------------------------
    # ストリーミング字幕（P2：partial/final 事件協議）
    # -------------------------------------------
    # 発話確定前に ASR 原文の暫定字幕（interim）を配信し首字遅延を短縮する。
    # 既定 False（従来どおり final のみ。有効化は本地/低遅延 ASR 環境向け）。
    enable_partial_subtitles: bool = False
    # 暫定字幕を出す発話中の累積音声間隔（ms）。この長さ毎に interim を1回出す。
    partial_ms: int = 700

    # -------------------------------------------
    # 離線高質量重跑・音声アーカイブ（P3-D：改善案 §5.3）
    # -------------------------------------------
    # 音声の暗号化アーカイブを有効化する。既定 False（プライバシー既定オフ）。
    # 有効時のみ発話音声を audio_archive_dir へ AES-GCM で暗号化保存し、DB には
    # audio_hash 参照のみを持つ。会議の同意ポリシーに従って有効化すること。
    enable_audio_archive: bool = False
    # 暗号化アーカイブの保存先ディレクトリ。
    audio_archive_dir: str = "/data/audio_archive"
    # AES-GCM 鍵（base64 で 32 バイト）。未設定なら暗号化不可でアーカイブは無効化される。
    audio_archive_key: str | None = None
    # アーカイブ保持日数（この日数を超えた音声は purge 対象。0 以下で無期限）。
    audio_retention_days: int = 30
    # 中間パイプライン事件（回放ログ）を DB に記録する。既定 True（重跑の前提）。
    # 音声アーカイブ無効でも MT 再処理のため事件は記録する価値がある。
    enable_pipeline_event_log: bool = True

    # -------------------------------------------
    # 話者分離 diarization（P4-A：改善案 §4）
    # -------------------------------------------
    # 声紋 embedding による話者識別/クラスタリングを有効化する。既定 False。
    # 有効時のみ発話音声から embedding を抽出し、consent 済み登録話者と照合、
    # 未登録は会議内クラスタリングで "Speaker N" を付与する（speaker_id は不変）。
    enable_diarization: bool = False
    # 声紋 embedding バックエンド: none（無効）/ resemblyzer（Resemblyzer）。
    # resemblyzer 指定でランタイム未導入なら diarization は自動無効化される。
    speaker_embed_backend: Literal["none", "resemblyzer"] = "none"
    # 登録話者と一致とみなす余弦類似度の閾値（この値以上で登録話者に帰属）。
    speaker_match_threshold: float = 0.75
    # 会議内クラスタリングで同一話者とみなす余弦類似度の閾値。
    speaker_cluster_threshold: float = 0.70

    # -------------------------------------------
    # A/B テスト配信（P4-C：改善案 §5.1）
    # -------------------------------------------
    # モデル候補の A/B 実験配信を有効化する。既定 False（無効時は常に既定モデル）。
    enable_ab_testing: bool = False
    # 実験定義の JSON 文字列（配列）。各要素は
    # {"key","stage","unit","enabled","variants":[{"name","model_id","weight"}]}。
    # 例: '[{"key":"asr_ab","stage":"asr","unit":"session","enabled":true,
    #   "variants":[{"name":"control","model_id":"asr-openai-transcribe","weight":50},
    #   {"name":"treatment","model_id":"asr-faster-whisper","weight":50}]}]'
    # JSON 不正・個別実験不正は fail-safe で空/当該のみスキップ（ライブを壊さない）。
    experiments_config: str | None = None

    # -------------------------------------------
    # プロバイダー・プラグイン SDK（P4-D：改善案 §5.1）
    # -------------------------------------------
    # 外部 ASR/MT/TTS プラグインの読み込みを有効化する。既定 False（信頼境界）。
    enable_provider_plugins: bool = False
    # 読み込むプラグインモジュールの import パス（カンマ区切り）。各モジュールは
    # register(registry) 関数または PLUGINS(list) を公開する。import 失敗・不正定義は
    # fail-safe で当該のみスキップし、コア（既定プロバイダー）を壊さない。
    # 例: "myorg.lams_plugins.whisperx, myorg.lams_plugins.elevenlabs"
    provider_plugins: str | None = None

    # -------------------------------------------
    # モデル治理カタログのランタイム選択（P4-wiring：改善案 §5.1）
    # -------------------------------------------
    # 有効時、各ステージの "auto" スロットを model_registry の production カード
    # （provider_name）で解決する。既定 False＝従来のプリセット既定で解決（挙動不変）。
    # これにより治理カタログの production 昇格が実行時プロバイダー選択へ反映される。
    use_model_registry_selection: bool = False

    # -------------------------------------------
    # OpenAI API 設定（gpt4o_transcribe, gpt_realtime共通）
    # -------------------------------------------
    openai_api_key: str | None = None
    openai_base_url: str | None = None  # カスタムエンドポイント（オプション）

    # GPT-4o-transcribe 設定（ASR用、300-500ms）
    # 最新モデル: gpt-4o-transcribe, gpt-4o-mini-transcribe
    openai_transcribe_model: str = "gpt-4o-transcribe"

    # 言語自動検出専用モデル。verbose_json（language フィールド）対応は whisper-1 のみ。
    openai_detect_model: str = "whisper-1"

    # GPT-Realtime S2S 設定（音声直接翻訳、WebSocket API）
    # 最新モデル: gpt-realtime-1.5（推奨）, gpt-realtime, gpt-realtime-mini
    # gpt-realtime-1.5: +7%命令追従、+10%英数字精度、多言語対応向上
    openai_realtime_model: str = "gpt-realtime-1.5"

    # テキスト翻訳用モデル
    openai_translate_model: str = "gpt-4o-mini"

    # 議事録・要約生成用モデル（Phase 1-T5。長文要約のため translate と分離）
    openai_minutes_model: str = "gpt-4o-mini"

    # TTS用モデルと音声
    openai_tts_model: str = "tts-1"
    openai_tts_voice: str = "alloy"

    # -------------------------------------------
    # 言語検出設定
    # -------------------------------------------
    # 言語検出モード:
    #   - auto: 自動検出（Whisper/GPT-4oで言語を検出）
    #   - hint: 話者のnative_languageをヒントとして使用（検出なし）
    language_detection_mode: Literal["auto", "hint"] = "auto"

    # -------------------------------------------
    # Deepgram API 設定（ASR用、200-400ms）
    # -------------------------------------------
    deepgram_api_key: str | None = None
    deepgram_base_url: str | None = None  # カスタムエンドポイント（オプション）
    # Nova-3は最新の高精度・低遅延モデル
    deepgram_model: str = "nova-3"
    # ストリーミングASR用設定
    deepgram_language: str = "multi"  # multi = 多言語自動検出

    # -------------------------------------------
    # Gemini API 設定（将来の拡張用、現在未使用）
    # -------------------------------------------
    gemini_api_key: str | None = None
    gemini_base_url: str | None = None
    gemini_model: str = "models/gemini-2.5-flash-native-audio-preview-12-2025"
    gemini_text_model: str = "models/gemini-2.5-flash"

    # Gemini Live API S2S 翻訳モデル（ai_provider="gemini_live" 時に使用）
    # 音声入力（16kHz PCM）→ 翻訳音声（24kHz PCM）+ 翻訳/原文字幕を同時取得。
    gemini_live_model: str = "models/gemini-3.5-live-translate-preview"

    # -------------------------------------------
    # LLM 補正設定（改善.md 11章 / Mode B・fallback 用）
    # -------------------------------------------
    # 翻訳結果の校正（表記統一・文脈補正・数字保持）に使う LLM プロバイダー。
    #   - off   : 補正を行わない（既定。既存翻訳フローへ非介入）
    #   - gemini: Gemini で校正（GEMINI_API_KEY 必須。未設定時は自動で無効化）
    llm_correction_provider: Literal["off", "gemini"] = "off"

    # 議事録・要約（Phase 1-T5）生成に使う LLM プロバイダー選択ポリシー。
    #   - auto  : GPT 優先（OPENAI_API_KEY あれば GPT、無ければ Gemini へ fallback）
    #   - gpt   : GPT 固定（OPENAI_API_KEY 必須）
    #   - gemini: Gemini 固定（GEMINI_API_KEY 必須）
    #   - off   : 議事録生成を無効化（API は 503 を返す）
    llm_minutes_provider: Literal["auto", "gpt", "gemini", "off"] = "auto"

    # -------------------------------------------
    # Google Cloud 設定（改善.md Mode B：Chirp 3 ASR + Cloud Translation）
    # -------------------------------------------
    # 認証は GOOGLE_APPLICATION_CREDENTIALS（サービスアカウント JSON パス）または
    # ADC を使用。GOOGLE_PROJECT_ID 未設定時は google プロバイダーは無効扱い。
    google_project_id: str | None = None
    # Chirp 3 は Speech-to-Text V2 の地域エンドポイントが必要（既定: us-central1）
    google_speech_location: str = "us-central1"
    google_speech_model: str = "chirp_3"
    # Cloud Translation v3 のロケーション（用語集利用時は global 以外が必要な場合あり）
    google_translate_location: str = "global"
    # サーバー側用語集リソース ID（任意。adaptive/glossary 連携用）
    google_glossary_id: str | None = None

    # -------------------------------------------
    # LiveKit / WebRTC 設定（Phase 3 C1：単一トランスポート）
    # -------------------------------------------
    # WS を廃止し WebRTC/LiveKit へ一本化する。バックエンドは（1）参加トークン発行と
    # （2）LiveKit Agent（音声フォーク Gateway）でのみ LiveKit と通信する。
    #   - livekit_url       : サーバ→LiveKit の接続先（ws://livekit:7880 等）。
    #   - livekit_ws_url    : フロントへ返す公開 URL（未設定時は livekit_url を流用）。
    #   - livekit_api_key   : API キー（トークン署名・Room API 用）。
    #   - livekit_api_secret: API シークレット（トークン署名用）。
    #   - livekit_agent_name: Agent dispatch 名（任意。明示 dispatch 時のみ使用）。
    #   - livekit_agent_autostart: トークン発行時にバックエンド内で Agent を
    #       自動起動するか（True で in-process worker を room 毎に常駐させる）。
    #       既定 False（外部 worker 運用やテスト時の副作用回避のため）。
    # いずれかが未設定なら token API は 503 を返す（起動は阻害しない）。
    livekit_url: str = "ws://localhost:7880"
    livekit_ws_url: str | None = None
    livekit_api_key: str | None = None
    livekit_api_secret: str | None = None
    livekit_agent_name: str | None = None
    livekit_agent_autostart: bool = False

    def get_livekit_ws_url(self) -> str:
        """フロントへ返す LiveKit 接続 URL（公開 URL 優先、無ければ内部 URL）。"""
        return self.livekit_ws_url or self.livekit_url

    def livekit_enabled(self) -> bool:
        """トークン発行に必要な鍵が揃っているか（未設定なら token API を 503 に）。"""
        return bool(self.livekit_api_key and self.livekit_api_secret)

    # ===========================================
    # QoS設定（認知負荷軽減のため）
    # ===========================================
    max_latency_ms: int = 1200  # 最大許容遅延
    max_jitter_ms: int = 200  # 最大許容ジッター

    # ===========================================
    # CORS設定
    # ポート変更は .env の FRONTEND_PORT / HOST_IP のみ変更すれば自動反映。
    # ここにハードコードされたポート番号は存在しない。
    # ===========================================
    host_ip: str = "localhost"
    # 環境変数 FRONTEND_PORT を自動読み込み（ポート変更時は .env のみ変更）
    frontend_port: int = 5273
    # 追加許可オリジン（省略可。HOST_IP + frontend_port は get_cors_origins() で自動生成）
    cors_origins: Annotated[list[str], NoDecode] = []

    def get_cors_origins(self) -> list[str]:
        """
        CORS許可オリジンを動的生成

        HOST_IP と frontend_port（環境変数 FRONTEND_PORT）から自動生成するため、
        ポート変更は .env の FRONTEND_PORT を書き換えるだけで反映される。
        cors_origins フィールドに追加オリジンを指定することも可能。
        """
        origins = set(self.cors_origins)
        # HOST_IP が設定されていればLAN向けオリジンを追加
        if self.host_ip and self.host_ip != "localhost":
            origins.add(f"http://{self.host_ip}:{self.frontend_port}")
        # localhost系は常に含める（ポート番号は FRONTEND_PORT から取得）
        origins.add(f"http://localhost:{self.frontend_port}")
        origins.add(f"http://127.0.0.1:{self.frontend_port}")
        return list(origins)

    # ===========================================
    # 環境設定
    # ===========================================
    env: str = "development"

    # ===========================================
    # 対応言語（日本語、英語、中国語、ベトナム語）
    # ===========================================
    supported_languages: Annotated[list[str], NoDecode] = ["ja", "en", "zh", "vi"]

    # env のカンマ区切り記法（例: "ja,en,zh,vi"）を list へ正規化する。NoDecode で
    # pydantic-settings の JSON 前提を無効化し、本 validator で解釈する。
    @field_validator("supported_languages", "cors_origins", mode="before")
    @classmethod
    def _split_list_fields(cls, v: object) -> object:
        return _parse_csv_list(v)

    class Config:
        """Pydantic設定"""

        env_file = ".env"
        extra = "ignore"

    def __init__(self, **kwargs: object) -> None:
        """secrets.json から API キーを補完（環境変数/.env より低優先度）"""
        super().__init__(**kwargs)
        if not self.openai_api_key:
            self.openai_api_key = _get_secret("OPENAI_API_KEY")
        if not self.deepgram_api_key:
            self.deepgram_api_key = _get_secret("DEEPGRAM_API_KEY")
        if not self.gemini_api_key:
            self.gemini_api_key = _get_secret("GEMINI_API_KEY")


@lru_cache
def get_settings() -> Settings:
    """
    設定インスタンスを取得（キャッシュ済み）

    API Key優先順位: 環境変数 > .env

    Returns:
        Settings: アプリケーション設定
    """
    return Settings()


settings = get_settings()
