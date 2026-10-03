import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
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

    def _start_process_writer(self, path):
        code = r"""
import sys
from pathlib import Path
from ops.frontpage_metrics_v2.store import MetricsStore
store = MetricsStore.open(Path(sys.argv[1]))
store.write_cycle({
    "ts_ms": 2000000000000,
    "host": {"cpu_percent": 25.0},
    "host_coverage_percent": 100.0,
    "workloads": [],
    "services": [],
    "capabilities": [{"key": "psi", "state": "available", "detail": "available"}],
})
print("READY", flush=True)
sys.stdin.readline()
store.close()
"""
        process = subprocess.Popen(
            [sys.executable, "-c", code, str(path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            close_fds=True,
        )
        self.assertEqual(process.stdout.readline().strip(), "READY")
        return process

    def _assert_separate_writer_rejected(self, path):
        code = "from pathlib import Path; import sys; from ops.frontpage_metrics_v2.store import MetricsStore; MetricsStore.open(Path(sys.argv[1]))"
        result = subprocess.run(
            [sys.executable, "-c", code, str(path)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("active writer", result.stderr)

    @staticmethod
    def _close_process_pipes(process):
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                stream.close()

    def test_separate_process_writer_excludes_symlink_alias_and_releases_on_clean_exit(self):
        self.store.close()
        alias = self.path.parent / "metrics-alias.sqlite3"
        alias.symlink_to(self.path)
        process = self._start_process_writer(self.path)
        try:
            self._assert_separate_writer_rejected(alias)
        finally:
            process.stdin.write("close\n")
            process.stdin.flush()
            self.assertEqual(process.wait(timeout=5), 0, process.stderr.read())
            self._close_process_pipes(process)

        replacement = MetricsStore.open(alias)
        self.assertEqual(replacement.count("host_points", "15s"), 1)
        replacement.close()

    def test_sigkill_releases_process_lock_without_removing_database_history(self):
        self.store.close()
        process = self._start_process_writer(self.path)
        process.kill()
        process.wait(timeout=5)
        self._close_process_pipes(process)

        replacement = MetricsStore.open(self.path)
        try:
            self.assertEqual(replacement.count("host_points", "15s"), 1)
            self.assertTrue(self.path.with_name(self.path.name + ".writer.lock").exists())
        finally:
            replacement.close()

    def test_readonly_snapshot_and_sqlite_backup_work_while_another_process_writes(self):
        self.store.close()
        process = self._start_process_writer(self.path)
        destination_path = self.path.parent / "backup.sqlite3"
        try:
            self.assertEqual(len(self.store.read_projection_snapshot()["host"]), 1)
            reader = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)
            destination = sqlite3.connect(destination_path)
            try:
                reader.backup(destination)
                self.assertEqual(destination.execute("SELECT count(*) FROM host_points").fetchone()[0], 1)
                self.assertEqual(destination.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            finally:
                reader.close()
                destination.close()
        finally:
            process.stdin.write("close\n")
            process.stdin.flush()
            self.assertEqual(process.wait(timeout=5), 0, process.stderr.read())
            self._close_process_pipes(process)

    def test_failed_initialization_releases_process_and_thread_locks(self):
        failed_path = self.path.parent / "failed.sqlite3"
        with mock.patch("ops.frontpage_metrics_v2.store.migrate", side_effect=RuntimeError("synthetic failure")):
            with self.assertRaisesRegex(RuntimeError, "synthetic failure"):
                MetricsStore.open(failed_path)
        replacement = MetricsStore.open(failed_path)
        replacement.close()

    def test_lock_descriptor_is_not_inheritable_and_lock_file_is_stable(self):
        lock_path = self.path.with_name(self.path.name + ".writer.lock")
        descriptor = self.store._lock_fd
        self.assertFalse(os.get_inheritable(descriptor))
        first_inode = lock_path.stat().st_ino
        self.store.close()
        self.assertTrue(lock_path.exists())
        replacement = MetricsStore.open(self.path)
        try:
            self.assertEqual(lock_path.stat().st_ino, first_inode)
        finally:
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

    def test_raw_retention_caps_extra_preflight_timestamps(self):
        timestamps = [NOW - index * 5_000 for index in range(446)]
        self.store.executemany(
            "INSERT INTO host_points(tier,ts_ms,payload_json,coverage_percent) VALUES('15s',?,?,?)",
            ((timestamp, json.dumps({"cpu_percent": 10}), 100.0) for timestamp in timestamps),
        )
        self.store.executemany(
            "INSERT INTO workload_points(tier,ts_ms,workload_id,payload_json,coverage_percent) VALUES('15s',?,?,?,?)",
            (
                (timestamp, workload_id, json.dumps({"cpu_percent": 5}), 100.0)
                for timestamp in timestamps
                for workload_id in ("frontpage-app", "frontpage-observer")
            ),
        )
        self.store.executemany(
            "INSERT INTO service_points(tier,ts_ms,service_id,payload_json) VALUES('15s',?,?,?)",
            (
                (timestamp, service_id, json.dumps({"status": "up"}))
                for timestamp in timestamps
                for service_id in ("frontpage-public", "tcwiki-public")
            ),
        )

        self.store.prune(NOW)

        for table in ("host_points", "workload_points", "service_points"):
            distinct_timestamps = self.store.scalar(
                f"SELECT count(DISTINCT ts_ms) FROM {table} WHERE tier='15s'"
            )
            self.assertEqual(distinct_timestamps, 240)
        self.assertEqual(self.store.count("host_points", "15s"), 240)
        self.assertEqual(self.store.count("workload_points", "15s"), 480)
        self.assertEqual(self.store.count("service_points", "15s"), 480)
        self.assertEqual(
            self.store.scalar("SELECT min(ts_ms) FROM host_points WHERE tier='15s'"),
            timestamps[239],
        )

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

    def test_projection_reads_current_services_without_deleting_history(self):
        self.store.write_cycle(cycle(NOW - 15_000))
        current = cycle()
        current["services"][0]["status"] = "down"
        self.store.write_cycle(current)
        self.store.executemany(
            "INSERT INTO service_points(tier,ts_ms,service_id,payload_json) VALUES(?,?,?,?)",
            [("1m", NOW, "frontpage-public", '{"status":"up"}')],
        )
        services = self.store.read_projection_snapshot()["services"]
        self.assertEqual(len(services), 1)
        self.assertEqual(services[0]["ts_ms"], NOW)
        self.assertEqual(services[0]["payload"]["status"], "down")
        self.assertEqual(self.store.count("service_points"), 3)
        missing = cycle(NOW + 15_000)
        missing["services"] = []
        self.store.write_cycle(missing)
        self.assertEqual(self.store.read_projection_snapshot()["services"], [])

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

    def test_commit_cycle_rolls_back_raw_rows_when_evaluation_fails(self):
        def fail(_cycle):
            raise RuntimeError("evaluation failed")

        with self.assertRaisesRegex(RuntimeError, "evaluation failed"):
            self.store.commit_cycle(cycle(), fail, NOW)
        self.assertEqual(self.store.count("host_points", "15s"), 0)

    def test_commit_cycle_populates_minute_and_quarter_hour_rollups(self):
        transitions = SimpleNamespace(opened=(), updated=(), recovered=())
        base = NOW // 60_000 * 60_000
        for index, cpu in enumerate((10.0, 20.0, 30.0, 40.0)):
            sample = cycle(base + index * 15_000)
            sample["host"]["cpu_percent"] = cpu
            self.store.commit_cycle(sample, lambda _cycle: transitions, sample["ts_ms"])

        self.assertEqual(self.store.count("host_points", "1m"), 1)
        self.assertEqual(self.store.count("host_points", "15m"), 1)
        minute_payload = json.loads(
            self.store.scalar("SELECT payload_json FROM host_points WHERE tier='1m'")
        )
        self.assertEqual(minute_payload["cpu_percent"], 25.0)
        self.assertEqual(
            self.store.scalar("SELECT coverage_percent FROM host_points WHERE tier='1m'"),
            100.0,
        )

    def test_complete_minute_requires_four_valid_aligned_cpu_intervals(self):
        transitions = SimpleNamespace(opened=(), updated=(), recovered=())
        base = NOW // 60_000 * 60_000
        for minute, failure in enumerate((None, "missing-cpu", "duplicate-slot", "late-slot")):
            for index in range(4):
                timestamp = base + minute * 60_000 + index * 15_000
                if failure == "duplicate-slot" and index == 1:
                    timestamp -= 14_000
                if failure == "late-slot" and index == 1:
                    timestamp += 1000
                sample = cycle(timestamp)
                sample["host"].update(memory_used_bytes=50, disk_used_percent=60)
                if failure == "missing-cpu" and index == 0:
                    sample["host"]["cpu_percent"] = None
                self.store.commit_cycle(sample, lambda _cycle: transitions, timestamp)
            payload = json.loads(self.store.scalar("SELECT payload_json FROM host_points WHERE tier='1m' AND ts_ms=?", (base + minute * 60_000,)))
            self.assertEqual(payload["comparison_complete"], failure is None)
            if failure == "missing-cpu":
                self.assertEqual(payload["cpu_percent"], 25)  # A plausible mean cannot hide the gap.


if __name__ == "__main__":
    unittest.main()
