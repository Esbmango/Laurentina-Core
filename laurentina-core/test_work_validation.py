"""Explicit artifact checks use isolated files and never execute user code."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import core_work_validation as validation


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="laurentina-artifacts-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "report.md").write_text("actual result", encoding="utf-8")

    def spec(self, *checks):
        return {"root": str(self.root), "checks": list(checks)}

    def check(self, *checks):
        return validation.validate_artifacts(self.spec(*checks))

    def write_json(self, data):
        (self.root / "summary.json").write_text(json.dumps(data), encoding="utf-8")

    def directory_link(self, link, target):
        if os.name == "nt":
            completed = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True)
            self.assertEqual(completed.returncode, 0)
            self.addCleanup(link.rmdir)
        else:
            link.symlink_to(target, target_is_directory=True)
            self.addCleanup(link.unlink)
        return link

    def test_file_sha_size_and_safe_receipt(self):
        digest = hashlib.sha256(b"actual result").hexdigest()
        result = self.check({"kind": "file", "path": "report.md", "sha256": digest})
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["checks"][0]["artifact"], {"path": "report.md", "bytes": 13, "sha256": digest})
        self.assertNotIn("actual result", json.dumps(result))
        self.assertIn("checked_at", result)

    def test_file_missing_empty_oversize_and_wrong_sha_fail_independently(self):
        (self.root / "empty.txt").touch()
        result = self.check(*[
            {"kind": "file", "path": "missing.txt"},
            {"kind": "file", "path": "empty.txt"},
            {"kind": "file", "path": "report.md", "max_bytes": 3},
            {"kind": "file", "path": "report.md", "sha256": "0" * 64},
            {"kind": "file", "path": "report.md"}])
        self.assertEqual([item["status"] for item in result["checks"]], ["failed"] * 4 + ["passed"])
        self.assertEqual(result["status"], "failed")

    def test_json_pointer_escaping_array_tolerance_and_reject_bool(self):
        self.write_json({"a/b": {"c~d": [1.125]}, "flag": True})
        result = self.check(
            {"kind": "json_number", "path": "summary.json", "pointer": "/a~1b/c~0d/0", "equals": 1.12, "tolerance": 0.006},
            {"kind": "json_number", "path": "summary.json", "pointer": "/flag", "equals": 1},
            {"kind": "json_number", "path": "summary.json", "pointer": "/missing", "equals": 1})
        self.assertEqual([item["status"] for item in result["checks"]], ["passed", "failed", "failed"])

    def test_json_failure_never_exposes_parser_contents_or_raw_exceptions(self):
        for raw in (b'{"credential":"DO-NOT-EXPOSE",broken}', b'{"amount":NaN}', b'\xff'):
            with self.subTest(raw=raw):
                (self.root / "summary.json").write_bytes(raw)
                result = self.check({"kind": "json_number", "path": "summary.json", "pointer": "/amount", "equals": 1})
                self.assertEqual(result["status"], "failed")
                self.assertNotIn("DO-NOT-EXPOSE", json.dumps(result))
                self.assertNotIn("column", json.dumps(result))

    def csv_fixture(self):
        (self.root / "expenses.csv").write_text("category,amount_cents\nfood,123\ntravel,250\nfood,-23\n", encoding="utf-8-sig")
        self.write_json({"row_count": 3, "grand_total_cents": 350, "by_category_cents": {"food": 100, "travel": 250}})
        return {"kind": "csv_json_totals", "csv": "expenses.csv", "json": "summary.json"}

    def test_csv_totals_independent_and_tampered_total_fails(self):
        check = self.csv_fixture()
        result = self.check(check)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["checks"][0]["grand_total"], 350)
        self.assertEqual(result["checks"][0]["row_count"], 3)
        self.write_json({"row_count": 3, "grand_total_cents": 351, "by_category_cents": {"food": 100, "travel": 250}})
        self.assertEqual(self.check(check)["status"], "failed")

    def test_csv_rejects_duplicate_columns_noninteger_and_bool_summary(self):
        check = self.csv_fixture()
        for raw in ("category,amount_cents,amount_cents\nfood,1,2\n", "category,amount_cents\nfood,1.2\n", "category,amount_cents\nfood\n"):
            with self.subTest(raw=raw):
                (self.root / "expenses.csv").write_text(raw, encoding="utf-8")
                self.assertEqual(self.check(check)["status"], "failed")
        self.csv_fixture()
        self.write_json({"row_count": True, "grand_total_cents": 350, "by_category_cents": {"food": 100, "travel": 250}})
        self.assertEqual(self.check(check)["status"], "failed")

    def test_spec_rejects_commands_unknown_fields_bad_numbers_and_excessive_checks(self):
        invalid = [
            self.spec({"kind": "command", "command": "anything"}),
            self.spec({"kind": "file", "path": "report.md", "command": "anything"}),
            self.spec({"kind": "file", "path": "report.md", "max_bytes": True}),
            self.spec({"kind": "file", "path": "report.md", "sha256": "bad"}),
            self.spec({"kind": "json_number", "path": "summary.json", "pointer": "/x", "equals": float("inf")}),
            self.spec({"kind": "json_number", "path": "summary.json", "pointer": "/x", "equals": True}),
            self.spec({"kind": "json_number", "path": "summary.json", "pointer": "/~2", "equals": 1}),
            self.spec({"kind": "file", "path": "report.md", "label": "\n"}),
            self.spec(*[{"kind": "file", "path": "report.md"}] * 17),
            self.spec(),
            {**self.spec({"kind": "file", "path": "report.md"}), "script": "anything"}]
        with patch("subprocess.run") as execute:
            for spec in invalid:
                with self.subTest(spec=spec), self.assertRaises(validation.ValidationError):
                    validation.normalize_spec(spec)
            execute.assert_not_called()

    def test_paths_reject_traversal_absolute_ads_secrets_and_private_data(self):
        for path in ("../report.md", "nested/../report.md", "./report.md", "nested//report.md", "C:/data.txt", "/data.txt",
                     "report.md:stream", ".env", ".env.local", "nested/.ssh/key.txt", "auth.json", "nested/core.sqlite3",
                     "private-key.txt", "nested/voice-profiles/name.wav"):
            with self.subTest(path=path), self.assertRaises(validation.ValidationError):
                validation.normalize_spec(self.spec({"kind": "file", "path": path}))
        for root in (str(Path.home()), self.root.anchor, "relative", "\\\\server\\share", str(Path(validation.__file__).parent / ".local")):
            with self.subTest(root=root), self.assertRaises(validation.ValidationError):
                validation.normalize_spec({"root": root, "checks": [{"kind": "file", "path": "report.md"}]})
        nested = self.root / ".hermes" / "nested"
        nested.mkdir(parents=True)
        with self.assertRaises(validation.ValidationError):
            validation.normalize_spec({"root": str(nested), "checks": [{"kind": "file", "path": "x.txt"}]})

    def test_hardlink_to_other_data_rejected(self):
        os.link(self.root / "report.md", self.root / "alias.md")
        self.assertEqual(self.check({"kind": "file", "path": "alias.md"})["status"], "failed")

    def test_exact_mac_system_alias_is_canonicalized_but_artifact_links_are_rejected(self):
        # Use a real native link/junction so this branch also runs on Windows;
        # on macOS the same narrow mapping covers /var and /tmp temp roots.
        canonical = self.root / "canonical-host-root"
        selected = canonical / "selected-task"
        selected.mkdir(parents=True)
        (selected / "result.txt").write_text("real output", encoding="utf-8")
        alias = self.directory_link(self.root / "system-root-alias", canonical)
        spec = {"root": str(alias / "selected-task"), "checks": [{"kind": "file", "path": "result.txt"}]}
        with patch.object(validation.sys, "platform", "darwin"), patch.object(validation, "_DARWIN_ROOT_ALIASES", {str(alias): str(canonical.resolve())}):
            normalized = validation.normalize_spec(spec)
            self.assertEqual(normalized["root"], str(selected.resolve()))
            self.assertEqual(validation.validate_artifacts(normalized)["status"], "passed")
            nested_link = self.directory_link(selected / "linked", selected)
            linked_spec = {"root": str(alias / "selected-task"), "checks": [{"kind": "file", "path": "linked/result.txt"}]}
            self.assertEqual(validation.validate_artifacts(linked_spec)["status"], "failed")
            with self.assertRaises(validation.ValidationError):
                validation.normalize_spec({**spec, "root": str(alias / "selected-task" / nested_link.name)})

    def test_mac_alias_target_mismatch_and_unrecognized_ancestor_links_are_rejected(self):
        canonical = self.root / "canonical-host-root"
        selected = canonical / "selected-task"
        selected.mkdir(parents=True)
        alias = self.directory_link(self.root / "untrusted-alias", canonical)
        spec = {"root": str(alias / "selected-task"), "checks": [{"kind": "file", "path": "result.txt"}]}
        with patch.object(validation.sys, "platform", "darwin"):
            with self.assertRaises(validation.ValidationError):
                validation.normalize_spec(spec)
            with patch.object(validation, "_DARWIN_ROOT_ALIASES", {str(alias): str(self.root / "different-target")}):
                with self.assertRaises(validation.ValidationError):
                    validation.normalize_spec(spec)

    def test_junction_or_symlink_not_followed_even_if_added_after_spec(self):
        directory = self.root / "actual"
        directory.mkdir()
        (directory / "result.txt").write_text("x", encoding="utf-8")
        spec = validation.normalize_spec(self.spec({"kind": "file", "path": "linked/result.txt"}))
        link = self.root / "linked"
        if os.name == "nt":
            completed = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(directory)], capture_output=True)
            self.assertEqual(completed.returncode, 0)
        else:
            link.symlink_to(directory, target_is_directory=True)
        try:
            self.assertEqual(validation.validate_artifacts(spec)["status"], "failed")
            with self.assertRaises(validation.ValidationError):
                validation.normalize_spec({"root": str(link), "checks": [{"kind": "file", "path": "result.txt"}]})
        finally:
            link.rmdir() if os.name == "nt" else link.unlink()

    def test_final_open_path_checked_against_swap_and_budget_is_bounded(self):
        with patch.object(validation, "_opened_path", return_value=self.root.parent / "outside.txt"):
            result = self.check({"kind": "file", "path": "report.md"})
        self.assertEqual(result["status"], "failed")
        with patch.object(validation, "MAX_TOTAL", 10):
            result = self.check({"kind": "file", "path": "report.md"})
        self.assertEqual(result["status"], "failed")

    def test_cancellation_stops_bounded_read(self):
        calls = 0
        def cancelled():
            nonlocal calls
            calls += 1
            return calls > 1
        with self.assertRaises(InterruptedError):
            validation.validate_artifacts(self.spec({"kind": "file", "path": "report.md"}), cancelled)
        self.assertLessEqual(calls, 3)


if __name__ == "__main__":
    unittest.main()
