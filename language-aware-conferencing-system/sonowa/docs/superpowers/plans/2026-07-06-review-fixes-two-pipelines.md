# 2 方式パイプライン確定欠陥修正 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** コードレビュー（2026-07-06 実施）で確定した 15 欠陥を、S2S 主線・カスケード主線の 2 方式アーキテクチャを保ったまま修正する。

**Architecture:** 修正は 3 フェーズ。Phase 1 = 単発の確定欠陥（センチネル文字列・キャッシュ汚染・API 誤用・設定ガード）を独立タスクで潰す。Phase 2 = 構造欠陥（二重 ASR、字幕ブロッキング、ingest 直列化、共有トラックの混入/エコー、QoS 縮退未配線）を orchestrator / agent / publisher の責務を保ったまま是正。Phase 3 = 翻訳キャッシュの次元不足と障害固定化を解消。

**Tech Stack:** Python 3.11 / FastAPI / asyncio / LiveKit（livekit-rtc, livekit-api）/ Redis / pytest。フロントは React 18 + TypeScript（テストランナーなし、`npm run type-check` と `npm run lint` で検証）。

**Out of scope（別計画とする独立サブシステム）:**
- S2S 常駐 Realtime セッション再設計（room×言語ペア単位のストリーミング化）
- オープンソースモデル（faster-whisper / NLLB / Piper 等）の registry ステージ統合

## Global Constraints

- ソースファイルは 1000 行未満（絶対上限）、クラスファイルは最大 500 行（`.claude/CLAUDE.md`）
- コードコメントは日本語。関数は目的・入出力・注意点を記載
- `print` / `console.log` 禁止（Python は `logging`）。マジックナンバー禁止（定数化）
- Python: 型ヒント必須。Ruff ルール `E,W,F,I,B,C4,UP,ARG,SIM`
- TypeScript: `strict: true`、`any` 禁止（`unknown` 使用）
- コミットは Conventional Commits 形式（`fix:` / `refactor:` / `test:`）
- バックエンドのテストは `cd backend && python -m pytest tests/<file>.py -v` で実行
- コミット前に `cd backend && ruff check app/ tests/ && ruff format --check app/ tests/` がエラー 0 であること。最終タスクで `./scripts/check.sh` を通す

---

# Phase 1: 単発の確定欠陥修正

### Task 1: センチネル文字列の全廃（空文字列プロトコルへ統一）

**背景（欠陥 #8）:** `"[ASRエラー: X]"` / `"[翻訳失敗]"` / `"[処理エラー]"` / `"[エラー: X]"` が正常テキストとして下流へ流れ、TTS で読み上げられ、orchestrator の `hearing_failed` 判定（テキスト空か否か）を素通りして縮退が発動しない。**契約を「失敗 = 空文字列」に統一する。**

**Files:**
- Modify: `backend/app/ai_pipeline/providers/gpt4o_transcribe.py:112,258,278-281,314-322`
- Modify: `backend/app/ai_pipeline/providers/gpt_realtime.py:245,643,707-715`
- Modify: `backend/app/ai_pipeline/providers/deepgram.py`（grep で特定）
- Modify: `backend/app/ai_pipeline/providers/google.py:306,324`
- Modify: `backend/app/ai_pipeline/pipeline.py:175-186`
- Modify: `backend/app/ai_pipeline/registry.py:124,131-138`
- Modify: `backend/app/translate/routes.py`（`return "[翻訳失敗]"` の 1 箇所）
- Test: `backend/tests/test_ai_providers.py`（追記）、`backend/tests/test_orchestrator.py`（追記）

**Interfaces:**
- Produces: 全 `AIProvider.transcribe_audio` は失敗時 `""` を返す。`translate_audio` は失敗時 `TranslationResult(original_text="", translated_text="", audio_data=None)`（同一言語パスの original は認識結果のまま）。`AIPipeline.process_audio` は例外時 `original_text="" / translated_text=""` の `ProcessedAudio` を返す。後続タスク（Task 10, 13）はこの「空 = 失敗」契約に依存する。
- 注意: `backend/app/webrtc/processor.py` の `_is_provider_error_text` は多層防御として**残す**（変更しない）。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_ai_providers.py` に追記:

```python
@pytest.mark.asyncio
async def test_transcribe_error_returns_empty(monkeypatch):
    """ASR 例外時はセンチネル文字列ではなく空文字列を返す（欠陥 #8）。"""
    from app.ai_pipeline.providers.gpt4o_transcribe import GPT4oTranscribeProvider

    provider = GPT4oTranscribeProvider.__new__(GPT4oTranscribeProvider)
    provider._client = None

    async def boom():
        raise RuntimeError("api down")

    monkeypatch.setattr(provider, "_get_client", boom)
    text = await provider.transcribe_audio(b"\x00" * 9000, "ja")
    assert text == ""


@pytest.mark.asyncio
async def test_translate_audio_error_returns_empty_result(monkeypatch):
    """translate_audio 例外時は両テキスト空の結果を返す（TTS 読み上げ禁止）。"""
    from app.ai_pipeline.providers.gpt4o_transcribe import GPT4oTranscribeProvider

    provider = GPT4oTranscribeProvider.__new__(GPT4oTranscribeProvider)
    provider._client = None

    async def boom():
        raise RuntimeError("api down")

    monkeypatch.setattr(provider, "_get_client", boom)
    result = await provider.translate_audio(b"\x00" * 9000, "ja", "en")
    assert result.original_text == ""
    assert result.translated_text == ""
    assert result.audio_data is None
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_ai_providers.py::test_transcribe_error_returns_empty tests/test_ai_providers.py::test_translate_audio_error_returns_empty_result -v`
Expected: FAIL（現状は `"[ASRエラー: RuntimeError]"` / `"[エラー: RuntimeError]"` が返る）

- [ ] **Step 3: センチネル箇所を洗い出す**

Run: `cd backend && grep -rn '\[ASRエラー\|\[翻訳失敗\]\|\[処理エラー\]\|\[エラー:\|\[ASR error\|startswith("\[")' app/ --include="*.py"`

以下 Step 4-7 の各修正がこのリストを全て消すこと（processor.py の `_ERROR_PREFIXES` / `_is_provider_error_text` は防御用に残す）。

- [ ] **Step 4: gpt4o_transcribe.py を修正**

112 行目: `return f"[ASRエラー: {type(e).__name__}]"` → `return ""`

258 行目: `if not original_text or original_text.startswith("["):` → `if not original_text:`

278-281 行目（`[翻訳失敗]` 代入）を「空なら TTS せず早期 return」へ:

```python
            translated_text = translated_text.strip() if translated_text else ""

            if not translated_text:
                # 失敗 = 空文字列の契約。センチネルを TTS へ流さない（欠陥 #8）。
                logger.warning(
                    f"[GPT4o-transcribe] 翻訳結果が空のため TTS をスキップ: "
                    f"'{original_text[:30]}'"
                )
                return TranslationResult(
                    source_language=source_language,
                    target_language=target_language,
                    original_text=original_text,
                    translated_text="",
                    audio_data=None,
                )
```

314-322 行目の except 節: `original_text=f"[エラー: ...]"` / `translated_text=f"[エラー: ...]"` → 両方 `""`

- [ ] **Step 5: gpt_realtime.py / deepgram.py / google.py を修正**

- `gpt_realtime.py:245`: `return f"[ASRエラー: {type(e).__name__}]"` → `return ""`
- `gpt_realtime.py:643`: `if not original_text or original_text.startswith("["):` → `if not original_text:`
- `gpt_realtime.py:707-715` except 節: 両テキスト `""` へ
- `deepgram.py`: Step 3 の grep 結果に従い同パターンで修正（ASR エラー文字列 → `""`、`startswith("[")` 条件 → 空判定のみ、`[翻訳失敗]` → 空のまま TTS スキップ）
- `google.py:306`: `if not original_text or original_text.startswith("["):` → `if not original_text:`
- `google.py:324`: `translated_text=translated_text or "[翻訳失敗]"` → `translated_text=translated_text or ""`

- [ ] **Step 6: pipeline.py / registry.py / translate/routes.py を修正**

`pipeline.py:175-186` except 節:

```python
        except Exception as e:
            logger.error(f"AI処理エラー: {e}")
            metrics = self._qos.end_measurement(metrics)
            # 失敗 = 空文字列（センチネル禁止）。orchestrator の縮退判定が依存する。
            return ProcessedAudio(
                speaker_id=speaker_id,
                source_language=source_language,
                target_language=target_language,
                original_text="",
                translated_text="",
                audio_data=None,
                metrics=metrics,
            )
```

`registry.py` `CompositeAIProvider.translate_audio`（117-141 行）:

```python
        original = await self._asr.transcribe_audio(audio_data, source_language)
        if not original:
            return TranslationResult(
                source_language, target_language, "", "", None
            )
        translated = await self._mt.translate_text(
            original, source_language, target_language
        )
        audio_out: bytes | None = None
        # 空訳（失敗）はセンチネル化せず TTS もスキップする（欠陥 #8）。
        if translated and self._tts is not None:
            try:
                audio_out = await self._tts.synthesize(translated, target_language)
            except Exception as e:  # noqa: BLE001 - TTS 失敗は字幕継続のため握り潰す
                logger.warning("[Composite] TTS 失敗: %s", e)
        return TranslationResult(
            source_language, target_language, original, translated or "", audio_out
        )
```

`translate/routes.py`（`_call_openai_translate` 内、約 306 行）: `return "[翻訳失敗]"` → `return ""`

- [ ] **Step 7: テストが通ることを確認し、既存テストの期待値を更新**

Run: `cd backend && python -m pytest tests/ -v`
Expected: Step 1 の 2 テスト PASS。センチネル文字列を期待する既存テスト（`test_ai_providers.py` / `test_mode2_quality_path.py` 等）が落ちたら、期待値を `""` / 空判定へ更新して再実行し全 PASS。

- [ ] **Step 8: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app backend/tests
git commit -m "fix: エラー時センチネル文字列を全廃し空文字列契約へ統一（TTS読み上げ・縮退素通り防止）"
```

---

### Task 2: pipeline の音声ハッシュ Redis キャッシュを削除

**背景（欠陥 #4 後半）:** `AIPipeline` の `translate:{src}:{tgt}:{md5(音声)}` キャッシュは (a) 空/エラー結果を 1 時間汚染し、(b) ヒット時に `audio_data=None` で翻訳音声を消失させ、(c) 生 PCM の MD5 一致はライブマイクではほぼ起きないため実効ヒット率 ≈ 0 のままホットパスに Redis 2 往復を追加している。テキスト翻訳キャッシュは `translate_text_simple` 層に既存のため、**この層のキャッシュは削除する。**

**Files:**
- Modify: `backend/app/ai_pipeline/pipeline.py:11-16,50-80,134-163`
- Test: `backend/tests/test_ai_providers.py`（追記）

