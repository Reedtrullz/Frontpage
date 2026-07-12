import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ops.frontpage_metrics_v2.store import MetricsStore


NOW = 2_000_000_000_000


def cycle(timestamp=NOW):
    return {
        "ts_ms": timestamp,
        "host": {"cpu_percent": 25.0},
        "host_coverage_percent": 100.0,
        "workloads": [
            {"workload_id": "frontpage-app", "coverage_percent": 100.0, "cpu_percent": 10.0}
        ],
        "services": [{"service_id": "frontpage-public", "status": "up"}],
        "capabilities": [
            {"key": "psi", "state": "available", "detail": "available"}
        ],
    }


class MetricsStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "metrics.sqlite3"
        self.store = MetricsStore.open(self.path)
        self.addCleanup(self.store.close)

    def test_database_uses_wal_foreign_keys_and_full_sync(self):
        self.assertEqual(self.store.scalar("PRAGMA journal_mode"), "wal")
        self.assertEqual(self.store.scalar("PRAGMA foreign_keys"), 1)
        self.assertEqual(self.store.scalar("PRAGMA synchronous"), 2)
        self.assertEqual(self.store.scalar("PRAGMA wal_autocheckpoint"), 1000)
        self.assertEqual(self.store.scalar("PRAGMA busy_timeout"), 5000)

    def test_migration_is_idempotent_and_schema_versioned(self):
        self.assertEqual(self.store.scalar("SELECT version FROM schema_meta"), 1)
        self.store.close()
        self.store = MetricsStore.open(self.path)
        self.assertEqual(self.store.scalar("SELECT count(*) FROM schema_meta"), 1)

    def test_only_one_writer_can_own_a_database_path(self):
        with self.assertRaisesRegex(RuntimeError, "writer"):
            MetricsStore.open(self.path)
        self.store.close()
        replacement = MetricsStore.open(self.path)
        replacement.close()

    def test_write_cycle_is_atomic_and_validates_payloads(self):
        self.store.write_cycle(cycle())
        self.assertEqual(self.store.count("host_points", "15s"), 1)
        self.assertEqual(self.store.count("workload_points", "15s"), 1)
        self.assertEqual(self.store.count("service_points", "15s"), 1)

        invalid = cycle(NOW + 15_000)
        invalid["services"][0]["bad"] = {"not-json"}
        with self.assertRaisesRegex(ValueError, "JSON"):
            self.store.write_cycle(invalid)
        self.assertEqual(self.store.count("host_points", "15s"), 1)

    def test_exact_tier_retention_boundaries(self):
        rows = []
        for tier, cadence, count in (("15s", 15_000, 241), ("1m", 60_000, 10081), ("15m", 900_000, 2881)):
            rows.extend(
                (tier, NOW - index * cadence, json.dumps({"value": index}), 100.0)
                for index in range(count)
            )
        self.store.executemany(
            "INSERT INTO host_points(tier, ts_ms, payload_json, coverage_percent) VALUES(?,?,?,?)",
            rows,
        )
        self.store.prune(NOW)
        self.assertEqual(self.store.count("host_points", "15s"), 240)
        self.assertEqual(self.store.count("host_points", "1m"), 10080)
        self.assertEqual(self.store.count("host_points", "15m"), 2880)

    def test_incident_evidence_is_bounded_and_retained_for_90_days(self):
        oversized = "x" * (256 * 1024 + 1)
        with self.assertRaisesRegex(ValueError, "256 KiB"):
            self.store.upsert_incident(
                {"id": "large", "state": "active", "opened_at_ms": NOW, "visibility": "owner", "summary": {}, "evidence": oversized}
            )
        self.store.upsert_incident(
            {"id": "old", "state": "recovered", "opened_at_ms": NOW - 100, "recovered_at_ms": NOW - 90 * 86400_000, "visibility": "public", "summary": {}, "evidence": {}}
        )
        self.store.prune(NOW)
        self.assertEqual(self.store.scalar("SELECT count(*) FROM incidents"), 0)

    def test_projection_snapshot_uses_a_post_commit_read_connection(self):
        self.store.write_cycle(cycle())
        self.store.upsert_incident(
            {"id": "active", "state": "active", "opened_at_ms": NOW, "visibility": "owner", "summary": {"title": "CPU"}, "evidence": {"points": []}}
        )
        snapshot = self.store.read_projection_snapshot()
        self.assertEqual(snapshot["host"][0]["payload"]["cpu_percent"], 25.0)
        self.assertEqual(snapshot["workloads"][0]["workload_id"], "frontpage-app")
        self.assertNotIn("summary_json", snapshot["incidents"][0])
        self.assertNotIn("evidence_json", snapshot["incidents"][0])

    def test_incident_json_strings_must_decode_to_objects(self):
        with self.assertRaisesRegex(ValueError, "JSON object"):
            self.store.upsert_incident(
                {"id": "bad", "state": "active", "opened_at_ms": NOW, "visibility": "owner", "summary": {}, "evidence": "[]"}
            )

    def test_integrity_failure_is_not_suppressed(self):
        with mock.patch.object(self.store, "_run_integrity_check", return_value="corrupt"):
            with self.assertRaisesRegex(RuntimeError, "corrupt"):
                self.store.integrity_check()

    def test_slow_write_requests_one_skipped_cycle(self):
        self.store.close()
        ticks = iter((0.0, 6.1))
        self.store = MetricsStore.open(self.path, clock=lambda: next(ticks))
        status = self.store.write_cycle(cycle())
        self.assertTrue(status.skip_next_cycle)
        self.assertEqual(status.duration_seconds, 6.1)


if __name__ == "__main__":
    unittest.main()
