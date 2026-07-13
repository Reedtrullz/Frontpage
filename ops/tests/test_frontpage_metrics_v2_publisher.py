import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ops.frontpage_metrics_v2.publisher import ProjectionPublisher
from ops.frontpage_metrics_v2.projections import build_projection_files


def public_projection():
    return {
        "schema_version": 2,
        "generated_at": "2026-07-12T20:00:00Z",
        "collected_at": "2026-07-12T20:00:00Z",
        "freshness": "fresh",
        "overall_state": "operational",
        "resources": [
            {"resource": "cpu", "label": "CPU", "state": "healthy", "coverage_percent": 100}
        ],
        "services": [],
    }


class ProjectionPublisherTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.publisher = ProjectionPublisher(root / "public", root / "owner")

    def test_atomic_public_write_has_strict_permissions(self):
        os.chmod(self.publisher.public_dir, 0o2750)
        result = self.publisher.publish_public("latest.v2.json", public_projection())
        self.assertEqual(json.loads(result.path.read_text()), public_projection())
        self.assertEqual(stat.S_IMODE(result.path.stat().st_mode), 0o640)
        self.assertEqual(stat.S_IMODE(result.path.parent.stat().st_mode), 0o2750)
        self.assertEqual(list(result.path.parent.glob(".*.tmp")), [])

    def test_setgid_projection_root_is_not_rechmodded_by_unprivileged_publisher(self):
        os.chmod(self.publisher.owner_dir, 0o2750)
        original_chmod = os.chmod
        with mock.patch.object(os, "chmod", wraps=original_chmod) as chmod:
            self.publisher.publish_owner(
                "host/1h.v2.json",
                {
                    "schema_version": 2,
                    "range": "1h",
                    "timestamps": ["2026-07-12T20:00:00Z"],
                    "series": [{"id": "cpu", "values": [1]}],
                },
            )
        self.assertEqual(stat.S_IMODE(self.publisher.owner_dir.stat().st_mode), 0o2750)
        self.assertFalse(any(call.args[0] == self.publisher.owner_dir for call in chmod.call_args_list))

    def test_public_projection_rejects_private_keys_recursively(self):
        projection = public_projection()
        projection["nested"] = {"workloads": [{"pid": 1}]}
        with self.assertRaisesRegex(ValueError, "forbidden public key"):
            self.publisher.publish_public("latest.v2.json", projection)

    def test_replace_failure_preserves_previous_projection_and_cleans_temp(self):
        path = self.publisher.publish_public("latest.v2.json", public_projection()).path
        previous = path.read_bytes()
        with mock.patch.object(os, "replace", side_effect=OSError("replace failed")):
            with self.assertRaises(OSError):
                self.publisher.publish_public("latest.v2.json", {**public_projection(), "freshness": "stale"})
        self.assertEqual(path.read_bytes(), previous)
        self.assertEqual(list(path.parent.glob(".*.tmp")), [])

    def test_large_workload_projection_keeps_top_16_plus_residual(self):
        rows = [
            {"id": f"workload-{index}", "label": str(index), "unit": "percent", "values": [index]}
            for index in range(32)
        ]
        rows.append({"id": "system-untracked", "label": "system/untracked", "unit": "percent", "values": [1]})
        result = self.publisher.build_workload_series(rows)
        self.assertTrue(result["truncated"])
        self.assertEqual(len(result["series"]), 17)
        self.assertIn("system-untracked", {row["id"] for row in result["series"]})

    def test_manifest_allowlists_paths_and_closed_chunks_are_immutable(self):
        payload = {"schema_version": 2, "values": []}
        self.publisher.publish_owner("host/minute/2026-07-11.v2.json", payload, immutable=True)
        with self.assertRaisesRegex(FileExistsError, "immutable"):
            self.publisher.publish_owner("host/minute/2026-07-11.v2.json", {**payload, "values": [1]}, immutable=True)
        manifest = self.publisher.publish_manifest(["host/1h.v2.json", "host/minute/2026-07-11.v2.json"])
        self.assertEqual(json.loads(manifest.path.read_text())["files"], ["host/1h.v2.json", "host/minute/2026-07-11.v2.json"])
        with self.assertRaisesRegex(ValueError, "path"):
            self.publisher.publish_manifest(["../private.sqlite3"])

    def test_publish_treats_past_daily_chunks_as_immutable(self):
        series = {
            "schema_version": 2,
            "generated_at": "2026-07-11T23:59:00Z",
            "range": "24h",
            "resolution_seconds": 60,
            "view": "host",
            "resource": None,
            "timestamps": ["2026-07-11T23:59:00Z"],
            "series": [{"id": "cpu-total", "label": "CPU total", "unit": "percent", "values": [10]}],
            "coverage_percent": 100,
            "truncated": False,
        }
        snapshot = {
            "public": {},
            "owner": {
                "latest.v2.json": {"schema_version": 2, "generated_at": "2026-07-12T00:01:00Z", "workloads": [], "incidents": []},
                "host/minute/2026-07-11.v2.json": series,
            },
        }
        self.publisher.publish(snapshot)
        changed = {
            **snapshot,
            "owner": {
                **snapshot["owner"],
                "host/minute/2026-07-11.v2.json": {
                    **series,
                    "series": [{**series["series"][0], "values": [11]}],
                },
            },
        }
        with self.assertRaisesRegex(FileExistsError, "immutable"):
            self.publisher.publish(changed)

    def test_payload_caps_are_enforced_before_write(self):
        with self.assertRaisesRegex(ValueError, "512 KiB"):
            self.publisher.publish_owner(
                "latest.v2.json",
                {"schema_version": 2, "workloads": [], "incidents": [], "data": "x" * (512 * 1024)},
            )

    def test_collection_caps_are_enforced_before_write(self):
        projection = public_projection()
        projection["services"] = [{"id": f"service-{index}"} for index in range(33)]
        with self.assertRaisesRegex(ValueError, "services"):
            self.publisher.publish_public("latest.v2.json", projection)

    def test_projection_builder_keeps_public_coarse_and_owner_residual_explicit(self):
        snapshot = {
            "host": [{"tier": "15s", "ts_ms": 1_700_000_000_000, "coverage_percent": 100, "payload": {"cpu_percent": 50, "memory_total_bytes": 1000, "memory_used_bytes": 600, "disk_used_percent": 70, "disk_rates": {"vda": {"read_bytes_per_second": 100, "write_bytes_per_second": 50}}, "network_rates": {"eth0": {"receive_bytes_per_second": 20, "transmit_bytes_per_second": 30}}}}],
            "workloads": [{"tier": "15s", "ts_ms": 1_700_000_000_000, "workload_id": "frontpage-app", "coverage_percent": 100, "payload": {"label": "Frontpage", "kind": "container", "cgroup_path": "system.slice/frontpage", "cpu_percent": 20, "memory_current_bytes": 200, "io_read_bytes_per_second": 20, "io_write_bytes_per_second": 10, "processes": []}}],
            "services": [],
            "capabilities": [],
            "incidents": [],
        }
        files = build_projection_files(snapshot)
        serialized_public = json.dumps(files["public"])
        self.assertNotIn("cpu_percent", serialized_public)
        owner = files["owner"]["latest.v2.json"]
        residual = next(row for row in owner["workloads"] if row["id"] == "system-untracked")
        self.assertEqual(next(item for item in residual["resources"] if item["resource"] == "cpu")["current"], 30)
        self.assertFalse(any(item["resource"] == "network" for row in owner["workloads"] for item in row["resources"]))
        host_series = files["owner"]["host/1h.v2.json"]
        self.assertEqual(
            [series["id"] for series in host_series["series"]],
            ["cpu-total", "ram-used", "disk-io-total", "network-total"],
        )
        cpu_workloads = files["owner"]["workloads/cpu/1h.v2.json"]
        self.assertEqual(cpu_workloads["resource"], "cpu")
        self.assertEqual(cpu_workloads["series"][-1]["id"], "system-untracked")
        self.assertNotIn("workloads/network/1h.v2.json", files["owner"])

    def test_latest_projection_uses_current_workloads_and_history_summaries(self):
        older = 1_700_000_000_000
        current = older + 15_000
        host_payload = {
            "memory_total_bytes": 1000,
            "disk_used_percent": 70,
            "disk_rates": {"vda": {"read_bytes_per_second": 80, "write_bytes_per_second": 20}},
            "network_rates": {"eth0": {"receive_bytes_per_second": 30, "transmit_bytes_per_second": 20}},
        }
        workload_payload = {
            "label": "Frontpage",
            "kind": "container",
            "cgroup_path": "system.slice/frontpage",
            "io_read_bytes_per_second": 20,
            "io_write_bytes_per_second": 10,
            "processes": [],
        }
        snapshot = {
            "host": [
                {"tier": "15s", "ts_ms": older, "coverage_percent": 100, "payload": {**host_payload, "cpu_percent": 40, "memory_used_bytes": 500}},
                {"tier": "15s", "ts_ms": current, "coverage_percent": 100, "payload": {**host_payload, "cpu_percent": 50, "memory_used_bytes": 600}},
            ],
            "workloads": [
                {"tier": "15s", "ts_ms": older, "workload_id": "frontpage-app", "coverage_percent": 100, "payload": {**workload_payload, "cpu_percent": 10, "memory_current_bytes": 200}},
                {"tier": "15s", "ts_ms": current, "workload_id": "frontpage-app", "coverage_percent": 100, "payload": {**workload_payload, "cpu_percent": 20, "memory_current_bytes": 300}},
                {"tier": "15s", "ts_ms": older, "workload_id": "gone-workload", "coverage_percent": 100, "payload": {**workload_payload, "label": "Gone", "cpu_percent": 5, "memory_current_bytes": 100, "processes": [{"pid": 9}]}},
            ],
            "services": [], "capabilities": [], "incidents": [],
        }
        owner = build_projection_files(snapshot)["owner"]["latest.v2.json"]
        self.assertNotIn("gone-workload", {row["id"] for row in owner["workloads"]})
        cpu_total = next(row for row in owner["host"]["totals"] if row["resource"] == "cpu")
        self.assertEqual(cpu_total["average"], 45)
        self.assertEqual(cpu_total["peak"], 50)
        app = next(row for row in owner["workloads"] if row["id"] == "frontpage-app")
        app_cpu = next(row for row in app["resources"] if row["resource"] == "cpu")
        self.assertEqual(app_cpu["average"], 15)
        self.assertEqual(app_cpu["peak"], 20)
        self.assertEqual(app_cpu["change_1h"], 10)

    def test_over_attribution_reports_reconciliation_error_and_diagnostic(self):
        timestamp = 1_700_000_000_000
        snapshot = {
            "host": [{"tier": "15s", "ts_ms": timestamp, "coverage_percent": 100, "payload": {"cpu_percent": 50, "memory_total_bytes": 1000, "memory_used_bytes": 600, "disk_used_percent": 70, "disk_rates": {}, "network_rates": {}, "reconciliation_error_threshold_percent": 10}}],
            "workloads": [{"tier": "15s", "ts_ms": timestamp, "workload_id": "frontpage-app", "coverage_percent": 100, "payload": {"label": "Frontpage", "kind": "container", "cgroup_path": "system.slice/frontpage", "cpu_percent": 60, "memory_current_bytes": 200, "io_read_bytes_per_second": None, "io_write_bytes_per_second": None, "processes": []}}],
            "services": [], "capabilities": [], "incidents": [],
        }
        owner = build_projection_files(snapshot)["owner"]["latest.v2.json"]
        cpu_total = next(row for row in owner["host"]["totals"] if row["resource"] == "cpu")
        self.assertEqual(cpu_total["reconciliation_error_percent"], 20)
        self.assertIn("reconciliation-cpu", {row["id"] for row in owner["diagnostics"]})

    def test_missing_counter_deltas_remain_explicit_chart_gaps(self):
        timestamp = 1_700_000_000_000
        snapshot = {
            "host": [{"tier": "15s", "ts_ms": timestamp, "coverage_percent": 100, "payload": {"cpu_percent": None, "memory_total_bytes": 1000, "memory_used_bytes": 600, "disk_used_percent": 70, "disk_rates": {}, "network_rates": {}}}],
            "workloads": [], "services": [], "capabilities": [], "incidents": [],
        }
        files = build_projection_files(snapshot)
        host_series = files["owner"]["host/1h.v2.json"]
        values = {row["id"]: row["values"][0] for row in host_series["series"]}
        self.assertIsNone(values["cpu-total"])
        self.assertIsNone(values["disk-io-total"])
        self.assertIsNone(values["network-total"])
        totals = files["owner"]["latest.v2.json"]["host"]["totals"]
        self.assertEqual(
            {row["resource"] for row in totals if row["freshness"] == "unavailable"},
            {"cpu", "disk_io", "network"},
        )

    def test_owner_latest_reserves_a_slot_for_residual_at_configured_cap(self):
        timestamp = 1_700_000_000_000
        workload = {"kind": "systemd", "cgroup_path": "system.slice/service", "cpu_percent": 1, "memory_current_bytes": 10, "io_read_bytes_per_second": 1, "io_write_bytes_per_second": 0, "processes": []}
        snapshot = {
            "host": [{"tier": "15s", "ts_ms": timestamp, "coverage_percent": 100, "payload": {"cpu_percent": 50, "memory_total_bytes": 2000, "memory_used_bytes": 1000, "disk_used_percent": 70, "disk_rates": {"vda": {"read_bytes_per_second": 100, "write_bytes_per_second": 0}}, "network_rates": {}}}],
            "workloads": [
                {"tier": "15s", "ts_ms": timestamp, "workload_id": f"workload-{index:02d}", "coverage_percent": 100, "payload": {**workload, "label": f"Workload {index}"}}
                for index in range(32)
            ],
            "services": [], "capabilities": [], "incidents": [],
        }
        owner = build_projection_files(snapshot)["owner"]["latest.v2.json"]
        self.assertEqual(len(owner["workloads"]), 32)
        self.assertEqual(owner["workloads"][-1]["id"], "system-untracked")
        self.assertIn("current-workloads-truncated", {row["id"] for row in owner["diagnostics"]})
        residual = next(row for row in owner["workloads"][-1]["resources"] if row["resource"] == "ram")
        self.assertEqual(residual["current"], 690)


if __name__ == "__main__":
    unittest.main()