**Interfaces:**
- Produces: `AIPipeline.process_audio` はキャッシュせず毎回プロバイダーを呼ぶ。`AIPipeline` から `_redis` / `_get_redis` / `_cache_key` / `_get_cached` / `_set_cached` / `_cache_ttl` が消える（他モジュールからの参照なし。確認: `grep -rn "_set_cached\|_get_cached" backend/app` が pipeline.py のみ）。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_ai_providers.py` に追記:

```python
@pytest.mark.asyncio
async def test_process_audio_no_cache(monkeypatch):
    """同一音声でも毎回プロバイダーを呼ぶ（音声ハッシュキャッシュ廃止、欠陥 #4）。"""
    from app.ai_pipeline.pipeline import AIPipeline
    from app.ai_pipeline.providers.base import TranslationResult

    class FakeProvider:
        def __init__(self) -> None:
            self.calls = 0

        async def translate_audio(self, audio, src, tgt):
            self.calls += 1
            return TranslationResult(src, tgt, "こんにちは", "hello", b"WAVDATA")

        async def transcribe_audio(self, audio, lang):
            return "こんにちは"

    pipeline = AIPipeline.__new__(AIPipeline)
    from app.ai_pipeline.qos import QoSController

    pipeline._qos = QoSController()
    fake = FakeProvider()
    pipeline._provider = fake

    r1 = await pipeline.process_audio(b"\x01" * 100, "ja", "en")
    r2 = await pipeline.process_audio(b"\x01" * 100, "ja", "en")
    assert fake.calls == 2  # キャッシュで 2 回目が飛ばされない
    assert r1.audio_data == b"WAVDATA"
    assert r2.audio_data == b"WAVDATA"  # 音声がキャッシュヒットで消えない
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_ai_providers.py::test_process_audio_no_cache -v`
Expected: FAIL（2 回目はキャッシュヒットし `calls == 1`、Redis 未起動環境では `_get_cached` が None を返し PASS する可能性あり。その場合も Step 3 実施後に構造が単純化されることを diff で確認）

- [ ] **Step 3: キャッシュ機構を削除**

`pipeline.py` から以下を削除:
- `import hashlib`、`import redis.asyncio as aioredis`
- `__init__` の `self._redis` / `self._cache_ttl`
- `_get_redis` / `_cache_key` / `_get_cached` / `_set_cached` メソッド
- `process_audio` 内の「キャッシュチェック」ブロック（134-151 行）と「キャッシュ保存」（159-162 行）

`process_audio` の翻訳部は次の形になる:

```python
        # AI翻訳実行（キャッシュなし: 生PCMのMD5一致は実運用でほぼ発生せず、
        # 空結果汚染・音声消失の温床だったため撤去。テキスト翻訳キャッシュは
        # translate_text_simple 層に存在する）
        try:
            result = await self._provider.translate_audio(
                audio_data, source_language, target_language
            )
            metrics = self._qos.end_measurement(metrics)
            return ProcessedAudio(
                speaker_id=speaker_id,
                source_language=source_language,
                target_language=target_language,
                original_text=result.original_text,
                translated_text=result.translated_text,
                audio_data=result.audio_data,
                metrics=metrics,
            )
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && python -m pytest tests/test_ai_providers.py -v`
Expected: PASS（全件）

- [ ] **Step 5: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/ai_pipeline/pipeline.py backend/tests/test_ai_providers.py
git commit -m "fix: AIPipeline の音声ハッシュキャッシュを撤去（空結果汚染・翻訳音声消失・無駄なRedis往復を根絶）"
```

---

### Task 3: S2S タイムアウトの例外化（フォールバック発動）

**背景（欠陥 #4 前半）:** `_realtime_translate` の応答収集ループはタイムアウト時に `break` して空結果を正常返却するため、`translate_audio` の except ベースの 3 段階フォールバックが発動せず発話が無音で消える。**応答ゼロのタイムアウトは `TimeoutError` を送出する。**

**Files:**
- Modify: `backend/app/ai_pipeline/providers/gpt_realtime.py:542-597`
- Test: `backend/tests/test_ai_providers.py`（追記）

**Interfaces:**
- Produces: `GPTRealtimeProvider._collect_response(ws, timeout: float = 15.0) -> tuple[str, list[bytes]]`（新メソッド）。`response.done` 未受信かつテキスト・音声とも空のままタイムアウトした場合 `TimeoutError` を送出。部分結果（テキストか音声のどちらかが取得済み）はそのまま返す。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_ai_providers.py` に追記:

```python
class _FakeWs:
    """スクリプト化されたイベントを返す WebSocket スタブ。"""

    def __init__(self, events: list[dict], hang_after: bool = False) -> None:
        self._events = list(events)
        self._hang_after = hang_after

    async def recv(self) -> str:
        import asyncio
        import json

        if self._events:
            return json.dumps(self._events.pop(0))
        if self._hang_after:
            await asyncio.sleep(10)  # タイムアウトさせる
        raise AssertionError("イベント枯渇")


def _realtime_provider():
    from app.ai_pipeline.providers.gpt_realtime import GPTRealtimeProvider

    provider = GPTRealtimeProvider.__new__(GPTRealtimeProvider)
    provider._client = None
    return provider


@pytest.mark.asyncio
async def test_collect_response_timeout_raises():
    """応答ゼロのタイムアウトは TimeoutError（フォールバック発動条件、欠陥 #4）。"""
    provider = _realtime_provider()
    ws = _FakeWs([], hang_after=True)
    with pytest.raises(TimeoutError):
        await provider._collect_response(ws, timeout=0.3)


@pytest.mark.asyncio
async def test_collect_response_happy_path():
    """delta を蓄積し response.done で完了する。"""
    import base64

    provider = _realtime_provider()
    ws = _FakeWs(
        [
            {"type": "response.audio.delta",
             "delta": base64.b64encode(b"\x01\x02").decode()},
            {"type": "response.audio_transcript.delta", "delta": "Hel"},
            {"type": "response.audio_transcript.delta", "delta": "lo"},
            {"type": "response.done"},
        ]
    )
    text, chunks = await provider._collect_response(ws, timeout=5.0)
    assert text == "Hello"
    assert chunks == [b"\x01\x02"]
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_ai_providers.py::test_collect_response_timeout_raises tests/test_ai_providers.py::test_collect_response_happy_path -v`
Expected: FAIL with `AttributeError: _collect_response`

- [ ] **Step 3: `_collect_response` を抽出実装**

`gpt_realtime.py` の `_realtime_translate` 内 542-580 行（`translated_text = ""` からループ終端まで）を新メソッドへ:

```python
    async def _collect_response(
        self, ws, timeout: float = 15.0
    ) -> tuple[str, list[bytes]]:
        """S2S 応答（テキスト delta + 音声 delta）を response.done まで収集する。

        Returns:
            (翻訳テキスト, 音声チャンク列)
        Raises:
            TimeoutError: 期限内に応答が一切得られなかった場合
                （呼び出し側の 3 段階フォールバックを発動させる。欠陥 #4）
            RuntimeError: API がエラーイベントを返した場合
        """
        translated_text = ""
        audio_chunks: list[bytes] = []
        done = False
        start_time = asyncio.get_event_loop().time()

        while True:
            if asyncio.get_event_loop().time() - start_time > timeout:
                logger.warning("[GPT-Realtime] S2Sタイムアウト")
                break
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=min(5.0, timeout))
            except asyncio.TimeoutError:
                continue
            event = json.loads(msg)
            event_type = event.get("type", "")

            if event_type == "response.audio.delta":
                delta = event.get("delta", "")
                if delta:
                    audio_chunks.append(base64.b64decode(delta))
            elif event_type == "response.audio_transcript.delta":
                translated_text += event.get("delta", "")
            elif event_type == "response.done":
                done = True
                break
            elif event_type == "error":
                error_msg = event.get("error", {}).get("message", "Unknown")
                logger.error(f"[GPT-Realtime] APIエラー: {error_msg}")
                raise RuntimeError(f"Realtime API error: {error_msg}")

        if not done and not translated_text and not audio_chunks:
            raise TimeoutError("Realtime API 応答タイムアウト（response.done 未受信）")
        return translated_text.strip(), audio_chunks
```

`_realtime_translate` 側は response.create 送信後を差し替え:

```python
            # レスポンスを収集（応答ゼロのタイムアウトは TimeoutError → フォールバック）
            translated_text, audio_chunks = await self._collect_response(ws)
```

（既存のインラインループと `timeout = 15.0` / `start_time` 定義は削除。後続の WAV 化・return はそのまま `translated_text` / `audio_chunks` を使う）

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && python -m pytest tests/test_ai_providers.py -v`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/ai_pipeline/providers/gpt_realtime.py backend/tests/test_ai_providers.py
git commit -m "fix: S2S応答ゼロのタイムアウトを例外化し3段階フォールバックを発動可能にする"
```

---

### Task 4: Realtime セッションの turn_detection 無効化

**背景（欠陥 #5）:** セッション既定の `turn_detection: server_vad`（create_response=true）を無効化せず手動 `commit` + `response.create` を送るため、セグメント末尾の 600ms 無音で自動応答が発火し、二重応答・`already has active response` エラーと競合する。**手動運用なので `turn_detection: null` を明示する。**

**Files:**
- Modify: `backend/app/ai_pipeline/providers/gpt_realtime.py:147-161,481-515`
- Test: `backend/tests/test_ai_providers.py`（追記）

**Interfaces:**
- Produces: `GPTRealtimeProvider._build_transcribe_session_config(language: str) -> dict` / `GPTRealtimeProvider._build_translate_session_config(source_language: str, target_language: str) -> dict`（純関数、`session.turn_detection is None` を保証）

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_ai_providers.py` に追記:

```python
def test_session_configs_disable_turn_detection():
    """手動 commit/response.create 運用のため server_vad を無効化する（欠陥 #5）。"""
    provider = _realtime_provider()

    asr_cfg = provider._build_transcribe_session_config("ja")
    assert asr_cfg["type"] == "session.update"
    assert asr_cfg["session"]["turn_detection"] is None
    assert asr_cfg["session"]["input_audio_transcription"]["language"] == "ja"

    s2s_cfg = provider._build_translate_session_config("ja", "en")
    assert s2s_cfg["type"] == "session.update"
    assert s2s_cfg["session"]["turn_detection"] is None
    assert "instructions" in s2s_cfg["session"]
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_ai_providers.py::test_session_configs_disable_turn_detection -v`
Expected: FAIL with `AttributeError`

- [ ] **Step 3: 設定組み立てを純関数メソッドへ抽出**

`_realtime_transcribe` 内 147-161 行の `session_config` 構築を置換:

```python
    def _build_transcribe_session_config(self, language: str) -> dict:
        """transcription セッション設定（手動 commit 運用のため VAD 無効）。"""
        lang_for_transcribe = language if language not in ("zh", "multi") else None
        transcription_config: dict = {"model": settings.openai_transcribe_model}
        if lang_for_transcribe:
            transcription_config["language"] = lang_for_transcribe
        return {
            "type": "session.update",
            "session": {
                "input_audio_format": "pcm16",
                "input_audio_transcription": transcription_config,
                # 手動 commit と自動 VAD の競合防止（欠陥 #5）
                "turn_detection": None,
            },
        }
```

呼び出し側: `await ws.send(json.dumps(self._build_transcribe_session_config(language)))`

`_realtime_translate` 内 485-515 行の `session_config` も同様に `_build_translate_session_config(source_language, target_language)` へ抽出し、session 辞書に `"turn_detection": None,` を追加（`instructions` / `voice` / `input_audio_format` / `output_audio_format` / `input_audio_transcription` は現行のまま移設）。

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && python -m pytest tests/test_ai_providers.py -v`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/ai_pipeline/providers/gpt_realtime.py backend/tests/test_ai_providers.py
git commit -m "fix: Realtimeセッションのserver_vadを無効化し手動commit/responseとの二重応答を防止"
```

---

### Task 5: S2S 入力の 24kHz リサンプルと WAV ヘッダ解析（parse_wav16）

**背景（欠陥 #2）:** Realtime API の `pcm16` は 24kHz 前提だが、segmenter 由来の 16kHz PCM をヘッダ盲目スキップでそのまま送っており 1.5 倍速で解釈される。また sink は WAV ヘッダ付きバイト列を生 PCM として扱っている。**`parse_wav16` を追加し、送信前に実レートを読んで 24kHz へリサンプル、sink でもヘッダを剥がす。**

