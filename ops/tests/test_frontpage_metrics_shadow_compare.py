import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "frontpage-metrics-shadow-compare.py"
SPEC = importlib.util.spec_from_file_location("frontpage_metrics_shadow_compare", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class ShadowComparisonTests(unittest.TestCase):
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

            result = MODULE.compare(v1, database)
            self.assertFalse(result["approved"])
            self.assertEqual(result["paired_minutes"], 2)
            self.assertGreater(result["p99_relative_divergence_percent"]["cpu"], 2)

    def test_p99_uses_the_nearest_rank(self):
        self.assertEqual(MODULE._p99([1] * 98 + [5, 5]), 5)


if __name__ == "__main__":
    unittest.main()
