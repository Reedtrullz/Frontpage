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


if __name__ == "__main__":
    unittest.main()