**Files:**
- Modify: `backend/app/audio/pcm.py`（`parse_wav16` 追加）
- Modify: `backend/app/ai_pipeline/providers/gpt_realtime.py:83,110-120,412-423`
- Modify: `backend/app/webrtc/sink.py:66-71`
- Test: `backend/tests/test_pcm.py`（追記）、`backend/tests/test_livekit_sink.py`（追記）

**Interfaces:**
- Produces: `parse_wav16(data: bytes, fallback_rate: int = 24000) -> tuple[bytes, int]`（`app.audio.pcm`）。RIFF/WAVE ヘッダ付きなら `(PCM, ヘッダのサンプルレート)`、ヘッダなしなら `(そのまま, fallback_rate)`。
- Consumes: 既存 `resample16(data, src_rate, dst_rate)`（`app.audio.pcm`）

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_pcm.py` に追記:

```python
def test_parse_wav16_roundtrip():
    """wrap_wav16 の出力から PCM とサンプルレートを復元できる。"""
    from app.audio.pcm import parse_wav16, wrap_wav16

    pcm = b"\x01\x02" * 100
    wav = wrap_wav16(pcm, 16000)
    out_pcm, rate = parse_wav16(wav)
    assert out_pcm == pcm
    assert rate == 16000


def test_parse_wav16_raw_pcm_fallback():
    """RIFF ヘッダなしのバイト列は生 PCM とみなし fallback_rate を返す。"""
    from app.audio.pcm import parse_wav16

    raw = b"\x05\x06" * 50
    out_pcm, rate = parse_wav16(raw, fallback_rate=24000)
    assert out_pcm == raw
    assert rate == 24000
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_pcm.py -v`
Expected: FAIL with `ImportError: cannot import name 'parse_wav16'`

- [ ] **Step 3: `parse_wav16` を実装**

`backend/app/audio/pcm.py` 末尾に追加:

```python
# WAV ヘッダ内サンプルレートのオフセット（RIFF 標準 44 バイトヘッダ）。
_WAV_RATE_OFFSET = 24
_WAV_HEADER_LEN = 44


def parse_wav16(data: bytes, fallback_rate: int = 24000) -> tuple[bytes, int]:
    """RIFF/WAVE(int16 PCM) から (PCM バイト列, サンプルレート) を取り出す。

    wrap_wav16 / OpenAI TTS(wav) / _pcm16_to_wav の出力（標準 44 バイトヘッダ）を
    想定する。ヘッダが無ければ生 PCM とみなし fallback_rate を返す。
    # ponytail: 追加チャンク付き WAV は非対応。外部入力を受けるようになったら
    # チャンク走査に拡張する。
    """
    if (
        len(data) < _WAV_HEADER_LEN
        or data[:4] != b"RIFF"
        or data[8:12] != b"WAVE"
    ):
        return data, fallback_rate
    sample_rate = struct.unpack_from("<I", data, _WAV_RATE_OFFSET)[0]
    return data[_WAV_HEADER_LEN:], sample_rate
```

- [ ] **Step 4: gpt_realtime.py の送信前処理を修正**

モジュール定数を追加: `REALTIME_INPUT_RATE = 24000  # Realtime API pcm16 の要求レート`

import に追加: `from app.audio.pcm import parse_wav16, resample16`

`transcribe_audio`（83 行付近）と `translate_audio`（412-423 行付近）の
`pcm_data = self._wav_to_pcm16(audio_data)` を両方こう置換:

```python
            # WAV から PCM と実レートを取り出し、Realtime API 要求の 24kHz へ揃える
            # （16kHz のまま送ると 1.5 倍速解釈で品質が崩壊する。欠陥 #2）
            pcm_data, src_rate = parse_wav16(audio_data)
            if not pcm_data:
                ...  # 既存の空ガードをそのまま維持
            pcm_data = resample16(pcm_data, src_rate, REALTIME_INPUT_RATE)
```

`_wav_to_pcm16` メソッド（110-120 行）は削除する。

- [ ] **Step 5: sink.py のヘッダ剥がしを実装**

`backend/app/webrtc/sink.py` の import を `from app.audio.pcm import chunk16, parse_wav16, resample16` に変更し、`deliver_audio` の 68 行目を置換:

```python
        # provider の出力は WAV ヘッダ付きのことがある（TTS / S2S とも）。
        # ヘッダを剥がし、ヘッダ記載の実レートで 48kHz へ変換する（欠陥 #2 付随）。
        pcm, rate = parse_wav16(audio, fallback_rate=self._hearing_sample_rate)
        pcm48 = resample16(pcm, rate, OUTPUT_SAMPLE_RATE)
        frames, _remainder = chunk16(pcm48, OUTPUT_FRAME_SAMPLES)
```

`backend/tests/test_livekit_sink.py` に追記:

```python
@pytest.mark.asyncio
async def test_deliver_audio_strips_wav_header():
    """WAV ヘッダ付き音声はヘッダを除去し実レートで 48kHz 化する。"""
    from app.audio.pcm import wrap_wav16
    from app.webrtc.sink import LiveKitOutputSink, OUTPUT_FRAME_SAMPLES

    captured: list[tuple[str, bytes]] = []

    async def capture(lang: str, frame: bytes) -> None:
        captured.append((lang, frame))

    async def send(payload: bytes, ids: list[str], topic: str) -> None:
        pass

    sink = LiveKitOutputSink(
        user_language={"u1": "en"}, capture_audio=capture, send_data=send
    )
    pcm24k = b"\x01\x00" * 2400  # 24kHz で 100ms
    await sink.deliver_audio("u1", wrap_wav16(pcm24k, 24000))
    total = sum(len(f) for _, f in captured)
    # 100ms @48kHz int16 = 4800 標本 = 9600 バイト（フレーム 480 標本単位）
    assert total == (4800 // OUTPUT_FRAME_SAMPLES) * OUTPUT_FRAME_SAMPLES * 2
```

- [ ] **Step 6: テストが通ることを確認**

Run: `cd backend && python -m pytest tests/test_pcm.py tests/test_livekit_sink.py tests/test_ai_providers.py -v`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/audio/pcm.py backend/app/ai_pipeline/providers/gpt_realtime.py backend/app/webrtc/sink.py backend/tests
git commit -m "fix: S2S入力を実レート解析のうえ24kHzへリサンプルし、sinkのWAVヘッダ混入を解消"
```

---

### Task 6: registry.resolve の None をフェイルファスト化

**背景（欠陥 #12）:** `resolve()` が鍵未設定で None を返しても `build_composite_provider` が無検査で `CompositeAIProvider` に注入するため、初回発話時に `AttributeError` で会議全体が沈黙する。**起動時に明示エラーで落とす。**

**Files:**
- Modify: `backend/app/ai_pipeline/registry.py:292-310`
- Test: `backend/tests/test_registry.py`（追記）

**Interfaces:**
- Produces: `build_composite_provider()` は ASR/MT スロットが解決不能なら `APIKeyError`（`app.ai_pipeline.providers.base`）を送出。TTS 解決不能時は `NullTTSStage` に縮退（字幕運用は継続）。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_registry.py` に追記:

```python
def test_build_composite_raises_when_asr_unresolvable(monkeypatch):
    """ASR スロット解決不能時は起動時に APIKeyError（実行時 AttributeError 禁止）。"""
    import pytest

    from app.ai_pipeline import registry as reg
    from app.ai_pipeline.providers.base import APIKeyError
    from app.config import settings

    monkeypatch.setattr(settings, "openai_api_key", "")
    monkeypatch.setattr(settings, "deepgram_api_key", "", raising=False)
    monkeypatch.setattr(settings, "asr_provider", "gpt4o")
    monkeypatch.setattr(settings, "mt_provider", "auto")
    monkeypatch.setattr(settings, "tts_provider", "auto")

    with pytest.raises(APIKeyError):
        reg.build_composite_provider()
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_registry.py::test_build_composite_raises_when_asr_unresolvable -v`
Expected: FAIL（現状は None のまま Composite が生成され例外なし）

- [ ] **Step 3: ガードを実装**

`registry.py` の `build_composite_provider` 末尾（logger.info の前）に追加。import に `APIKeyError` を追加（`from app.ai_pipeline.providers.base import AIProvider, APIKeyError, TranslationResult`）:

```python
    # None ステージの実行時 AttributeError を防ぐ（欠陥 #12: フェイルファスト）。
    if asr is None or mt is None:
        raise APIKeyError(
            "Composite 構成を解決できません"
            f"（asr解決={asr is not None}, mt解決={mt is not None}）。"
            "OPENAI_API_KEY 等、各スロットの必要な環境変数を設定してください。"
        )
    if tts is None:
        from app.ai_pipeline.providers.stages import NullTTSStage

        logger.warning("[Registry] TTS スロット解決不能のため無音運用へ縮退")
        tts = NullTTSStage()
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && python -m pytest tests/test_registry.py -v`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/ai_pipeline/registry.py backend/tests/test_registry.py
git commit -m "fix: Compositeのステージ解決不能を起動時APIKeyErrorでフェイルファスト化"
```

---

### Task 7: スロット指定による S2S プリセットの黙殺置換を防止

**背景（欠陥 #13）:** `composite_enabled()` が `AI_PROVIDER` より無条件に優先されるため、`AI_PROVIDER=gpt_realtime` 環境で `TTS_PROVIDER=none` を足しただけで S2S が警告なくカスケードへ全面置換される（registry.py 冒頭の「Mode A とはコードパスを共有しない（絶対原則）」違反）。**S2S プリセット時はスロット指定を警告して無視する。**

**Files:**
- Modify: `backend/app/ai_pipeline/providers/__init__.py:64-71`
- Test: `backend/tests/test_registry.py`（追記）

**Interfaces:**
- Produces: `get_ai_provider()` は `ai_provider in ("gpt_realtime", "gemini_live")` のとき composite を使わない（警告ログのみ）。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_registry.py` に追記:

```python
def test_s2s_preset_not_replaced_by_slots(monkeypatch):
    """S2S プリセットはスロット指定で黙って置換されない（欠陥 #13）。"""
    from app.ai_pipeline.providers import get_ai_provider
    from app.ai_pipeline.providers.gpt_realtime import GPTRealtimeProvider
    from app.config import settings

    monkeypatch.setattr(settings, "ai_provider", "gpt_realtime")
    monkeypatch.setattr(settings, "tts_provider", "none")  # composite_enabled() を真にする
    monkeypatch.setattr(settings, "openai_api_key", "test-key")

    provider = get_ai_provider()
    assert isinstance(provider, GPTRealtimeProvider)
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_registry.py::test_s2s_preset_not_replaced_by_slots -v`
Expected: FAIL（CompositeAIProvider が返る）

- [ ] **Step 3: ガードを実装**

`providers/__init__.py` の 64-71 行を置換:

```python
    # ステージ別スロット（ASR/MT/TTS）はカスケード（Mode B 系）専用。
    # S2S プリセットとはコードパスを共有しない（registry.py の絶対原則。欠陥 #13）。
    from app.ai_pipeline.registry import build_composite_provider, composite_enabled

    provider = settings.ai_provider
    _S2S_PRESETS = ("gpt_realtime", "gemini_live")

    if composite_enabled():
        if provider in _S2S_PRESETS:
            logger.warning(
                "[AI Provider] ASR/MT/TTS スロット指定は S2S プリセット(%s)では"
                "無効です（無視して S2S を維持します）",
                provider,
            )
        else:
            logger.info("[AI Provider] ステージ別スロット指定により Composite を使用")
            return build_composite_provider()
```

