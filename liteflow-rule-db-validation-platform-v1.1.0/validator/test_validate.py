import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("validate.py")
spec = importlib.util.spec_from_file_location("validator_module", MODULE_PATH)
validator = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(validator)


class ValidatorReportTest(unittest.TestCase):
    def test_render_and_summary(self):
        report = validator.new_report("unit-test")
        validator.add_check(report, "A", "success", "PASS", {"ok": True}, 12.3)
        validator.add_check(report, "B", "warning", "WARN", {"value": 1}, required=False)
        validator.summarize(report)
        self.assertEqual("WARN", report["overallStatus"])
        markdown = validator.render_markdown(report)
        self.assertIn("LiteFlow v2.16.1", markdown)
        self.assertIn("COBOL", markdown)


    def test_build_evidence_and_junit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = root / "build-evidence.json"
            metadata = root / "build-metadata.json"
            junit = root / "junit"
            junit.mkdir()
            evidence.write_text(json.dumps({"status": "PASS", "imageId": "sha256:test"}), encoding="utf-8")
            metadata.write_text(json.dumps({"liteflowVersion": "2.16.1", "resolutionMode": "official-source-build", "sourceCommit": "test"}), encoding="utf-8")
            (junit / "TEST-sample.xml").write_text(
                '<testsuite tests="1" failures="0" errors="0" skipped="0"></testsuite>',
                encoding="utf-8")
            original_evidence = validator.BUILD_EVIDENCE_JSON
            original_metadata = validator.BUILD_METADATA_JSON
            original_junit = validator.JUNIT_DIR
            validator.BUILD_EVIDENCE_JSON = evidence
            validator.BUILD_METADATA_JSON = metadata
            validator.JUNIT_DIR = junit
            try:
                report = validator.new_report("build-test")
                validator.add_build_checks(report)
            finally:
                validator.BUILD_EVIDENCE_JSON = original_evidence
                validator.BUILD_METADATA_JSON = original_metadata
                validator.JUNIT_DIR = original_junit
            self.assertEqual("PASS", report["checks"][0]["status"])
            self.assertEqual("PASS", report["checks"][1]["status"])
            self.assertEqual("PASS", report["checks"][2]["status"])


    def test_dashboard_uid_matches_packaged_dashboard(self):
        dashboard_path = MODULE_PATH.parents[1] / "monitoring" / "grafana" / "dashboards" / "liteflow-dashboard.json"
        dashboard = json.loads(dashboard_path.read_text(encoding="utf-8"))
        self.assertEqual(dashboard["uid"], validator.DASHBOARD_UID)

    def test_unexpected_failure_can_be_written(self):
        with tempfile.TemporaryDirectory() as directory:
            original_dir = validator.REPORT_DIR
            original_json = validator.REPORT_JSON
            original_md = validator.REPORT_MD
            validator.REPORT_DIR = Path(directory)
            validator.REPORT_JSON = Path(directory) / "validation-report.json"
            validator.REPORT_MD = Path(directory) / "validation-report.md"
            try:
                report = validator.new_report("fatal-test")
                validator.add_check(report, "FATAL-01", "fatal", "FAIL", {"message": "boom"})
                validator.save_report(report)
                self.assertTrue(validator.REPORT_JSON.exists())
                saved = json.loads(validator.REPORT_JSON.read_text(encoding="utf-8"))
                self.assertEqual("FAIL", saved["overallStatus"])
            finally:
                validator.REPORT_DIR = original_dir
                validator.REPORT_JSON = original_json
                validator.REPORT_MD = original_md

    def test_required_failure(self):
        report = validator.new_report("unit-test-fail")
        validator.add_check(report, "F", "failure", "FAIL", {"ok": False})
        validator.summarize(report)
        self.assertEqual("FAIL", report["overallStatus"])
        json.dumps(report, ensure_ascii=False)


if __name__ == "__main__":
    unittest.main()
