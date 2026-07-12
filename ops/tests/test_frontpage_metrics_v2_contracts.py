import json
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "observability-v2"
INCIDENTS_SCHEMA = (
    REPO_ROOT
    / "docs"
    / "superpowers"
    / "specs"
    / "2026-07-12-frontpage-observability-incidents.schema.v2.json"
)
MAX_POINTS_BY_RANGE = {"1h": 240, "24h": 1440, "7d": 10080, "30d": 2880}
MAX_OWNER_LATEST_WORKLOADS = 32
MAX_OWNER_API_RANKED_WORKLOAD_SERIES = 16
MAX_OWNER_API_UNTRACKED_SERIES = 1
MAX_OWNER_API_WORKLOAD_SERIES = (
    MAX_OWNER_API_RANKED_WORKLOAD_SERIES + MAX_OWNER_API_UNTRACKED_SERIES
)

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
        self.assertLessEqual(len(payload["workloads"]), MAX_OWNER_LATEST_WORKLOADS)
        for workload in payload["workloads"]:
            self.assertLessEqual(len(workload["processes"]), 20)

    def test_owner_processes_use_workload_id_and_match_their_workload(self):
        payload = json.loads((FIXTURES / "owner-latest.json").read_text())
        for workload in payload["workloads"]:
            for process in workload["processes"]:
                self.assertNotIn("id", process)
                self.assertIn("workload_id", process)
                self.assertEqual(workload["id"], process["workload_id"])

    def test_owner_fixture_omits_workload_network_rows_when_host_view_is_unavailable(
        self,
    ):
        payload = json.loads((FIXTURES / "owner-latest.json").read_text())
        network_total = next(
            total for total in payload["host"]["totals"] if total["resource"] == "network"
        )
        self.assertEqual("unavailable", network_total["workload_view"])
        for workload in payload["workloads"]:
            self.assertNotIn(
                "network",
                {resource["resource"] for resource in workload["resources"]},
            )

    def test_series_fixture_respects_range_caps_and_missing_points(self):
        payload = json.loads((FIXTURES / "host-series-1h.json").read_text())
        timestamps = payload["timestamps"]
        self.assertLessEqual(len(timestamps), MAX_POINTS_BY_RANGE[payload["range"]])
        self.assertLessEqual(len(payload["series"]), MAX_OWNER_API_WORKLOAD_SERIES)
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

    def test_incident_schema_blocks_public_owner_fields(self):
        schema = json.loads(INCIDENTS_SCHEMA.read_text())
        incident_schema = schema["$defs"]["incident"]
        public_guard = find_public_incident_guard(incident_schema)

        self.assertIsNotNone(public_guard)
        self.assertEqual(
            "public",
            public_guard["if"]["properties"]["visibility"]["const"],
        )
        self.assertEqual(
            [{"required": ["workload_id"]}, {"required": ["evidence"]}],
            public_guard["then"]["not"]["anyOf"],
        )

        forbidden_incident = json.loads((FIXTURES / "incidents.json").read_text())[
            "incidents"
        ][0]
        forbidden_incident["workload_id"] = "frontpage-app"
        forbidden_incident["evidence"] = {
            "trigger_value": 1,
            "threshold_value": 1,
            "peak_value": 1,
            "points": [
                {
                    "recorded_at": forbidden_incident["updated_at"],
                    "value": 1,
                }
            ],
        }

        self.assertFalse(
            public_incident_allowed_by_schema_guard(public_guard, forbidden_incident)
        )


def collect_ids(value):
    ids = []
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in {"id", "workload_id"} and isinstance(nested, str):
                ids.append(nested)
            ids.extend(collect_ids(nested))
    elif isinstance(value, list):
        for nested in value:
            ids.extend(collect_ids(nested))
    return ids


def find_public_incident_guard(incident_schema):
    for clause in incident_schema.get("allOf", []):
        visibility = (
            clause.get("if", {})
            .get("properties", {})
            .get("visibility", {})
            .get("const")
        )
        if visibility == "public":
            return clause
    return None


def public_incident_allowed_by_schema_guard(public_guard, incident):
    visibility = (
        public_guard.get("if", {})
        .get("properties", {})
        .get("visibility", {})
        .get("const")
    )
    if incident.get("visibility") != visibility:
        return True

    forbidden_shapes = public_guard["then"]["not"]["anyOf"]
    matches_forbidden_shape = any(
        all(key in incident for key in shape.get("required", []))
        for shape in forbidden_shapes
    )
    return not matches_forbidden_shape


if __name__ == "__main__":
    unittest.main()