（続く既存の `provider = settings.ai_provider` 行は重複するため削除）

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && python -m pytest tests/test_registry.py -v`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/ai_pipeline/providers/__init__.py backend/tests/test_registry.py
git commit -m "fix: ステージスロット指定がS2Sプリセットを黙って置換しないようガード"
```

---

### Task 8: 言語自動検出の修正（whisper-1 検出モデル + "ja" ハードコード除去）

**背景（欠陥 #7）:** 既定モデル `gpt-4o-transcribe` は `response_format=verbose_json` 非対応（whisper-1 のみ対応）のため、`language_detection_mode=auto`（既定）では検出が毎回例外→ヒント言語へ静黙フォールバックし、Language-Aware の中核機能が無効。さらに失敗時 `hint=multi` なら `"ja"` をハードコードする。**検出専用モデル設定（既定 whisper-1）を追加し、ハードコードを除去する。**

**Files:**
- Modify: `backend/app/config.py:149` 付近（設定追加）
- Modify: `backend/app/ai_pipeline/providers/gpt4o_transcribe.py:157-162,199-203`
- Modify: `backend/app/ai_pipeline/providers/gpt_realtime.py:296-302,342-346`
- Modify: `.env.example`（設定例追記）
- Test: `backend/tests/test_ai_providers.py`（追記）

**Interfaces:**
- Produces: `settings.openai_detect_model: str = "whisper-1"`。`transcribe_with_detection` の検出 API 呼び出しは `openai_detect_model` を使用。検出失敗時の戻りは `(text, hint_language)`、`hint_language == "multi"` の場合は `(text, "")`（processor が空を話者ヒントへ解決する既存動作に依存: `processor.py:111-112`）。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_ai_providers.py` に追記:

```python
@pytest.mark.asyncio
async def test_detection_uses_whisper_model(monkeypatch):
    """言語検出は verbose_json 対応の whisper-1 を使う（欠陥 #7）。"""
    from types import SimpleNamespace

    from app.ai_pipeline.providers.gpt4o_transcribe import GPT4oTranscribeProvider
    from app.config import settings

    monkeypatch.setattr(settings, "language_detection_mode", "auto")
    provider = GPT4oTranscribeProvider.__new__(GPT4oTranscribeProvider)
    seen: dict = {}

    class FakeTranscriptions:
        async def create(self, **kwargs):
            seen.update(kwargs)
            return SimpleNamespace(text="hello", language="english")

    class FakeClient:
        audio = SimpleNamespace(transcriptions=FakeTranscriptions())

    async def get_client():
        return FakeClient()

    provider._client = None
    monkeypatch.setattr(provider, "_get_client", get_client)

    text, lang = await provider.transcribe_with_detection(b"\x00" * 9000, "multi")
    assert seen["model"] == settings.openai_detect_model == "whisper-1"
    assert text == "hello"
    assert lang == "en"


@pytest.mark.asyncio
async def test_detection_failure_no_ja_hardcode(monkeypatch):
    """検出失敗 + hint=multi のとき 'ja' を捏造しない（欠陥 #7）。"""
    from app.ai_pipeline.providers.gpt4o_transcribe import GPT4oTranscribeProvider
    from app.config import settings

    monkeypatch.setattr(settings, "language_detection_mode", "auto")
    provider = GPT4oTranscribeProvider.__new__(GPT4oTranscribeProvider)
    provider._client = None

    async def boom():
        raise RuntimeError("api down")

    monkeypatch.setattr(provider, "_get_client", boom)
    _text, lang = await provider.transcribe_with_detection(b"\x00" * 9000, "multi")
    assert lang == ""  # processor が話者ヒントへ解決する
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_ai_providers.py::test_detection_uses_whisper_model tests/test_ai_providers.py::test_detection_failure_no_ja_hardcode -v`
Expected: FAIL（`openai_detect_model` 未定義 / lang == "ja"）

- [ ] **Step 3: 設定と実装を修正**

`backend/app/config.py`（149 行 `openai_transcribe_model` の直後）:

```python
# 言語自動検出専用モデル。verbose_json（language フィールド）対応は whisper-1 のみ。
openai_detect_model: str = "whisper-1"
```

`gpt4o_transcribe.py:158`（transcribe_params の model）:

```python
            transcribe_params: dict = {
                # verbose_json は whisper-1 のみ対応（gpt-4o-transcribe は 400 になる）
                "model": settings.openai_detect_model,
                "file": audio_file,
                "response_format": "verbose_json",
                "prompt": asr_prompt,
            }
```

`gpt4o_transcribe.py:199-203` except 節:

```python
        except Exception as e:
            logger.error(f"[GPT4o-transcribe] 言語検出ASRエラー: {e}", exc_info=True)
            # フォールバック: 通常のASR（検出言語は捏造しない。欠陥 #7）
            if hint_language == "multi":
                return "", ""
            text = await self.transcribe_audio(audio_data, hint_language)
            return text, hint_language
```

`gpt_realtime.py:297-302` と `342-346` にも同じ 2 修正を適用（model を `settings.openai_detect_model` へ、except 節の `"ja"` 捏造を除去）。

`.env.example` に追記:

```bash
# OPENAI_DETECT_MODEL=whisper-1   # 言語自動検出用（verbose_json 対応モデルのみ）
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && python -m pytest tests/test_ai_providers.py -v`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/config.py backend/app/ai_pipeline/providers/ .env.example backend/tests/test_ai_providers.py
git commit -m "fix: 言語自動検出をwhisper-1系検出モデルに分離し'ja'ハードコードを除去"
```

---

# Phase 2: 構造修正

### Task 9: 二重 ASR の一本化（original_text を hearing 主線へ引き渡し）

**背景（欠陥 #1）:** SegmentProcessor が言語検出で ASR した `original_text` を、hearing 主線（`process_audio` → `provider.translate_audio`）が使わず同じ音声を再 ASR するため、コスト・遅延が約 2 倍になり、字幕（ASR① + MT）と翻訳音声（ASR② + MT + TTS）が別テキストから生成され乖離する。**検出済みテキストをカスケード実装まで引き渡し、再 ASR をスキップする。**

**Files:**
- Modify: `backend/app/ai_pipeline/providers/base.py:188-205`
- Modify: `backend/app/ai_pipeline/providers/gpt4o_transcribe.py:225-257`
- Modify: `backend/app/ai_pipeline/providers/deepgram.py:223-253`
- Modify: `backend/app/ai_pipeline/providers/google.py:287-305`
- Modify: `backend/app/ai_pipeline/providers/gemini_live.py:273-281`
- Modify: `backend/app/ai_pipeline/providers/gpt_realtime.py:380-399`
- Modify: `backend/app/ai_pipeline/registry.py:117-123`
- Modify: `backend/app/ai_pipeline/pipeline.py:99-127`
- Modify: `backend/app/ai_pipeline/orchestrator.py:59-61,121-127,245-253`
- Test: `backend/tests/test_ai_providers.py`、`backend/tests/test_orchestrator.py`（追記・修正）

**Interfaces:**
- Produces: `AIProvider.translate_audio(audio_data: bytes, source_language: str, target_language: str, original_text: str | None = None) -> TranslationResult`。カスケード実装（gpt4o / deepgram / google / Composite）は `original_text` があれば内部 ASR をスキップ。S2S 実装（gpt_realtime / gemini_live）はパラメータを受けるが無視する。
- Produces: `AIPipeline.process_audio(..., original_text: str | None = None)`、orchestrator の `HearingFn = Callable[[bytes, str, str, str, str | None], Awaitable[object]]`（第 5 引数 = 検出済み原文）。
- Consumes: Task 1 の空文字列契約。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_ai_providers.py` に追記:

```python
@pytest.mark.asyncio
async def test_translate_audio_skips_asr_when_text_given(monkeypatch):
    """original_text 供給時はカスケード実装が再 ASR しない（欠陥 #1）。"""
    from app.ai_pipeline.providers.gpt4o_transcribe import GPT4oTranscribeProvider

    provider = GPT4oTranscribeProvider.__new__(GPT4oTranscribeProvider)
    provider._client = None
    asr_calls = {"n": 0}

    async def fake_transcribe(audio, lang):
        asr_calls["n"] += 1
        return "should not be used"

    async def fake_translate(text, src, tgt):
        return "hello"

    monkeypatch.setattr(provider, "transcribe_audio", fake_transcribe)
    monkeypatch.setattr(
        "app.translate.routes.translate_text_simple", fake_translate
    )

    async def no_client():
        from types import SimpleNamespace

        class FakeSpeech:
            async def create(self, **kwargs):
                return SimpleNamespace(content=b"RIFFwav")

        return SimpleNamespace(audio=SimpleNamespace(speech=FakeSpeech()))

    monkeypatch.setattr(provider, "_get_client", no_client)

    result = await provider.translate_audio(
        b"\x00" * 9000, "ja", "en", original_text="こんにちは"
    )
    assert asr_calls["n"] == 0
    assert result.original_text == "こんにちは"
    assert result.translated_text == "hello"
```

`backend/tests/test_orchestrator.py` に追記:

```python
@pytest.mark.asyncio
async def test_hearing_receives_original_text():
    """orchestrator は検出済み原文を hearing 主線へ引き渡す（欠陥 #1）。"""
    from app.ai_pipeline.orchestrator import HybridOrchestrator, Listener

    received: dict = {}

    async def hearing_fn(audio, src, tgt, speaker, original_text):
        received["text"] = original_text

        class Out:
            audio_data = b"wav"
            translated_text = "hello"

        return Out()

    async def reading_fn(text, src, tgt):
        return "hello"

    class NullSink:
        async def deliver_audio(self, user_id, audio):
            pass

        async def deliver_subtitle(self, user_id, message):
            pass

    orch = HybridOrchestrator(hearing_fn=hearing_fn, reading_fn=reading_fn)
    await orch.orchestrate(
        audio_bytes=b"pcm",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", wants_audio=True, subtitle_enabled=True)],
        sink=NullSink(),
        mode="hybrid",
        speaker_id="sp",
    )
    assert received["text"] == "こんにちは"
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_ai_providers.py::test_translate_audio_skips_asr_when_text_given tests/test_orchestrator.py::test_hearing_receives_original_text -v`
Expected: FAIL（TypeError: unexpected keyword argument / 引数数不一致）

- [ ] **Step 3: base.py の抽象シグネチャを拡張**

```python
    @abstractmethod
    async def translate_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
        original_text: str | None = None,
    ) -> TranslationResult:
        """
        音声を翻訳

        Args:
            audio_data: 入力音声データ（WAV形式）
            source_language: 元言語コード（ja, en, zh, vi）
            target_language: 翻訳先言語コード
            original_text: 上流で ASR 済みの原文（あればカスケード実装は
                再 ASR をスキップする。S2S 実装は無視してよい。欠陥 #1）

        Returns:
            翻訳結果（テキスト + 音声）
        """
```

- [ ] **Step 4: 各プロバイダー実装を更新**

全実装のシグネチャに `original_text: str | None = None,` を追加し、カスケード実装は内部 ASR を次のパターンで置換:

`gpt4o_transcribe.py`（同一言語分岐と翻訳分岐の両方）:

```python
        # 同一言語の場合はASRのみ（原文供給済みなら再 ASR しない）
        if source_language == target_language:
            if original_text is None:
                original_text = await self.transcribe_audio(
                    audio_data, source_language
                )
            ...

        try:
            client = await self._get_client()

            # 1. ASR（上流で検出済みならスキップ。欠陥 #1: 二重 ASR 根絶）
            if original_text is None:
                original_text = await self.transcribe_audio(
                    audio_data, source_language
                )
            if not original_text:
                ...
