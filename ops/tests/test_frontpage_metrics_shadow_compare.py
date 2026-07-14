import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "frontpage-metrics-shadow-compare.py"
SPEC = importlib.util.spec_from_file_location("frontpage_metrics_shadow_compare", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class ShadowComparisonTests(unittest.TestCase):
    def _write_inputs(self, root, v1_samples, v2_samples, service_samples=None):
        v1 = root / "history.json"
        database = root / "metrics.sqlite3"
        v1.write_text(json.dumps({"schema_version": 1, "samples": v1_samples}))
        connection = sqlite3.connect(database)
        connection.executescript("""
            CREATE TABLE host_points(tier TEXT, ts_ms INTEGER, payload_json TEXT);
            CREATE TABLE service_points(tier TEXT, ts_ms INTEGER, service_id TEXT, payload_json TEXT);
        """)
        for timestamp, payload in v2_samples:
            connection.execute(
                "INSERT INTO host_points VALUES('1m',?,?)",
                (timestamp, json.dumps(payload)),
            )
        for timestamp, service_id, payload in service_samples or []:
            connection.execute(
                "INSERT INTO service_points VALUES('1m',?,?,?)",
                (timestamp, service_id, json.dumps(payload)),
            )
        connection.commit()
        connection.close()
        return v1, database

    @staticmethod
    def _v1_sample(timestamp, cpu=10, service_status="up"):
        return {
            "schema_version": 1,
            "collected_at": MODULE._timestamp(timestamp),
            "host": {
                "cpu_percent": cpu,
                "ram_used_bytes": 50,
                "ram_total_bytes": 100,
                "disk_used_bytes": 60,
                "disk_total_bytes": 100,
            },
            "services": [
                {
                    "id": "frontpage-public",
                    "visibility": "public",
                    "status": service_status,
                }
            ],
        }

    @staticmethod
    def _v2_host(cpu=10):
        return {"cpu_percent": cpu, "memory_used_bytes": 50, "disk_used_percent": 60}

    @staticmethod
    def _v2_service(status="up"):
        return {"visibility": "public", "status": status}

    def test_short_or_divergent_runs_do_not_approve(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            v1 = root / "history.json"
            database = root / "metrics.sqlite3"
            samples = []
            for index, cpu in enumerate((10, 20)):
                timestamp = f"2026-07-12T19:0{index}:00Z"
                samples.append({
                    "schema_version": 1,
                    "collected_at": timestamp,
                    "host": {"cpu_percent": cpu, "ram_used_bytes": 50, "ram_total_bytes": 100, "disk_used_bytes": 60, "disk_total_bytes": 100},
                    "services": [{"id": "frontpage-public", "visibility": "public", "status": "up"}],
                })
            v1.write_text(json.dumps({"schema_version": 1, "samples": samples}))
            connection = sqlite3.connect(database)
            connection.executescript("""
                CREATE TABLE host_points(tier TEXT, ts_ms INTEGER, payload_json TEXT);
                CREATE TABLE service_points(tier TEXT, ts_ms INTEGER, service_id TEXT, payload_json TEXT);
            """)
            base = 1_783_882_800_000
            for index, cpu in enumerate((10, 40)):
                timestamp = base + index * 60_000
                connection.execute("INSERT INTO host_points VALUES('1m',?,?)", (timestamp, json.dumps({"cpu_percent": cpu, "memory_used_bytes": 50, "disk_used_percent": 60})))
                connection.execute("INSERT INTO service_points VALUES('1m',?,?,?)", (timestamp, "frontpage-public", json.dumps({"visibility": "public", "status": "up"})))
            connection.commit()
            connection.close()

            result = MODULE.compare(v1, database, evidence_start_ms=base, now_ms=base + 90_000)
            self.assertFalse(result["approved"])
            self.assertEqual(result["paired_minutes"], 2)
            self.assertGreater(result["p99_relative_divergence_percent"]["cpu"], 2)

    def test_p99_uses_the_nearest_rank(self):
        self.assertEqual(MODULE._p99([1] * 98 + [5, 5]), 5)

    def test_incomplete_v2_host_rows_become_explicit_missed_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = 1_783_882_800_000
            timestamps = [base + index * 60_000 for index in range(3)]
            v1, database = self._write_inputs(
                root,
                [self._v1_sample(timestamp) for timestamp in timestamps],
                [
                    (timestamps[0], self._v2_host()),
                    (timestamps[1], {"memory_used_bytes": 50, "disk_used_percent": 60}),
                    (timestamps[2], self._v2_host()),
                ],
                [
                    (timestamp, "frontpage-public", self._v2_service())
                    for timestamp in timestamps
                ],
            )

            result = MODULE.compare(
                v1,
                database,
                evidence_start_ms=base,
                now_ms=timestamps[-1] + 30_000,
            )

            self.assertFalse(result["approved"])
            self.assertEqual(result["paired_minutes"], 2)
            self.assertEqual(result["missed_minutes"], 1)
            self.assertEqual(result["incomplete_v2_host_minutes"], 1)
            self.assertEqual(result["maximum_gap_seconds"], 120)

    def test_incomplete_rows_before_the_epoch_are_not_reused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = 1_783_882_800_000
            timestamps = [base - 60_000, base, base + 60_000]
            v1, database = self._write_inputs(
                root,
                [self._v1_sample(timestamp) for timestamp in timestamps],
                [
                    (timestamps[0], {"memory_used_bytes": 50, "disk_used_percent": 60}),
                    (timestamps[1], self._v2_host()),
                    (timestamps[2], self._v2_host()),
                ],
                [
                    (timestamp, "frontpage-public", self._v2_service())
                    for timestamp in timestamps
                ],
            )

            result = MODULE.compare(
                v1,
                database,
                evidence_start_ms=base,
                now_ms=timestamps[-1] + 30_000,
            )

            self.assertFalse(result["approved"])
            self.assertEqual(result["paired_minutes"], 2)
            self.assertEqual(result["missed_minutes"], 0)
            self.assertEqual(result["incomplete_v2_host_minutes"], 0)
            self.assertEqual(result["total_incomplete_v2_host_minutes_since_epoch"], 0)

    def test_complete_fresh_rolling_48_hour_window_approves(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = 1_783_882_800_000
            timestamps = [base + index * 60_000 for index in range(48 * 60 + 1)]
            v1, database = self._write_inputs(
                root,
                [self._v1_sample(timestamp) for timestamp in timestamps],
                [(timestamp, self._v2_host()) for timestamp in timestamps],
                [
                    (timestamp, "frontpage-public", self._v2_service())
                    for timestamp in timestamps
                ],
            )

            result = MODULE.compare(
                v1,
                database,
                evidence_start_ms=base,
                now_ms=timestamps[-1] + 30_000,
            )

            self.assertTrue(result["approved"])
            self.assertEqual(result["schema_version"], 2)
            self.assertEqual(result["duration_hours"], 48)
            self.assertEqual(result["paired_minutes"], 2881)
            self.assertEqual(result["missed_minutes"], 0)
            self.assertEqual(result["evidence_age_seconds"], 30)

    def test_stale_or_missing_public_service_evidence_cannot_approve(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = 1_783_882_800_000
            timestamps = [base + index * 60_000 for index in range(48 * 60 + 1)]
            v1, database = self._write_inputs(
                root,
                [self._v1_sample(timestamp) for timestamp in timestamps],
                [(timestamp, self._v2_host()) for timestamp in timestamps],
                [
                    (timestamp, "frontpage-public", self._v2_service())
                    for timestamp in timestamps[1:]
                ],
            )

            missing_service = MODULE.compare(
                v1,
                database,
                evidence_start_ms=base,
                now_ms=timestamps[-1] + 30_000,
            )
            stale = MODULE.compare(
                v1,
                database,
                evidence_start_ms=base,
                now_ms=timestamps[-1] + 5 * 60_000,
            )

            self.assertFalse(missing_service["approved"])
            self.assertGreater(missing_service["public_service_mismatch_percent"], 0)
            self.assertFalse(stale["approved"])
            self.assertGreater(stale["evidence_age_seconds"], 120)

    def test_simultaneous_service_inventory_gap_cannot_disappear(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = 1_783_882_800_000
            timestamps = [base + index * 60_000 for index in range(48 * 60 + 1)]
            missing_timestamp = timestamps[len(timestamps) // 2]
            v1_samples = []
            for timestamp in timestamps:
                sample = self._v1_sample(timestamp)
                if timestamp == missing_timestamp:
                    sample["services"] = []
                v1_samples.append(sample)
            v1, database = self._write_inputs(
                root,
                v1_samples,
                [(timestamp, self._v2_host()) for timestamp in timestamps],
                [
                    (timestamp, "frontpage-public", self._v2_service())
                    for timestamp in timestamps
                    if timestamp != missing_timestamp
                ],
            )

            result = MODULE.compare(
                v1,
                database,
                evidence_start_ms=base,
                now_ms=timestamps[-1] + 30_000,
            )

            self.assertFalse(result["approved"])
            self.assertEqual(result["public_service_comparisons"], len(timestamps))
            self.assertGreater(result["public_service_mismatch_percent"], 0)

    def test_evidence_epoch_is_strict_and_rounds_up_to_a_complete_minute(self):
        with tempfile.TemporaryDirectory() as temporary:
            epoch = Path(temporary) / "epoch.json"
            self.assertEqual(MODULE.EVIDENCE_EPOCH_REASONS, {
                "collector_or_comparator_change",
                "evidence_marker_missing",
                "explicit_operator_reset",
            })
            for reason in MODULE.EVIDENCE_EPOCH_REASONS:
                with self.subTest(reason=reason):
                    epoch.write_text(json.dumps({
                        "schema_version": 1,
                        "started_at": "2026-07-13T22:24:31Z",
                        "commit_sha": "a" * 40,
                        "reason": reason,
                    }))

                    payload, timestamp = MODULE._load_evidence_epoch(epoch)

                    self.assertEqual(payload["reason"], reason)
                    self.assertEqual(
                        MODULE._timestamp(MODULE._next_minute(timestamp)),
                        "2026-07-13T22:25:00Z",
                    )

            epoch.write_text(json.dumps({
                "schema_version": 1,
                "started_at": "2026-07-13T22:24:31Z",
                "commit_sha": "a" * 40,
                "reason": "manual",
            }))
            with self.assertRaisesRegex(ValueError, "reason"):
                MODULE._load_evidence_epoch(epoch)

    def test_cli_writes_unapproved_artifact_for_incomplete_production_row(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = 1_783_882_800_000
            v1, database = self._write_inputs(
                root,
                [self._v1_sample(base)],
                [(base, {"memory_used_bytes": 50, "disk_used_percent": 60})],
                [(base, "frontpage-public", self._v2_service())],
            )
            epoch = root / "epoch.json"
            output = root / "gate.json"
            epoch.write_text(json.dumps({
                "schema_version": 1,
                "started_at": MODULE._timestamp(base),
                "commit_sha": "b" * 40,
                "reason": "collector_or_comparator_change",
            }))

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--v1-history",
                    str(v1),
                    "--v2-database",
                    str(database),
                    "--evidence-epoch",
                    str(epoch),
                    "--output",
                    str(output),
                ],
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(completed.returncode, 2, completed.stderr)
            artifact = json.loads(output.read_text())
            self.assertFalse(artifact["approved"])
            self.assertEqual(artifact["schema_version"], 2)
            self.assertEqual(artifact["incomplete_v2_host_minutes"], 1)
            self.assertEqual(artifact["evidence_epoch"]["commit_sha"], "b" * 40)


if __name__ == "__main__":
    unittest.main()
