import http.server
import importlib.util
import json
import os
import stat
import tempfile
import threading
import unittest
from unittest import mock
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

    def test_service_result_uses_explicit_status_user_agent(self):
        captured = {}

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        def opener(request, **_kwargs):
            captured["user_agent"] = request.get_header("User-agent")
            return Response()

        result = collector.service_result(
            {
                "id": "public-app",
                "label": "Public app",
                "visibility": "public",
                "url": "https://example.com/",
                "expected_status": 200,
                "timeout_ms": 1000,
            },
            opener=opener,
            now=lambda: "2026-07-09T02:00:00Z",
        )

        self.assertEqual(result["status"], "up")
        self.assertEqual(captured["user_agent"], "reidar-tech-status/1.0")

    def test_status_check_can_require_a_bounded_health_marker(self):
        read_sizes = []

        class Response:
            status = 200

            def __init__(self, body):
                self.body = body

            def read(self, size):
                read_sizes.append(size)
                return self.body[:size]

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        service = {
            "id": "frontpage-public",
            "label": "Frontpage",
            "visibility": "public",
            "url": "https://example.com/api/health",
            "expected_status": 200,
            "timeout_ms": 1000,
            "check": {
                "type": "json-field",
                "path": ["status"],
                "expected": "healthy",
            },
        }

        healthy = collector.service_result(
            service,
            opener=lambda *_args, **_kwargs: Response(b'{"status":"healthy"}'),
            now=lambda: "2026-07-09T02:00:00Z",
        )
        wrong_marker = collector.service_result(
            service,
            opener=lambda *_args, **_kwargs: Response(b'{"status":"degraded"}'),
            now=lambda: "2026-07-09T02:00:00Z",
        )

        self.assertEqual(healthy["status"], "up")
        self.assertEqual(wrong_marker["status"], "down")
        self.assertEqual(read_sizes, [64 * 1024, 64 * 1024])

    def test_status_check_supports_a_nested_json_field_path(self):
        class Response:
            status = 200

            def read(self, _size):
                return b'{"meta":{"service":{"status":"healthy"}}}'

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        result = collector.service_result(
            {
                "id": "frontpage-public",
                "label": "Frontpage",
                "visibility": "public",
                "url": "https://example.com/api/health",
                "expected_status": 200,
                "timeout_ms": 1000,
                "check": {
                    "type": "json-field",
                    "path": ["meta", "service", "status"],
                    "expected": "healthy",
                },
            },
            opener=lambda *_args, **_kwargs: Response(),
            now=lambda: "2026-07-09T02:00:00Z",
        )

        self.assertEqual(result["status"], "up")

    def test_check_failure_redacts_response_body_and_target_details(self):
        class Response:
            status = 200

            def read(self, _size):
                return b'{"status":"secret body from https://internal.example/diagnostics"}'

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        result = collector.service_result(
            {
                "id": "frontpage-public",
                "label": "Frontpage",
                "visibility": "public",
                "url": "https://internal.example/api/health",
                "expected_status": 200,
                "timeout_ms": 1000,
                "check": {
                    "type": "json-field",
                    "path": ["status"],
                    "expected": "healthy",
                },
            },
            opener=lambda *_args, **_kwargs: Response(),
            now=lambda: "2026-07-09T02:00:00Z",
        )

        self.assertEqual(result["status"], "down")
        self.assertEqual(
            set(result),
            {"id", "label", "visibility", "status", "checked_at", "latency_ms"},
        )
        serialized = json.dumps(result)
        self.assertNotIn("secret body", serialized)
        self.assertNotIn("internal.example", serialized)
        self.assertNotIn("diagnostics", serialized)

    def test_default_status_check_remains_backward_compatible(self):
        config = collector.load_config(
            Path(__file__).resolve().parents[1] / "frontpage-metrics.config.json"
        )
        external_services = [
            service for service in config["services"] if service["id"] != "frontpage-public" and service["id"] != "frontpage-internal"
        ]

        self.assertTrue(external_services)
        self.assertTrue(all("check" not in service for service in external_services))

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        result = collector.service_result(
            external_services[0],
            opener=lambda *_args, **_kwargs: Response(),
            now=lambda: "2026-07-09T02:00:00Z",
        )

        self.assertEqual(result["status"], "up")

    def test_checked_in_config_declares_tcwiki_public_service(self):
        config = collector.load_config(
            Path(__file__).resolve().parents[1] / "frontpage-metrics.config.json"
        )
        service = next(
            service for service in config["services"] if service["id"] == "tcwiki-public"
        )

        self.assertEqual(service["label"], "THORChain Wiki")
        self.assertEqual(service["project_slug"], "thorchain-wiki")
        self.assertEqual(service["visibility"], "public")
        self.assertEqual(service["url"], "https://wiki.thorchain.no/")
        self.assertEqual(service["expected_status"], 200)

    def test_load_config_rejects_malformed_service_check(self):
        invalid_checks = [
            None,
            "json-field",
            {"type": "unsupported"},
            {"type": "http-status", "path": ["status"]},
            {"type": "json-field", "path": [], "expected": "healthy"},
            {"type": "json-field", "path": ["status", "nested", "too", "deep"], "expected": "healthy"},
            {"type": "json-field", "path": ["not.a.field"], "expected": "healthy"},
            {"type": "json-field", "path": ["status"], "expected": 200},
            {"type": "json-field", "path": ["status"], "expected": "x" * 81},
        ]
        for check in invalid_checks:
            with self.subTest(check=check), tempfile.TemporaryDirectory() as tmp:
                config_path = Path(tmp) / "config.json"
                config_path.write_text(
                    json.dumps(
                        {
                            "schema_version": 1,
                            "services": [
                                {
                                    "id": "frontpage",
                                    "label": "Frontpage",
                                    "visibility": "public",
                                    "url": "http://127.0.0.1:3002/api/health",
                                    "check": check,
                                }
                            ],
                            "containers": [],
                        }
                    )
                )

                with self.assertRaises(ValueError):
                    collector.load_config(config_path)

    def test_service_result_does_not_follow_redirects(self):
        target_hits = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/start":
                    self.send_response(302)
                    self.send_header("Location", "/target")
                    self.end_headers()
                    return
                target_hits.append(self.path)
                self.send_response(200)
                self.end_headers()

            def log_message(self, *_args):
                return

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 1)
        self.addCleanup(server.shutdown)

        result = collector.service_result(
            {
                "id": "redirecting",
                "label": "Redirecting",
                "visibility": "public",
                "url": f"http://127.0.0.1:{server.server_port}/start",
                "expected_status": 200,
                "timeout_ms": 1000,
            },
        )

        self.assertEqual(result["status"], "down")
        self.assertEqual(target_hits, [])

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

    def test_comparison_history_keeps_72_hours_without_widening_app_history(self):
        samples = [{"sample": index} for index in range(5000)]
        comparison = collector.prune_comparison_history(samples)
        self.assertEqual(len(comparison), 4320)
        self.assertEqual(comparison[0], samples[-4320])
        self.assertEqual(len(collector.prune_history(samples)), 1440)

    def test_atomic_write_json_writes_complete_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "latest.json"
            collector.atomic_write_json(target, {"schema_version": 1})
            self.assertEqual(json.loads(target.read_text()), {"schema_version": 1})
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)
            self.assertEqual(list(Path(tmp).glob(".latest.json.*.tmp")), [])

    def test_atomic_write_json_cleans_up_after_replace_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "latest.json"
            with mock.patch.object(os, "replace", side_effect=OSError("replace failed")):
                with self.assertRaises(OSError):
                    collector.atomic_write_json(target, {"schema_version": 1})

            self.assertFalse(target.exists())
            self.assertEqual(list(Path(tmp).glob(".latest.json.*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