```

`deepgram.py` / `google.py`: 同じパターン（`original_text = await self.transcribe_audio(...)` を `if original_text is None:` で包む）。

`gemini_live.py` / `gpt_realtime.py`: シグネチャ追加のみ。docstring に「S2S は音声から直接翻訳するため original_text は使用しない」と明記し、`# noqa: ARG002` を付ける。

`registry.py` `CompositeAIProvider.translate_audio`:

```python
    async def translate_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
        original_text: str | None = None,
    ) -> TranslationResult:
        if source_language == target_language:
            text = original_text or await self._asr.transcribe_audio(
                audio_data, source_language
            )
            return TranslationResult(source_language, target_language, text, text, None)
        original = original_text or await self._asr.transcribe_audio(
            audio_data, source_language
        )
```

- [ ] **Step 5: pipeline.py と orchestrator.py を配線**

`pipeline.py` `process_audio` シグネチャに `original_text: str | None = None,` を追加し、同一言語分岐は `result = original_text or await self._provider.transcribe_audio(...)`、翻訳分岐は `self._provider.translate_audio(audio_data, source_language, target_language, original_text=original_text)` へ。

`orchestrator.py`:

```python
# 注入可能な主線実体のシグネチャ（第5引数 = 検出済み原文。欠陥 #1）
HearingFn = Callable[[bytes, str, str, str, str | None], Awaitable[object]]
```

```python
    async def _hearing(
        self, audio: bytes, src: str, tgt: str, speaker: str, original_text: str | None
    ) -> object:
        """聞く主線（S2S/カスケード）。既定は ai_pipeline.process_audio を遅延束縛。"""
        if self._hearing_fn is not None:
            return await self._hearing_fn(audio, src, tgt, speaker, original_text)
        from app.ai_pipeline.pipeline import ai_pipeline

        return await ai_pipeline.process_audio(
            audio, src, tgt, speaker, original_text=original_text
        )
```

`run_group` 内の呼び出し（245-253 行）を `self._hearing(audio_bytes, source_language, target_lang, speaker_id, original_text)` へ（縮退パスは変更なし）。

- [ ] **Step 6: 既存テストの hearing_fn スタブを 5 引数に更新**

Run: `cd backend && python -m pytest tests/ -v`
`test_orchestrator.py` / `test_processor.py` 内の 4 引数 `hearing_fn` スタブに `original_text` 引数を追加して全 PASS にする。

- [ ] **Step 7: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app backend/tests
git commit -m "fix: 検出済み原文をhearing主線へ引き渡し二重ASRを根絶（字幕と翻訳音声の乖離解消）"
```

---

### Task 10: 字幕配信の hearing 非依存化

**背景（欠陥 #10）:** `run_group` が hearing / reading 両タスクの完了を待ってから `_converge` で一括配信するため、S2S が 15 秒タイムアウトすると字幕もその間配信されない。**reading 完了時点で字幕を即配信し、音声は hearing 完了時に配信する。**

**Files:**
- Modify: `backend/app/ai_pipeline/orchestrator.py:137-319`
- Test: `backend/tests/test_orchestrator.py`（追記）

**Interfaces:**
- Produces: `HybridOrchestrator._deliver_subtitle_group(...)` / `_deliver_audio_group(...)`（`_converge` を分割）。配信順序契約: reading 主線が成功した場合、字幕配信は hearing 完了を待たない。`OrchestrationResult` の内容（translations / tags）は従来と同一。
- Consumes: Task 1 の空文字列契約、Task 9 の `_hearing(…, original_text)`。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_orchestrator.py` に追記:

```python
@pytest.mark.asyncio
async def test_subtitle_not_blocked_by_slow_hearing():
    """字幕（読む主線）は聞く主線の完了を待たずに配信される（欠陥 #10）。"""
    import asyncio
    import time

    from app.ai_pipeline.orchestrator import HybridOrchestrator, Listener

    times: dict[str, float] = {}

    async def hearing_fn(audio, src, tgt, speaker, original_text):
        await asyncio.sleep(0.5)  # 遅い S2S を模擬

        class Out:
            audio_data = b"wav"
            translated_text = "hello"

        return Out()

    async def reading_fn(text, src, tgt):
        return "hello"

    class RecordingSink:
        async def deliver_audio(self, user_id, audio):
            times.setdefault("audio", time.perf_counter())

        async def deliver_subtitle(self, user_id, message):
            times.setdefault("subtitle", time.perf_counter())

    orch = HybridOrchestrator(hearing_fn=hearing_fn, reading_fn=reading_fn)
    await orch.orchestrate(
        audio_bytes=b"pcm",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", wants_audio=True, subtitle_enabled=True)],
        sink=RecordingSink(),
        mode="hybrid",
        speaker_id="sp",
    )
    assert "subtitle" in times and "audio" in times
    assert times["audio"] - times["subtitle"] > 0.3  # 字幕が hearing を待っていない
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_orchestrator.py::test_subtitle_not_blocked_by_slow_hearing -v`
Expected: FAIL（両者ほぼ同時刻 = 差 < 0.3）

- [ ] **Step 3: `_converge` を分割実装**

`orchestrator.py` の `_converge` を削除し、以下 3 メソッドと新 `run_group` フローに置換:

```python
    def _subtitle_message(
        self,
        *,
        subtitle_id: str,
        seq: int,
        speaker_id: str,
        original_text: str,
        source_language: str,
        target_lang: str,
        subtitle_text: str,
        mainline: str,
        s2s_provider: str | None,
    ) -> dict:
        """字幕 data channel ペイロードを組み立てる（純ロジック）。"""
        return {
            "type": "subtitle",
            "id": subtitle_id,
            "seq": seq,
            "speaker_id": speaker_id,
            "original_text": original_text,
            "source_language": source_language,
            "translated_text": (
                subtitle_text if target_lang != source_language else None
            ),
            "target_language": target_lang,
            "is_translated": bool(target_lang != source_language and subtitle_text),
            "is_final": True,
            "mainline": mainline,
            "provider": s2s_provider if mainline == "hearing" else "asr_mt",
        }

    async def _deliver_subtitle_group(
        self, sink: OutputSink, members: list[Listener], message: dict
    ) -> None:
        """字幕を購読者へ配信する（読む主線の収束）。"""
        deliveries = [
            sink.deliver_subtitle(ls.user_id, message)
            for ls in members
            if ls.subtitle_enabled
        ]
        if deliveries:
            await asyncio.gather(*deliveries, return_exceptions=True)

    async def _deliver_audio_group(
        self,
        sink: OutputSink,
        members: list[Listener],
        audio_data: bytes | None,
        speaker_id: str,
    ) -> None:
        """翻訳音声を購読者へ配信する（聞く主線の収束。話者自身は除外）。"""
        if not audio_data:
            return
        deliveries = [
            sink.deliver_audio(ls.user_id, audio_data)
            for ls in members
            if ls.wants_audio and ls.user_id != speaker_id
        ]
        if deliveries:
            await asyncio.gather(*deliveries, return_exceptions=True)
```

`run_group` のタスク完了待ち〜収束部（261-314 行）を置換:

```python
            # --- 読む主線を先に収束（字幕は hearing を待たない。欠陥 #10） ---
            subtitle_sent = False
            if "reading" in tasks:
                try:
                    reading_text = (await tasks["reading"]) or ""
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        "[Hybrid] reading 主線エラー(%s): %s", target_lang, e
                    )
                if reading_text:
                    await self._deliver_subtitle_group(
                        sink,
                        members,
                        self._subtitle_message(
                            subtitle_id=subtitle_id,
                            seq=seq,
                            speaker_id=speaker_id,
                            original_text=original_text,
                            source_language=source_language,
                            target_lang=target_lang,
                            subtitle_text=reading_text,
                            mainline="reading",
                            s2s_provider=decision.s2s_provider,
                        ),
                    )
                    subtitle_sent = True

            # --- 聞く主線の収束（翻訳音声） ---
            if "hearing" in tasks:
                try:
                    out = await tasks["hearing"]
                    audio_data = getattr(out, "audio_data", None)
                    hearing_text = getattr(out, "translated_text", "") or ""
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        "[Hybrid] hearing 主線エラー(%s): %s", target_lang, e
                    )
                await self._deliver_audio_group(sink, members, audio_data, speaker_id)

            # --- ランタイム縮退（§10）: 聞く主線が失敗し読む主線が未駆動 ---
            hearing_failed = (
                "hearing" in tasks and not audio_data and not hearing_text
            )
            if (
                decision.needs_translation
                and hearing_failed
                and "reading" not in tasks
                and not reading_text
            ):
                try:
                    out = await self._run_timed(
                        "reading",
                        self._reading(original_text, source_language, target_lang),
                    )
                    reading_text = out or ""
                    reason = "hearing_failed_runtime_fallback_reading"
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        "[Hybrid] 縮退 reading 主線エラー(%s): %s", target_lang, e
                    )

            if not decision.needs_translation:
                reading_text = original_text

            # --- 未送の字幕を収束（hearing delta 代替 / 縮退 / 同一言語） ---
            subtitle_text = reading_text or hearing_text
            if not subtitle_sent and subtitle_text:
                mainline = "reading" if reading_text else "hearing"
                await self._deliver_subtitle_group(
                    sink,
                    members,
                    self._subtitle_message(
                        subtitle_id=subtitle_id,
                        seq=seq,
                        speaker_id=speaker_id,
                        original_text=original_text,
                        source_language=source_language,
                        target_lang=target_lang,
                        subtitle_text=subtitle_text,
                        mainline=mainline,
                        s2s_provider=decision.s2s_provider,
                    ),
                )

            # --- 記録（DB 永続化用）と QoS/ログ用タグを集約 ---
            if subtitle_text:
                result.translations[target_lang] = subtitle_text
            result.tags.append(
                {
                    "target_language": target_lang,
                    "reason": reason,
                    "hearing_audio": bool(audio_data),
                    "subtitle_mainline": (
                        ("reading" if reading_text else "hearing")
                        if subtitle_text
                        else None
                    ),
                    "s2s_provider": decision.s2s_provider,
                }
            )
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && python -m pytest tests/test_orchestrator.py tests/test_processor.py -v`
Expected: PASS（既存の収束テストが tags / translations の同一契約を検証していることを確認。落ちる場合は挙動差分を精査 — 契約が変わるなら実装を直す）

- [ ] **Step 5: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/ai_pipeline/orchestrator.py backend/tests/test_orchestrator.py
git commit -m "fix: 字幕配信をhearing完了から独立させ、S2S遅延時も読む主線のSLAを維持"
```

---

### Task 11: ingest の非ブロッキング化（話者別キュー + ワーカー）

**背景（欠陥 #11）:** `_ingest` がフレーム消費ループ内で 1 セグメントの全処理（数秒〜20 秒）を await するため head-of-line blocking が発生し、連続発話で遅延が単調に蓄積する。**話者別の有界キュー + 直列ワーカーに分離する（順序保証は話者内で維持）。**

**Files:**
- Modify: `backend/app/webrtc/agent.py:15-18,162-179`
- Test: `backend/tests/test_agent_queue.py`（新規）

**Interfaces:**
- Produces: `LiveKitAgent._enqueue_segment(speaker_id: str, queue: asyncio.Queue, segment: bytes) -> None`（満杯時は最古を破棄して警告ログ）、`LiveKitAgent._segment_worker(speaker_id: str, queue: asyncio.Queue) -> None`（`None` 受信で終了、例外はログして継続）。
- Consumes: 既存 `_handle_segment(speaker_id, pcm16)`。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_agent_queue.py`（新規）:

