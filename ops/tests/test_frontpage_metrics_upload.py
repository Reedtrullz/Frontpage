import gzip
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


if __name__ == "__main__":
    unittest.main()
