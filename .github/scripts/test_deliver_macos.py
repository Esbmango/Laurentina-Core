"""Offline fixtures only: no token lookup, network, download or real upload."""
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import deliver_macos as delivery


class DeliveryTests(unittest.TestCase):
    def fixture(self, directory):
        preview = {}
        for name in delivery.PREVIEWS:
            data = ("fixture " + name).encode()
            (directory / name).write_bytes(data)
            preview[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        build = {"version": delivery.VERSION, "architecture": "arm64", "artifacts": [
            {"file": "/private/runner/build/" + name, **values} for name, values in preview.items()]}
        checks = dict.fromkeys(["ui_ready", "initially_empty", "conversation_roundtrip", "private_mode",
            "hidden_after_close", "reopened", "external_data", "memory_external_data", "bundle_unchanged",
            "signature_valid_after_run"], True)
        checks["version"] = delivery.VERSION
        smoke = {"ok": True, "platform": "darwin", "arch": "arm64", "models_downloaded": False,
                 "renderer_errors": [], "checks": checks}
        (directory / "build-report.json").write_text(json.dumps(build))
        (directory / "smoke-report.json").write_text(json.dumps(smoke))
        (directory / "smoke-report.png").write_bytes(b"\x89PNGfixture")
        return preview

    def client(self, fault=None, assets=None):
        class FakeClient:
            def __init__(self):
                self.uploaded = []
                self.assets = [{"id": 1, "name": delivery.SOURCE, "state": "uploaded",
                    "size": delivery.SOURCE_BYTES, "digest": "sha256:" + delivery.SOURCE_SHA256}, *(assets or [])]

            def api(self, path):
                if path == delivery.REPO:
                    return {"owner": {"login": "wrong" if fault == "owner" else delivery.OWNER},
                            "full_name": delivery.FULL_NAME}
                if path.endswith(f"/actions/runs/{delivery.RUN}"):
                    return {"id": delivery.RUN, "status": "completed", "conclusion": "failure" if fault == "run" else "success",
                            "head_sha": delivery.COMMIT, "head_branch": "main", "repository": {"full_name": delivery.FULL_NAME}}
                if path.endswith("/commits/main"):
                    return {"sha": delivery.COMMIT}
                if "/actions/runs/" in path and "/artifacts?" in path:
                    return {"artifacts": [{"name": delivery.ARTIFACT_NAME, "expired": False,
                        "workflow_run": {"id": delivery.RUN}}]}
                if "/releases/tags/" in path:
                    return {"id": 7, "tag_name": delivery.TAG, "draft": False,
                            "assets": [] if fault == "source" else self.assets}
                if "/git/ref/tags/" in path:
                    return {"object": {"type": "commit", "sha": "f" * 40 if fault == "tag" else delivery.COMMIT}}
                if "/releases/assets/" in path:
                    return next(item for item in self.assets if str(item["id"]) == path.rsplit("/", 1)[-1])
                raise AssertionError(path)

            def upload(self, release, path):
                self.uploaded.append(path.name)
                asset = {"id": len(self.assets) + 1, "name": path.name, "state": "uploaded",
                         "size": path.stat().st_size, "digest": "sha256:" + delivery.sha256(path)}
                self.assets.append(asset)
                return asset
        return FakeClient()

    def test_valid_native_files_and_only_three_delivery_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            expected = self.fixture(directory)
            self.assertEqual(delivery.verify_files(directory), expected)
            client = self.client()
            result = delivery.publish(client, directory, expected)
            self.assertEqual(set(client.uploaded), delivery.PREVIEWS | {"checksum.txt"})
            self.assertEqual(len(result), 3)
            self.assertTrue(all(not item["reused"] for item in result))
            for line in (directory / "checksum.txt").read_text().splitlines():
                digest, name = line.split("  ")
                self.assertIn(name, delivery.PREVIEWS)
                self.assertEqual(digest, expected[name]["sha256"])

    def test_metadata_mismatch_blocks_before_upload(self):
        for fault in ("owner", "run", "source", "tag"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as folder:
                directory = Path(folder)
                expected = self.fixture(directory)
                client = self.client(fault=fault)
                with self.assertRaises(delivery.DeliveryError):
                    delivery.publish(client, directory, expected)
                self.assertEqual(client.uploaded, [])

    def test_native_bad_digest_smoke_or_extra_file_is_rejected(self):
        for fault in ("digest", "signature", "extra"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as folder:
                directory = Path(folder)
                self.fixture(directory)
                if fault == "digest":
                    (directory / next(iter(delivery.PREVIEWS))).write_bytes(b"changed")
                elif fault == "signature":
                    path = directory / "smoke-report.json"
                    report = json.loads(path.read_text())
                    report["checks"]["signature_valid_after_run"] = False
                    path.write_text(json.dumps(report))
                else:
                    (directory / "private-runtime.json").write_text("{}")
                with self.assertRaises(delivery.DeliveryError):
                    delivery.verify_files(directory)

    def test_conflicting_asset_is_not_deleted_or_clobbered(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            expected = self.fixture(directory)
            name = next(iter(delivery.PREVIEWS))
            asset = {"id": 2, "name": name, "state": "uploaded", "size": expected[name]["bytes"], "digest": "sha256:" + "f" * 64}
            client = self.client(assets=[asset])
            with self.assertRaises(delivery.DeliveryError):
                delivery.publish(client, directory, expected)
            self.assertEqual(client.uploaded, [])
            self.assertIn(asset, client.assets)

    def test_upload_body_is_a_file_stream_with_explicit_length(self):
        test = self
        class Response(io.BytesIO):
            status = 201
        class Connection:
            def __init__(self, host, timeout):
                test.assertEqual(host, "uploads.github.com")
            def request(self, method, target, body, headers):
                test.assertEqual(method, "POST")
                test.assertFalse(isinstance(body, (bytes, bytearray)))
                test.assertEqual(headers["Content-Length"], "11")
                test.assertEqual(body.read(4), b"stre")
            def getresponse(self):
                return Response(b'{"id":2}')
            def close(self):
                pass
        client = delivery.GitHub("offline-fixture-only")
        with tempfile.TemporaryDirectory() as folder, patch.object(delivery.http.client, "HTTPSConnection", Connection):
            path = Path(folder) / next(iter(delivery.PREVIEWS))
            path.write_bytes(b"stream-test")
            result = client.upload({"id": 7, "upload_url": "https://uploads.github.com" + delivery.REPO + "/releases/7/assets{?name,label}"}, path)
            self.assertEqual(result["id"], 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
