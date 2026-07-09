import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "frontpage-metrics-collector.py"
SPEC = importlib.util.spec_from_file_location("frontpage_metrics_collector", MODULE_PATH)
collector = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(collector)


class CollectorTests(unittest.TestCase):
    def test_clamp_timeout_ms(self):
        self.assertEqual(collector.clamp_timeout_ms(50), 1000)
        self.assertEqual(collector.clamp_timeout_ms(5000), 5000)
        self.assertEqual(collector.clamp_timeout_ms(50000), 10000)

    def test_load_config_rejects_secret_url(self):
        urls = [
            "https://user:pass@example.com/health",
            "https://example.com/health?token=secret",
            "https://example.com/health#token",
            "https://example.com/health;token=secret",
        ]
        for url in urls:
            with self.subTest(url=url), tempfile.TemporaryDirectory() as tmp:
                config_path = Path(tmp) / "config.json"
                config_path.write_text(
                    json.dumps(
                        {
                            "schema_version": 1,
                            "services": [
                                {
                                    "id": "bad",
                                    "label": "Bad",
                                    "visibility": "public",
                                    "url": url,
                                    "expected_status": 200,
                                    "timeout_ms": 5000,
                                }
                            ],
                            "containers": [],
                        }
                    )
                )

                with self.assertRaises(ValueError):
                    collector.load_config(config_path)

    def test_service_result_sanitizes_errors(self):
        result = collector.service_result(
            {
                "id": "frontpage-public",
                "label": "Frontpage",
                "visibility": "public",
                "url": "https://example.invalid/health",
                "expected_status": 200,
                "timeout_ms": 1000,
            },
            opener=lambda *_args, **_kwargs: (_ for _ in ()).throw(
                RuntimeError("secret path /root/x")
            ),
            now=lambda: "2026-07-09T02:00:00Z",
        )

        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["latency_ms"], None)
        self.assertNotIn("secret", json.dumps(result))

    def test_container_status_from_inspect(self):
        self.assertEqual(
            collector.container_status_from_inspect(
                {"State": {"Running": True, "Health": {"Status": "healthy"}}}
            ),
            "up",
        )
        self.assertEqual(
            collector.container_status_from_inspect({"State": {"Running": False}}),
            "down",
        )
        self.assertEqual(collector.container_status_from_inspect({}), "unknown")

    def test_prune_history_keeps_latest_1440(self):
        samples = [
            {"schema_version": 1, "collected_at": f"2026-07-09T00:{i % 60:02d}:00Z"}
            for i in range(1500)
        ]
        pruned = collector.prune_history(samples)
        self.assertEqual(len(pruned), 1440)
        self.assertEqual(pruned[0]["collected_at"], samples[-1440]["collected_at"])

    def test_atomic_write_json_writes_complete_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "latest.json"
            collector.atomic_write_json(target, {"schema_version": 1})
            self.assertEqual(json.loads(target.read_text()), {"schema_version": 1})
            self.assertFalse((Path(tmp) / "latest.json.tmp").exists())


if __name__ == "__main__":
    unittest.main()
