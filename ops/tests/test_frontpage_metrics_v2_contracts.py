import json
import unittest
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "observability-v2"
MAX_POINTS_BY_RANGE = {"1h": 240, "24h": 1440, "7d": 10080, "30d": 2880}

FORBIDDEN_PUBLIC_KEYS = {
    "workloads",
    "processes",
    "diagnostics",
    "cgroup_path",
    "systemd_unit",
    "container_id",
    "cpu_percent",
    "rss_bytes",
}


def collect_keys(value):
    keys = set()
    if isinstance(value, dict):
        keys.update(value)
        for nested in value.values():
            keys.update(collect_keys(nested))
    elif isinstance(value, list):
        for nested in value:
            keys.update(collect_keys(nested))
    return keys


class ObservabilityV2ContractTests(unittest.TestCase):
    def test_public_fixture_contains_no_owner_keys(self):
        payload = json.loads((FIXTURES / "public-latest.json").read_text())
        serialized_keys = collect_keys(payload)
        self.assertEqual(
            {
                "schema_version",
                "generated_at",
                "collected_at",
                "freshness",
                "overall_state",
                "resources",
                "services",
            },
            set(payload),
        )
        self.assertTrue(FORBIDDEN_PUBLIC_KEYS.isdisjoint(serialized_keys))

    def test_owner_fixture_exposes_bounded_workload_and_process_counts(self):
        payload = json.loads((FIXTURES / "owner-latest.json").read_text())
        self.assertEqual(
            {
                "schema_version",
                "generated_at",
                "collected_at",
                "freshness",
                "host",
                "workloads",
                "diagnostics",
                "incidents",
            },
            set(payload),
        )
        self.assertLessEqual(len(payload["workloads"]), 32)
        for workload in payload["workloads"]:
            self.assertLessEqual(len(workload["processes"]), 20)

    def test_series_fixture_respects_range_caps_and_missing_points(self):
        payload = json.loads((FIXTURES / "host-series-1h.json").read_text())
        timestamps = payload["timestamps"]
        self.assertLessEqual(len(timestamps), MAX_POINTS_BY_RANGE[payload["range"]])
        self.assertIn(None, payload["series"][0]["values"])
        for series in payload["series"]:
            self.assertEqual(len(series["values"]), len(timestamps))

    def test_public_incident_fixture_contains_no_owner_evidence(self):
        payload = json.loads((FIXTURES / "incidents.json").read_text())
        self.assertEqual({"schema_version", "generated_at", "incidents"}, set(payload))
        incident = payload["incidents"][0]
        self.assertEqual("public", incident["visibility"])
        self.assertNotIn("workload_id", incident)
        self.assertNotIn("evidence", incident)

    def test_fixture_ids_match_the_contract(self):
        fixture_names = [
            "public-latest.json",
            "owner-latest.json",
            "host-series-1h.json",
            "incidents.json",
        ]

        for fixture_name in fixture_names:
            payload = json.loads((FIXTURES / fixture_name).read_text())
            with self.subTest(fixture=fixture_name):
                for key in collect_ids(payload):
                    self.assertRegex(key, r"^[a-z0-9][a-z0-9-]{0,62}$")


def collect_ids(value):
    ids = []
    if isinstance(value, dict):
        for key, nested in value.items():
            if key == "id" and isinstance(nested, str):
                ids.append(nested)
            ids.extend(collect_ids(nested))
    elif isinstance(value, list):
        for nested in value:
            ids.extend(collect_ids(nested))
    return ids


if __name__ == "__main__":
    unittest.main()