```python
"""LiveKitAgent のセグメントキュー（欠陥 #11: head-of-line blocking 解消）のテスト。"""
import asyncio

import pytest

from app.webrtc.agent import LiveKitAgent


def _agent() -> LiveKitAgent:
    # rtc.Room を作らないようダミー room を注入（run しない限り rtc 依存なし）
    return LiveKitAgent("room-t", room=object())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_worker_processes_in_order(monkeypatch):
    agent = _agent()
    handled: list[bytes] = []

    async def fake_handle(speaker_id: str, seg: bytes) -> None:
        handled.append(seg)

    monkeypatch.setattr(agent, "_handle_segment", fake_handle)
    queue: asyncio.Queue = asyncio.Queue(maxsize=8)
    worker = asyncio.ensure_future(agent._segment_worker("sp", queue))
    for seg in (b"a", b"b", b"c"):
        agent._enqueue_segment("sp", queue, seg)
    await queue.put(None)
    await worker
    assert handled == [b"a", b"b", b"c"]


@pytest.mark.asyncio
async def test_enqueue_drops_oldest_when_full():
    agent = _agent()
    queue: asyncio.Queue = asyncio.Queue(maxsize=2)
    agent._enqueue_segment("sp", queue, b"1")
    agent._enqueue_segment("sp", queue, b"2")
    agent._enqueue_segment("sp", queue, b"3")  # 満杯 → 最古 b"1" を破棄
    items = [queue.get_nowait(), queue.get_nowait()]
    assert items == [b"2", b"3"]


@pytest.mark.asyncio
async def test_worker_survives_handler_error(monkeypatch):
    agent = _agent()
    handled: list[bytes] = []

    async def flaky(speaker_id: str, seg: bytes) -> None:
        if seg == b"boom":
            raise RuntimeError("provider down")
        handled.append(seg)

    monkeypatch.setattr(agent, "_handle_segment", flaky)
    queue: asyncio.Queue = asyncio.Queue(maxsize=8)
    worker = asyncio.ensure_future(agent._segment_worker("sp", queue))
    agent._enqueue_segment("sp", queue, b"boom")
    agent._enqueue_segment("sp", queue, b"ok")
    await queue.put(None)
    await worker
    assert handled == [b"ok"]
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_agent_queue.py -v`
Expected: FAIL with `AttributeError: _segment_worker`

- [ ] **Step 3: agent.py を実装**

import へ `import contextlib` を追加。定数を追加:

```python
# 話者別セグメントキューの上限（過負荷時は最古を破棄して遅延暴走を防ぐ）。
_SEGMENT_QUEUE_MAX = 8
```

`_ingest` を置換し、2 メソッドを追加:

```python
    async def _ingest(self, track, participant) -> None:  # noqa: ANN001
        """1 話者トラックを 16kHz モノで購読し、発話単位に切り出して処理する。

        セグメント処理はワーカーへ委譲し、フレーム消費を塞がない（欠陥 #11）。
        """
        speaker_id = participant.identity
        stream = rtc.AudioStream(track, sample_rate=_AI_SAMPLE_RATE, num_channels=1)
        segmenter = SpeechSegmenter(sample_rate=_AI_SAMPLE_RATE)
        queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=_SEGMENT_QUEUE_MAX)
        worker = asyncio.ensure_future(self._segment_worker(speaker_id, queue))
        try:
            async for event in stream:
                pcm = bytes(event.frame.data)
                for segment in segmenter.push(pcm):
                    self._enqueue_segment(speaker_id, queue, segment)
            tail = segmenter.flush()
            if tail:
                self._enqueue_segment(speaker_id, queue, tail)
        finally:
            await queue.put(None)  # 終端シグナル（worker を確実に畳む）
            await worker
            aclose = getattr(stream, "aclose", None)
            if aclose is not None:
                await aclose()

    def _enqueue_segment(
        self, speaker_id: str, queue: asyncio.Queue, segment: bytes
    ) -> None:
        """キュー満杯時は最古を破棄して新しい発話を優先する（過負荷保護）。"""
        try:
            queue.put_nowait(segment)
        except asyncio.QueueFull:
            with contextlib.suppress(asyncio.QueueEmpty):
                queue.get_nowait()
            logger.warning(
                "[Agent] 過負荷のため最古セグメントを破棄: speaker=%s", speaker_id
            )
            queue.put_nowait(segment)

    async def _segment_worker(
        self, speaker_id: str, queue: asyncio.Queue
    ) -> None:
        """話者ごとの直列ワーカー（発話順を保ちつつ ingest を塞がない）。"""
        while True:
            segment = await queue.get()
            if segment is None:
                return
            try:
                await self._handle_segment(speaker_id, segment)
            except Exception as e:  # noqa: BLE001
                logger.error(
                    "[Agent] セグメント処理エラー: speaker=%s err=%s", speaker_id, e
                )
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && python -m pytest tests/test_agent_queue.py -v`
Expected: PASS（3 件）

- [ ] **Step 5: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/webrtc/agent.py backend/tests/test_agent_queue.py
git commit -m "fix: ingestを話者別キュー+ワーカー化しhead-of-line blockingによる遅延蓄積を解消"
```

---

### Task 12: 翻訳音声トラックの（話者×言語）分離 — 混入とエコーを同時解消

**背景（欠陥 #3, #6）:** 言語ごと 1 本の共有トラックに複数話者の並行 orchestration が 10ms フレームを交互に書き込み音声が破綻する（#3）。また共有トラックでは話者本人を配信除外できず、自分の翻訳音声がエコーとして再生される（#6）。**トラックを `translation-{lang}-{speaker}` に分離し、フロントで自分由来トラックをミュートする。**

**Files:**
- Modify: `backend/app/webrtc/publisher.py`（全面）
- Modify: `backend/app/webrtc/sink.py:36-71`
- Modify: `backend/app/webrtc/processor.py:50-51,134-135`
- Modify: `backend/app/webrtc/agent.py:190-195`
- Modify: `frontend/src/hooks/useLiveKit.ts:56-60,201-212,298-317`
- Test: `backend/tests/test_livekit_sink.py`（修正・追記）

**Interfaces:**
- Produces: `LiveKitPublisher.capture_segment(speaker_id: str, language: str, pcm48: bytes) -> None`（(speaker, lang) 単位の AudioSource + `asyncio.Lock` で 1 セグメントを原子的に capture。トラック名 `translation-{language}-{speaker_id}`）。
- Produces: `LiveKitOutputSink(user_language, capture_audio, send_data, speaker_id: str, hearing_sample_rate=24000)` — `capture_audio` の型は `Callable[[str, str, bytes], Awaitable[None]]`（speaker_id, language, pcm48）。
- Produces: `SinkFactory = Callable[[dict[str, str], str], OutputSink]`（第 2 引数 = speaker_id）。
- フロント契約: トラック名は `translation-` + `{lang}` + `-` + `{speakerId}`（lang は ja/en/zh/vi 固定でハイフンを含まない。speakerId にハイフンが含まれても最初の区切りのみで分割するため安全）。旧形式 `translation-{lang}` は speakerId 無しとして再生継続（後方互換）。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_livekit_sink.py` に追記（既存の sink 生成箇所は Step 3 で `speaker_id="sp"` を追加して更新）:

```python
@pytest.mark.asyncio
async def test_deliver_audio_passes_speaker_and_language():
    """翻訳音声は (話者, 言語) 単位で capture される（欠陥 #3/#6）。"""
    from app.audio.pcm import wrap_wav16
    from app.webrtc.sink import LiveKitOutputSink

    captured: list[tuple[str, str]] = []

    async def capture(speaker_id: str, lang: str, pcm48: bytes) -> None:
        captured.append((speaker_id, lang))

    async def send(payload: bytes, ids: list[str], topic: str) -> None:
        pass

    sink = LiveKitOutputSink(
        user_language={"u1": "en"},
        capture_audio=capture,
        send_data=send,
        speaker_id="alice",
    )
    await sink.deliver_audio("u1", wrap_wav16(b"\x01\x00" * 480, 24000))
    assert captured == [("alice", "en")]
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_livekit_sink.py -v`
Expected: FAIL（speaker_id 引数なし / コールバック 2 引数）

- [ ] **Step 3: sink.py を修正**

型・コンストラクタ・deliver_audio を変更:

```python
# 注入コールバック型
AudioCapture = Callable[[str, str, bytes], Awaitable[None]]  # (speaker, lang, pcm48)
```

```python
    def __init__(
        self,
        *,
        user_language: dict[str, str],
        capture_audio: AudioCapture,
        send_data: DataSend,
        speaker_id: str,
        hearing_sample_rate: int = 24000,
    ) -> None:
        self._user_language = user_language
        self._capture_audio = capture_audio
        self._send_data = send_data
        self._speaker_id = speaker_id
        self._hearing_sample_rate = hearing_sample_rate
        self._last_audio: dict[str, bytes] = {}

    async def deliver_audio(self, user_id: str, audio: bytes) -> None:
        """翻訳音声を (話者, 目標言語) トラックへ送る（言語単位で重複排除）。"""
        lang = self._user_language.get(user_id)
        if lang is None or not audio:
            return
        if self._last_audio.get(lang) is audio:
            return
        self._last_audio[lang] = audio

        pcm, rate = parse_wav16(audio, fallback_rate=self._hearing_sample_rate)
        pcm48 = resample16(pcm, rate, OUTPUT_SAMPLE_RATE)
        await self._capture_audio(self._speaker_id, lang, pcm48)
```

（`chunk16` の分割は publisher 側へ移動するため、sink の import から `chunk16` を外す）

- [ ] **Step 4: publisher.py を修正**

```python
"""
LiveKit 配信実体（Phase 3 C1）：翻訳音声トラックの遅延生成と data channel 送信。

トラックは (話者, 目標言語) 単位で分離する。共有トラックでは同時発話のフレームが
交互に混入して破綻し（欠陥 #3）、話者本人の除外も不可能（欠陥 #6: エコー）なため。
capture はキー単位の Lock で 1 セグメントずつ原子的に行う。
"""

import asyncio
import logging

from livekit import rtc

from app.audio.pcm import chunk16
from app.webrtc.sink import OUTPUT_SAMPLE_RATE

logger = logging.getLogger(__name__)

# 翻訳音声トラック名: translation-{lang}-{speaker}（フロントは name で振り分ける）
TRACK_NAME_PREFIX = "translation-"
_NUM_CHANNELS = 1
FRAME_MS = 10
_FRAME_SAMPLES = OUTPUT_SAMPLE_RATE * FRAME_MS // 1000  # 480 標本/10ms


class LiveKitPublisher:
    """(話者×言語) の翻訳音声トラックと data channel 送信を担う rtc 実体。"""

    def __init__(
        self, room: rtc.Room, *, sample_rate: int = OUTPUT_SAMPLE_RATE
    ) -> None:
        self._room = room
        self._sample_rate = sample_rate
        # (speaker_id, language) -> AudioSource（publish 済みトラックの入力口）
        self._sources: dict[tuple[str, str], rtc.AudioSource] = {}
        # (speaker_id, language) -> セグメント直列化用ロック
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}
        self._create_lock = asyncio.Lock()

    async def _get_source(self, speaker_id: str, language: str) -> rtc.AudioSource:
        """(話者, 言語) の AudioSource を取得（未作成ならトラックを生成・publish）。"""
        key = (speaker_id, language)
        async with self._create_lock:
            source = self._sources.get(key)
            if source is not None:
                return source
            source = rtc.AudioSource(self._sample_rate, _NUM_CHANNELS)
            track = rtc.LocalAudioTrack.create_audio_track(
                f"{TRACK_NAME_PREFIX}{language}-{speaker_id}", source
            )
            options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
            await self._room.local_participant.publish_track(track, options)
            self._sources[key] = source
            self._locks[key] = asyncio.Lock()
            logger.info(
                "[Publisher] 翻訳音声トラック publish: lang=%s speaker=%s",
                language,
                speaker_id,
            )
            return source

    async def capture_segment(
        self, speaker_id: str, language: str, pcm48: bytes
    ) -> None:
        """48k int16 モノの 1 セグメントを当該トラックへ原子的に capture する。"""
        if not pcm48:
            return
        source = await self._get_source(speaker_id, language)
        lock = self._locks[(speaker_id, language)]
        frames, _remainder = chunk16(pcm48, _FRAME_SAMPLES)
        async with lock:
            for frame in frames:
                samples_per_channel = len(frame) // (2 * _NUM_CHANNELS)
                audio_frame = rtc.AudioFrame(
                    frame, self._sample_rate, _NUM_CHANNELS, samples_per_channel
                )
                await source.capture_frame(audio_frame)

    async def send_data(
        self, payload: bytes, identities: list[str], topic: str
    ) -> None:
        """字幕/イベント payload を受信者 identity 宛てに data channel で送る。"""
        await self._room.local_participant.publish_data(
            payload, reliable=True, destination_identities=identities, topic=topic
        )
```

