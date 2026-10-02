import gzip
import json
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


module_path = Path(__file__).resolve().parents[1] / "frontpage-metrics-upload.py"
spec = importlib.util.spec_from_file_location("frontpage_metrics_upload", module_path)
upload = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(upload)


class UploadTests(unittest.TestCase):
    def test_uploads_only_bounded_v1_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "latest.json").write_text('{"sample":1}')
            (root / "history.json").write_text('{"samples":[]}')
            requests = []

            class Response:
                status = 204

                def __enter__(self):
                    return self

                def __exit__(self, *_):
                    pass

            def send(request, timeout):
                self.assertEqual(timeout, 20)
                requests.append(request)
                return Response()

            with patch.object(upload, "urlopen", side_effect=send):
                upload.upload(root, "https://example.test/", "test-token")
            self.assertEqual(len(requests), 2)
            self.assertEqual(requests[0].full_url, "https://example.test/__collector/latest.json")
            self.assertEqual(gzip.decompress(requests[0].data), b'{"sample":1}')
            self.assertEqual(requests[0].get_header("Authorization"), "Bearer test-token")


    def test_v2_rejects_partial_publication_and_uploads_only_missing_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for namespace in ("public", "owner"):
                (root / namespace).mkdir()
                for name in ("latest.v2.json", "incidents.v2.json"):
                    (root / namespace / name).write_text(json.dumps({"schema_version": 2, "generated_at": "2026-10-02T13:11:00Z", "collected_at": "2026-10-02T13:11:00Z"}))
            (root / "owner/manifest.v2.json").write_text(json.dumps({"schema_version": 2, "files": ["latest.v2.json", "incidents.v2.json"]}))
            requests = []
            def send(url, secret, action, body, **kwargs):
                requests.append((action, body))
                if action == "prepare":
                    return {"missing": [next(iter(json.loads(body)["files"].values()))]}
            with patch.object(upload.time, "time", return_value=upload.datetime.fromisoformat("2026-10-02T13:11:10+00:00").timestamp()), patch.object(upload, "send_v2", side_effect=send):
                upload.upload_v2(root, "https://example.test", "test-secret")
                self.assertEqual([row[0] for row in requests][::2], ["prepare", "commit"])
                self.assertEqual(len(requests), 3)
                self.assertTrue(gzip.decompress(requests[1][1]))
                (root / "owner/incidents.v2.json").write_text('{"generated_at":"2026-10-02T13:10:45Z"}')
                requests.clear()
                with self.assertRaisesRegex(ValueError, "incomplete"):
                    upload.upload_v2(root, "https://example.test", "test-secret")
                self.assertEqual(requests, [])

    def test_v2_rejects_traversal_symlinks_and_failed_gate_without_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "owner").mkdir()
            (root / "owner/manifest.v2.json").write_text(json.dumps({"schema_version": 2, "files": ["../private.sqlite3"]}))
            with self.assertRaisesRegex(ValueError, "manifest"):
                upload.v2_snapshot(root)
            (root / "owner/latest.v2.json").symlink_to(root / "owner/manifest.v2.json")
            with self.assertRaisesRegex(ValueError, "Symlink"):
                upload.read_projection(root / "owner", "latest.v2.json")
        with patch.object(upload.subprocess, "run", side_effect=upload.subprocess.CalledProcessError(2, "comparator")):
            with self.assertRaises(upload.subprocess.CalledProcessError):
                upload.fresh_acceptance()


if __name__ == "__main__":
    unittest.main()
