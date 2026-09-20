"""Testing Kitの起動待ちが宣言済み上限と実プロセス状態を守ることを検証する。

入力: 復旧済みKitと仮想時計。出力: unittest結果。実通信・GPU・DBは使用しない。
"""

from __future__ import annotations

import sys
import json
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / ".venv-testing-kit/testing_kit"
sys.path.insert(0, str(KIT / "scripts"))
sys.path.insert(0, str(ROOT / "e2e/scripts"))

import apply_kit_startup_patch as installer  # noqa: E402
import browser_discovery as discovery  # noqa: E402
import certify_project as kernel  # noqa: E402


class StartupDeadlineTests(unittest.TestCase):
    """遅い正常起動・期限切れ・起動プロセス消滅を別々に検証する。"""

    def run_probe(
        self,
        timeout: int,
        ready_at: float | None,
        polls: list[int | None] | None = None,
    ) -> float:
        """仮想時刻のHTTP応答を使い、実カーネルの待機処理を実行する。"""
        self.elapsed = 0.0
        runner = kernel.CertificationRunner.__new__(kernel.CertificationRunner)
        runner._browser_contract = Mock(
            return_value=("http://127.0.0.1:1", "/identity")
        )
        runner._command = Mock(return_value=SimpleNamespace(timeout_seconds=timeout))
        runner._finalize_server_diagnostic = Mock(return_value="diagnostic.json")
        runner.server = Mock()
        runner.server.poll = (
            Mock(side_effect=polls) if polls else Mock(return_value=None)
        )

        def sleep(seconds: float) -> None:
            """実時間を待たず、単調時計だけを進める。"""
            self.elapsed += seconds

        def response(*_args: object, **_kwargs: object) -> object:
            """準備完了時刻まで接続失敗、その後にHTTP 200を返す。"""
            if ready_at is None or self.elapsed < ready_at:
                raise kernel.urllib.error.URLError("not ready")
            return nullcontext(SimpleNamespace(status=200))

        with (
            patch.object(kernel.time, "monotonic", lambda: self.elapsed),
            patch.object(kernel.time, "sleep", sleep),
            patch.object(kernel.urllib.request, "urlopen", response),
        ):
            runner._wait_for_identity()
        return self.elapsed

    def test_model_ready_after_thirty_seconds_within_declared_budget(self) -> None:
        """180秒契約で45秒後に起動した実体は受理する。"""
        elapsed = self.run_probe(timeout=180, ready_at=45)
        self.assertGreaterEqual(elapsed, 45)
        self.assertLess(elapsed, 45.3)

    def test_shorter_declared_deadline_is_enforced(self) -> None:
        """7秒の契約を30秒へ無断で延長しない。"""
        with self.assertRaisesRegex(kernel.CertificationError, "did not become ready"):
            self.run_probe(timeout=7, ready_at=None)
        self.assertGreaterEqual(self.elapsed, 7)
        self.assertLess(self.elapsed, 7.3)

    def test_ready_after_deadline_is_rejected(self) -> None:
        """宣言された30秒を超えた応答は不合格のままにする。"""
        with self.assertRaisesRegex(kernel.CertificationError, "did not become ready"):
            self.run_probe(timeout=30, ready_at=45)

    def test_process_exit_before_probe_is_rejected(self) -> None:
        """サーバー終了をHTTPの成功で代替しない。"""
        with self.assertRaisesRegex(kernel.CertificationError, "exited before"):
            self.run_probe(timeout=180, ready_at=0, polls=[1])

    def test_process_exit_during_successful_probe_is_rejected(self) -> None:
        """200応答直後にも所有プロセスが生存していることを要求する。"""
        with self.assertRaisesRegex(kernel.CertificationError, "exited during"):
            self.run_probe(timeout=180, ready_at=0, polls=[None, 0])


class ConfigurationLayoutTests(unittest.TestCase):
    """ソースと秘密の保存先を、実際のブラウザ探索契約へ束縛する。"""

    def setUp(self) -> None:
        """追跡対象の正式プロファイルを読み込む。"""
        self.profile = ROOT / "e2e/certification"
        self.contract = json.loads(
            (self.profile / "app-owned-runtime.json").read_text()
        )

    def test_discovery_reads_the_declared_source_inventory(self) -> None:
        """開始画面だけへの暗黙縮退を認めず、全ソース画面を探索母数にする。"""
        routes, path = discovery._source_inventory(self.profile)
        declared = ROOT / self.contract["certification"]["source_inventory"]
        self.assertEqual(path, declared)
        source = kernel.yaml.safe_load(declared.read_text())
        self.assertEqual(
            routes, {row["path"].rstrip("/") or "/" for row in source["screens"]}
        )

    def test_auth_storage_is_inside_the_owned_profile(self) -> None:
        """Kitが拒否する親ディレクトリの認証状態を指定しない。"""
        states = self.contract["certification"]["auth_storage_states"]
        self.assertEqual(set(states), {"admin", "moderator", "user"})
        for value in states.values():
            self.assertTrue((ROOT / value).resolve().is_relative_to(self.profile))


class PatchVersionTests(unittest.TestCase):
    """配布版の取り違えと、同じ修正の二重適用を防ぐ。"""

    def original(self) -> bytes:
        """確認済みファイルから1行の変更前内容を復元する。"""
        return installer.KERNEL.read_bytes().replace(
            installer.AFTER, installer.BEFORE, 1
        )

    def test_known_original_is_patched(self) -> None:
        """受理する元ハッシュと適用後ハッシュを検証する。"""
        changed = installer.patched_bytes(self.original())
        self.assertEqual(
            installer.hashlib.sha256(changed).hexdigest(), installer.PATCHED_SHA256
        )

    def test_known_patch_is_idempotent(self) -> None:
        """適用済みの内容を再変更しない。"""
        changed = installer.patched_bytes(self.original())
        self.assertEqual(installer.patched_bytes(changed), changed)

    def test_unknown_version_is_rejected(self) -> None:
        """別変更を含む配布物へ推測で適用しない。"""
        with self.assertRaisesRegex(ValueError, "unknown Testing Kit"):
            installer.patched_bytes(self.original() + b"\n# unreviewed change\n")


if __name__ == "__main__":
    unittest.main()