- [ ] **Step 5: processor.py / agent.py の配線を更新**

`processor.py:50-51`:

```python
# user_language（user_id→目標言語）と話者 ID から OutputSink を構築するファクトリ。
SinkFactory = Callable[[dict[str, str], str], OutputSink]
```

`processor.py:134-135`: `sink = sink_factory(user_language)` → `sink = sink_factory(user_language, speaker_id)`

`agent.py:190-195` の `sink_factory` を置換:

```python
        def sink_factory(
            user_language: dict[str, str], seg_speaker_id: str
        ) -> LiveKitOutputSink:
            return LiveKitOutputSink(
                user_language=user_language,
                capture_audio=publisher.capture_segment,
                send_data=publisher.send_data,
                speaker_id=seg_speaker_id,
            )
```

- [ ] **Step 6: フロントエンドを更新**

`frontend/src/hooks/useLiveKit.ts`:

`AudioEntry`（56-60 行）へ話者 ID を追加:

```typescript
interface AudioEntry {
  el: HTMLMediaElement;
  isTranslation: boolean;
  lang?: string;
  /** 翻訳音声の元話者 identity（自分由来のエコー抑止に使う） */
  speakerId?: string;
}
```

`TrackSubscribed` ハンドラ（298-317 行）のトラック名解析を置換:

```typescript
          if (track.kind !== Track.Kind.Audio) return;
          const isTranslation =
            isAgent(p.identity) && pub.trackName.startsWith(TRACK_NAME_PREFIX);
          let lang: string | undefined;
          let speakerId: string | undefined;
          if (isTranslation) {
            // 形式: translation-{lang}-{speakerId}（旧形式 translation-{lang} も許容）
            const rest = pub.trackName.slice(TRACK_NAME_PREFIX.length);
            const sep = rest.indexOf('-');
            lang = sep === -1 ? rest : rest.slice(0, sep);
            speakerId = sep === -1 ? undefined : rest.slice(sep + 1);
          }
          const entry = { el: track.attach(), isTranslation, lang, speakerId };
```

`applyAudioRouting`（205-212 行）を置換（自分由来の翻訳をミュート）:

```typescript
  const applyAudioRouting = useCallback(() => {
    const pref = myPrefRef.current;
    const myId = user?.id;
    audioEntriesRef.current.forEach((entry) => {
      entry.el.muted = entry.isTranslation
        ? !(
            pref?.audioMode === 'translated' &&
            entry.lang === pref.targetLanguage &&
            entry.speakerId !== myId // 自分の発話の翻訳は再生しない（エコー抑止）
          )
        : pref?.audioMode !== 'original';
    });
  }, [user?.id]);
```

- [ ] **Step 7: テストと型チェックが通ることを確認**

Run: `cd backend && python -m pytest tests/test_livekit_sink.py tests/test_processor.py -v`
Expected: PASS（`test_processor.py` の sink_factory スタブは 2 引数に更新）

Run: `cd frontend && npm run type-check && npm run lint`
Expected: エラー 0

- [ ] **Step 8: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/webrtc backend/tests frontend/src/hooks/useLiveKit.ts
git commit -m "fix: 翻訳音声トラックを話者×言語で分離し同時発話の混入と自声エコーを解消"
```

---

### Task 13: QoS による S2S 縮退の実配線

**背景（欠陥 #9）:** `RouteContext.s2s_available` はどの呼び出し元も供給せず常に True、`should_fallback_to_subtitle` の消費者も存在しないため、「遅延超過時は字幕のみへフォールバック」が動作として未実装。**hearing P95 超過時に `s2s_available=False` を供給し、60 秒ごとに自動再試行する。**

**Files:**
- Modify: `backend/app/ai_pipeline/qos.py:104-125`（`hearing_degraded` 追加）
- Modify: `backend/app/ai_pipeline/orchestrator.py:228-236`
- Test: `backend/tests/test_qos.py`、`backend/tests/test_orchestrator.py`（追記）

**Interfaces:**
- Produces: `HybridQoSMonitor.hearing_degraded() -> bool`（P95 超過で True。超過継続中も `retry_cooldown_s`（既定 60 秒）経過で窓をクリアして False を返し再試行させる）。コンストラクタに `retry_cooldown_s: float = 60.0` と `clock: Callable[[], float] = time.monotonic` を追加（テスト用注入）。
- Consumes: 既存 `evaluate_latency("hearing")`。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_qos.py` に追記:

```python
def test_hearing_degraded_and_retry():
    """P95 超過で縮退し、クールダウン後に窓を捨てて再試行する（欠陥 #9）。"""
    from app.ai_pipeline.qos import HybridQoSMonitor

    now = {"t": 0.0}
    monitor = HybridQoSMonitor(
        window=10, retry_cooldown_s=60.0, clock=lambda: now["t"]
    )
    assert monitor.hearing_degraded() is False  # 未計測は正常扱い

    for _ in range(10):
        monitor.record_latency("hearing", 9000.0)  # 目標 5000ms を大幅超過
    assert monitor.hearing_degraded() is True

    now["t"] = 61.0  # クールダウン経過 → 再試行（窓クリア）
    assert monitor.hearing_degraded() is False
    assert monitor.p95("hearing") is None
```

`backend/tests/test_orchestrator.py` に追記:

```python
@pytest.mark.asyncio
async def test_degraded_monitor_suppresses_hearing():
    """hearing 縮退中は聞く主線を駆動せず読む主線のみで収束する（欠陥 #9）。"""
    from app.ai_pipeline.orchestrator import HybridOrchestrator, Listener
    from app.ai_pipeline.qos import HybridQoSMonitor

    monitor = HybridQoSMonitor(window=10)
    for _ in range(10):
        monitor.record_latency("hearing", 9000.0)

    hearing_called = {"n": 0}

    async def hearing_fn(audio, src, tgt, speaker, original_text):
        hearing_called["n"] += 1

        class Out:
            audio_data = b"wav"
            translated_text = "x"

        return Out()

    async def reading_fn(text, src, tgt):
        return "hello"

    class NullSink:
        async def deliver_audio(self, user_id, audio):
            pass

        async def deliver_subtitle(self, user_id, message):
            pass

        async def deliver_event(self, user_id, message):
            pass

    orch = HybridOrchestrator(
        hearing_fn=hearing_fn, reading_fn=reading_fn, monitor=monitor
    )
    result = await orch.orchestrate(
        audio_bytes=b"pcm",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", wants_audio=True, subtitle_enabled=True)],
        sink=NullSink(),
        mode="hybrid",
        speaker_id="sp",
    )
    assert hearing_called["n"] == 0
    assert result.translations["en"] == "hello"
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_qos.py::test_hearing_degraded_and_retry tests/test_orchestrator.py::test_degraded_monitor_suppresses_hearing -v`
Expected: FAIL（`hearing_degraded` 未定義 / hearing が呼ばれる）

- [ ] **Step 3: qos.py に縮退判定を実装**

`HybridQoSMonitor.__init__` シグネチャへ追加（import に `from collections.abc import Callable` を追加）:

```python
        retry_cooldown_s: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        ...
        self._retry_cooldown_s = retry_cooldown_s
        self._clock = clock
        self._degraded_since: float | None = None
```

メソッド追加:

```python
    def hearing_degraded(self) -> bool:
        """聞く主線の P95 目標超過による縮退判定（§9 の実配線。欠陥 #9）。

        超過が続く場合も retry_cooldown_s 経過で窓を捨てて False を返し、
        次のセグメントで S2S を再試行させる。
        # ponytail: 単純クールダウン。ヒステリシスは必要になったら導入。
        """
        if self.evaluate_latency("hearing") is None:
            self._degraded_since = None
            return False
        now = self._clock()
        if self._degraded_since is None:
            self._degraded_since = now
            return True
        if now - self._degraded_since >= self._retry_cooldown_s:
            self._latency["hearing"].clear()
            self._degraded_since = None
            return False
        return True
```

- [ ] **Step 4: orchestrator.py で可用性を供給**

`orchestrate` の groups 構築直後（`async def run_group` の前）に追加し、`RouteContext` に渡す:

```python
        # §9 実配線: hearing P95 超過中は聞く主線を止め、字幕へ縮退させる（欠陥 #9）
        s2s_available = True
        if self._monitor is not None:
            s2s_available = not self._monitor.hearing_degraded()
```

`run_group` 内:

```python
            ctx = RouteContext(
                mode=mode,
                source_language=source_language,
                target_language=target_lang,
                enable_openai_s2s=enable_openai_s2s,
                language_routes=language_routes or {},
                s2s_available=s2s_available,
            )
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd backend && python -m pytest tests/test_qos.py tests/test_orchestrator.py -v`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/ai_pipeline/qos.py backend/app/ai_pipeline/orchestrator.py backend/tests
git commit -m "fix: hearing P95超過時のS2S縮退を実配線（クールダウン付き自動再試行）"
```

---

# Phase 3: キャッシュ健全化

### Task 14: 翻訳キャッシュへ用語集バージョン次元を追加し、コンテキスト付き結果を非キャッシュ化

**背景（欠陥 #14）:** キー `text_translate:{src}:{tgt}:{md5}`（TTL 24h）には用語集バージョンがなく、用語修正後も旧訳が最大 24 時間配信される。また会話コンテキストを注入した訳文が文脈次元なしのグローバルキーで保存され、別会議室へ流出する。

**Files:**
- Modify: `backend/app/translate/routes.py:53-56,160-196`（キー生成・保存条件）
- Modify: `backend/app/translate/glossary_routes.py`（CRUD 後のバージョン更新）
- Test: `backend/tests/test_glossary.py`（追記）

**Interfaces:**
- Produces: `_cache_key(text: str, src: str, tgt: str, glossary_version: str) -> str`（`text_translate:v{version}:{src}:{tgt}:{md5}`）、`_glossary_version() -> str`（Redis `glossary:version`、失敗時 `"0"`）、`bump_glossary_version() -> None`（INCR。用語集 CRUD 後に呼ぶ）。
- 方針: room 次元は追加しない。代わりに**コンテキストが空のときだけ** setex する（文脈付き訳文の共有キャッシュ流出を止める最小手）。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_glossary.py` に追記:

```python
def test_cache_key_includes_glossary_version():
    """キャッシュキーは用語集バージョンを含む（欠陥 #14: 旧訳の残存防止）。"""
    from app.translate.routes import _cache_key

    k1 = _cache_key("こんにちは", "ja", "en", "3")
    k2 = _cache_key("こんにちは", "ja", "en", "4")
    assert k1 != k2
    assert k1.startswith("text_translate:v3:ja:en:")
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_glossary.py::test_cache_key_includes_glossary_version -v`
Expected: FAIL（TypeError: 引数 3 個）

- [ ] **Step 3: routes.py を修正**

`_cache_key` と新関数:

```python
_GLOSSARY_VERSION_KEY = "glossary:version"


def _cache_key(text: str, src: str, tgt: str, glossary_version: str) -> str:
    """キャッシュキー生成（用語集世代を含む。世代更新で旧訳を一括無効化）"""
    text_hash = hashlib.md5(text.encode()).hexdigest()
    return f"text_translate:v{glossary_version}:{src}:{tgt}:{text_hash}"


async def _glossary_version() -> str:
    """現在の用語集バージョン（未設定/障害時は "0"）"""
    try:
        r = await _get_redis()
        return await r.get(_GLOSSARY_VERSION_KEY) or "0"
    except Exception:
        return "0"


async def bump_glossary_version() -> None:
    """用語集 CRUD 後に呼び、text_translate キャッシュを世代ごと無効化する"""
    try:
        r = await _get_redis()
        await r.incr(_GLOSSARY_VERSION_KEY)
    except Exception as e:
        logger.warning(f"[Translate] 用語集バージョン更新エラー: {e}")
```

`translate_text` エンドポイント（160 行付近）: キャッシュ参照前に `glossary_version = await _glossary_version()` を取得し、`_cache_key(req.text, req.source_language, req.target_language, glossary_version)` へ。保存側（190 行付近）は**コンテキストが空のときのみ**保存:

```python
    # キャッシュ保存（文脈付き訳文は共有キャッシュへ入れない。欠陥 #14: 部屋間流出防止）
    if not context:
        try:
            r = await _get_redis()
            await r.setex(cache_key, CACHE_TTL, translated_text)
        except Exception as e:
            logger.warning(f"[Translate] キャッシュ保存エラー: {e}")
```

`translate_text_simple`（364 行〜）内の `_cache_key` 呼び出しも同様に `glossary_version` を取得して渡す（`grep -n "_cache_key(" backend/app/translate/routes.py` で全呼び出し箇所を更新。simple 経路はコンテキストを使わないため保存条件は従来どおり）。

- [ ] **Step 4: glossary_routes.py の CRUD にバージョン更新を追加**

`grep -n "invalidate_cache" backend/app/translate/glossary_routes.py` で見つかる各 CRUD ハンドラの `glossary.invalidate_cache()` 直後に追記:

```python
    from app.translate.routes import bump_glossary_version

    await bump_glossary_version()
```

（import はファイル先頭へ移動して循環がないことを確認。循環する場合のみハンドラ内 import を維持）

- [ ] **Step 5: テストが通ることを確認**

Run: `cd backend && python -m pytest tests/test_glossary.py tests/ -v`
Expected: PASS（`_cache_key` 旧シグネチャを使う既存テストがあれば更新）

- [ ] **Step 6: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/translate backend/tests
git commit -m "fix: 翻訳キャッシュに用語集世代を導入し、文脈付き訳文の共有キャッシュ流出を停止"
```

---

### Task 15: 字幕翻訳エラー時の原文キャッシュ廃止とクレーム解放

**背景（欠陥 #15）:** `get_subtitle_translation` はエラー/空結果時に原文を `store_translation` で正規訳として 1 時間キャッシュし status=ready で返すため、一過性障害が固定化され再試行不能になる。さらに pending マーカー（60 秒 TTL）が残ると他リクエストも待たされる。**失敗はキャッシュせず status="error" で返し、マーカーを即時解放する。**

**Files:**
- Modify: `backend/app/translate/subtitle_cache.py`（`release_claim` 追加）
- Modify: `backend/app/translate/routes.py:500-538`（エラー/空結果分岐）
- Modify: `frontend/src/hooks/useTranslation.ts:29`（status 型に 'error' 追加）
- Test: `backend/tests/test_glossary.py` または `backend/tests/test_ai_providers.py` ではなく **新規** `backend/tests/test_subtitle_cache.py`

**Interfaces:**
- Produces: `subtitle_cache.release_claim(subtitle_id: str, target_lang: str) -> None`（pending マーカー削除）。`SubtitleTranslationResponse.status` に `"error"` が加わる（レスポンスモデルの `status` が Literal の場合は `"error"` を追加。`translated_text` には表示用フォールバックとして原文を入れるが**キャッシュはしない**）。
- フロント契約: `status: 'ready' | 'pending' | 'not_found' | 'error'`。`'error'` は ready 扱いしない（次回ポーリングで再試行される）。

- [ ] **Step 1: 失敗テストを書く**

`backend/tests/test_subtitle_cache.py`（新規）:

```python
"""字幕翻訳の失敗がキャッシュ固定化されないことのテスト（欠陥 #15）。"""
from unittest.mock import AsyncMock

import pytest

from app.translate import subtitle_cache


@pytest.mark.asyncio
async def test_release_claim_deletes_pending_marker(monkeypatch):
    fake_redis = AsyncMock()
    monkeypatch.setattr(subtitle_cache, "_redis", fake_redis)

    await subtitle_cache.release_claim("sub-1", "en")
    fake_redis.delete.assert_awaited_once_with(
        subtitle_cache._pending_key("sub-1", "en")
    )


@pytest.mark.asyncio
async def test_translation_error_not_cached(monkeypatch):
    """翻訳例外時に store_translation（原文の ready 固定化）を呼ばない。"""
    from app.translate import routes

    stored: list = []
    monkeypatch.setattr(
        subtitle_cache, "get_translation", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        subtitle_cache,
        "get_original",
        AsyncMock(return_value=("こんにちは", "ja")),
    )
    monkeypatch.setattr(
        subtitle_cache, "mark_translation_pending", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(
        subtitle_cache,
        "store_translation",
        AsyncMock(side_effect=lambda *a: stored.append(a)),
    )
    released = AsyncMock()
    monkeypatch.setattr(subtitle_cache, "release_claim", released)

    async def boom(text, src, tgt):
        raise RuntimeError("api down")

    monkeypatch.setattr(routes, "translate_text_simple", boom)

    resp = await routes.get_subtitle_translation("sub-1", "en", wait=True)
    assert resp.status == "error"
    assert stored == []  # 原文が翻訳としてキャッシュされない
    released.assert_awaited_once()
```

（`get_subtitle_translation` が FastAPI 依存（Depends）を持つ場合は、テストから直接呼べる形の関数シグネチャを確認し、認証依存があれば `user` 引数へダミーを渡す）

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && python -m pytest tests/test_subtitle_cache.py -v`
Expected: FAIL（`release_claim` 未定義 / status が "ready" / stored 非空）

- [ ] **Step 3: subtitle_cache.py に `release_claim` を追加**

```python
async def release_claim(subtitle_id: str, target_lang: str) -> None:
    """翻訳中マーカーを解放する（翻訳失敗時に他リクエストへ再試行させる）。"""
    try:
        r = await _get_redis()
        await r.delete(_pending_key(subtitle_id, target_lang))
    except Exception as e:
        logger.warning(f"[SubtitleCache] マーカー解放エラー: {e}")
```

- [ ] **Step 4: routes.py のエラー/空結果分岐を修正**

`get_subtitle_translation` の `should_translate` ブロック（500-538 行）を置換:

```python
    if should_translate:
        # このリクエストが翻訳を担当
        try:
            translated = await translate_text_simple(
                original_text, source_lang, target_lang
            )
            if translated:
                await subtitle_cache.store_translation(
                    subtitle_id, target_lang, translated
                )
                return SubtitleTranslationResponse(
                    subtitle_id=subtitle_id,
                    target_language=target_lang,
                    translated_text=translated,
                    status="ready",
                )
            # 翻訳結果が空: 原文を ready でキャッシュ固定化しない（欠陥 #15）。
            # マーカーを解放し、次回リクエストで再試行させる。
            logger.warning(f"[SubtitleTranslate] 翻訳結果が空: {subtitle_id}")
            await subtitle_cache.release_claim(subtitle_id, target_lang)
            return SubtitleTranslationResponse(
                subtitle_id=subtitle_id,
                target_language=target_lang,
                translated_text=original_text,  # 表示用フォールバック（非キャッシュ）
                status="error",
            )
        except Exception as e:
            logger.error(f"[SubtitleTranslate] 翻訳エラー: {e}")
            await subtitle_cache.release_claim(subtitle_id, target_lang)
            return SubtitleTranslationResponse(
                subtitle_id=subtitle_id,
                target_language=target_lang,
                translated_text=original_text,  # 表示用フォールバック（非キャッシュ）
                status="error",
            )
```

`SubtitleTranslationResponse` の `status` フィールドが Literal 定義なら `"error"` を追加する。

- [ ] **Step 5: フロントの status 型を更新**

`frontend/src/hooks/useTranslation.ts:29`:

```typescript
  status: 'ready' | 'pending' | 'not_found' | 'error';
```

（158 行の `status === 'ready'` 判定はそのまま。'error' は ready 扱いされず、既存のポーリング/次回要求で再試行される）

- [ ] **Step 6: テストと型チェックが通ることを確認**

Run: `cd backend && python -m pytest tests/test_subtitle_cache.py -v && cd ../frontend && npm run type-check`
Expected: PASS / エラー 0

- [ ] **Step 7: コミット**

```bash
cd backend && ruff check app/ tests/ && cd ..
git add backend/app/translate backend/tests/test_subtitle_cache.py frontend/src/hooks/useTranslation.ts
git commit -m "fix: 字幕翻訳の失敗を原文readyとしてキャッシュ固定化せず、マーカー解放で再試行可能に"
```

---

### Task 16: 全体検証

**Files:**
- なし（検証のみ）

- [ ] **Step 1: 静的解析＋全テスト**

Run: `./scripts/check.sh`
Expected: エラー 0

Run: `cd backend && python -m pytest tests/ -v`
Expected: 全 PASS

- [ ] **Step 2: 動作確認（手動）**

```bash
docker compose up postgres redis -d
cd backend && uvicorn app.main:app --reload --port 8090
# 別ターミナル
cd frontend && npm run dev
```

確認項目:
1. 会議室で発話 → 字幕が表示される（センチネル文字列が出ない）
2. hybrid モードで翻訳音声＋字幕が同一内容（二重 ASR 解消の目視確認）
3. 話者自身に自分の翻訳音声が再生されない（エコー解消）
4. OPENAI_API_KEY を空にして起動 → 明確なエラーメッセージで停止（フェイルファスト）

- [ ] **Step 3: 残課題の確認**

`git log --oneline main..HEAD` で 15 コミットを確認し、未完了タスクがあれば戻って実施。

---

## Self-Review 結果

- **スコープ照合:** レビュー確定 15 欠陥のうち、#1→Task 9、#2→Task 5、#3/#6→Task 12、#4→Task 2+3、#5→Task 4、#7→Task 8、#8→Task 1、#9→Task 13、#10→Task 10、#11→Task 11、#12→Task 6、#13→Task 7、#14→Task 14、#15→Task 15。S2S 常駐セッション再設計と OSS モデル統合は Out of scope として明記（別計画）。
- **型整合:** `HearingFn` の 5 引数化（Task 9）は Task 10/13 のテストコードにも反映済み。`SinkFactory` の 2 引数化（Task 12）は processor/agent/テストで一貫。`parse_wav16` は Task 5 で定義し Task 12 の sink コードでも同名を使用。
- **順序依存:** Task 9 → 10 → 13（orchestrator を段階変更）、Task 5 → 12（sink の parse_wav16 前提）。Phase 1 内は独立で並列可。
