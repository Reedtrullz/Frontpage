import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "frontpage-metrics-runtime-map.py"
SPEC = importlib.util.spec_from_file_location("frontpage_metrics_runtime_map", SCRIPT)
runtime_map = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(runtime_map)


class RuntimeMapGeneratorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        proc = self.root / "proc/123"
        proc.mkdir(parents=True)
        (proc / "cgroup").write_text("0::/system.slice/docker-abc.scope\n")
        self.allowlist = {"frontpage-app": "frontpage"}
        self.facts = {
            "containers": [
                {
                    "name": "frontpage",
                    "pid": 123,
                    "image_sha": "sha256:" + "a" * 64,
                }
            ]
        }

    def test_exact_allowlist_binds_image_and_normalized_cgroup(self):
        result = runtime_map.generate_runtime_map(
            self.allowlist,
            self.facts,
            self.root / "proc",
            "2026-07-12T20:00:00Z",
        )
        self.assertEqual(
            result["workloads"],
            [
                {
                    "workload_id": "frontpage-app",
                    "cgroup_path": "system.slice/docker-abc.scope",
                    "image_sha": "sha256:" + "a" * 64,
                }
            ],
        )

    def test_unallowlisted_container_facts_are_never_discovered(self):
        self.facts["containers"].append(
            {"name": "private-database", "pid": 999, "image_sha": "sha256:" + "b" * 64}
        )
        result = runtime_map.generate_runtime_map(
            self.allowlist, self.facts, self.root / "proc", "2026-07-12T20:00:00Z"
        )
        self.assertEqual([item["workload_id"] for item in result["workloads"]], ["frontpage-app"])

    def test_duplicate_workload_or_container_bindings_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            runtime_map.validate_allowlist(
                [
                    {"workload_id": "frontpage-app", "container_name": "frontpage"},
                    {"workload_id": "frontpage-app", "container_name": "other"},
                ]
            )
        with self.assertRaisesRegex(ValueError, "duplicate"):
            runtime_map.validate_allowlist(
                [
                    {"workload_id": "frontpage-app", "container_name": "frontpage"},
                    {"workload_id": "other-app", "container_name": "frontpage"},
                ]
            )

    def test_cgroup_escape_and_invalid_image_sha_are_rejected(self):
        (self.root / "proc/123/cgroup").write_text("0::/../../private\n")
        with self.assertRaisesRegex(ValueError, "cgroup"):
            runtime_map.generate_runtime_map(
                self.allowlist, self.facts, self.root / "proc", "2026-07-12T20:00:00Z"
            )
        (self.root / "proc/123/cgroup").write_text("0::/system.slice/frontpage.scope\n")
        self.facts["containers"][0]["image_sha"] = "latest"
        with self.assertRaisesRegex(ValueError, "image"):
            runtime_map.generate_runtime_map(
                self.allowlist, self.facts, self.root / "proc", "2026-07-12T20:00:00Z"
            )

    def test_atomic_write_uses_0640_and_leaves_no_temporary_file(self):
        output = self.root / "run/runtime-map.json"
        payload = runtime_map.generate_runtime_map(
            self.allowlist, self.facts, self.root / "proc", "2026-07-12T20:00:00Z"
        )
        runtime_map.atomic_write_json(output, payload)
        self.assertEqual(json.loads(output.read_text()), payload)
        self.assertEqual(output.stat().st_mode & 0o777, 0o640)
        self.assertEqual(list(output.parent.glob(".*.tmp")), [])

    def test_systemd_units_keep_shadow_and_production_paths_distinct(self):
        systemd = SCRIPT.parent / "systemd"
        shadow = (systemd / "frontpage-metrics-collector-v2-shadow.service").read_text()
        production = (systemd / "frontpage-metrics-collector-v2.service").read_text()
        for unit in (shadow, production):
            self.assertIn("User=frontpage-observer", unit)
            self.assertIn("Group=frontpage-observer", unit)
            self.assertIn("CapabilityBoundingSet=\n", unit)
            self.assertNotIn("SupplementaryGroups", unit)
            self.assertNotIn("docker.sock", unit)
        self.assertIn("--metrics-dir /var/lib/frontpage-metrics/v2-shadow", shadow)
        self.assertIn("metrics-v2-shadow.sqlite3", shadow)
        self.assertIn("--metrics-dir /var/lib/frontpage-metrics/v2 ", production)
        self.assertIn("metrics-v2-shadow.sqlite3", production)

    def test_ansible_keeps_shadow_v1_only_and_gates_promoted_v2_mounts(self):
        playbook = (SCRIPT.parent.parent / "ansible-playbook.yml").read_text()
        self.assertIn('metrics_v1_dir: "{{ metrics_dir }}/v1"', playbook)
        self.assertIn("metrics_v1_dir ~ ':/metrics:ro'", playbook)
        self.assertIn('"{{ metrics_v1_dir }}:/metrics:ro"', playbook)
        self.assertIn("metrics_dir ~ '/v2/public:/metrics-public:ro'", playbook)
        self.assertIn("metrics_dir ~ '/v2/owner:/metrics-owner:ro'", playbook)
        self.assertIn("if observability_v2_promote else []", playbook)
        self.assertIn("OBSERVABILITY_V2_SHADOW_GATE=approved", playbook)
        self.assertNotIn('"{{ metrics_dir }}:/metrics:ro"', playbook)
        self.assertNotIn("v2-shadow:/metrics", playbook)
        self.assertNotIn("/private:/metrics", playbook)

    def test_ansible_runs_collector_preflights_as_the_observer_without_become_user(self):
        playbook = (SCRIPT.parent.parent / "ansible-playbook.yml").read_text()
        self.assertNotIn("become_user:", playbook)
        self.assertEqual(playbook.count("- /usr/sbin/runuser"), 2)
        self.assertEqual(playbook.count('- "{{ observer_user }}"'), 2)
        self.assertIn("name: acl", playbook)
        self.assertIn("ansible.posix.acl:", playbook)
        self.assertIn('permissions: x', playbook)
        self.assertIn("Normalize existing shadow projection directory ownership", playbook)
        self.assertIn("Normalize existing shadow projection file ownership", playbook)
        stop_index = playbook.index("Stop shadow collector before rebuilding runtime state")
        map_index = playbook.index("Generate current allowlisted runtime map")
        start_index = playbook.index("Enable observability collector shadow service")
        self.assertLess(stop_index, map_index)
        self.assertLess(map_index, start_index)
        rebind_stop_index = playbook.index("Stop selected collector before active runtime rebinding")
        rebind_map_index = playbook.index("Regenerate runtime map for newly active container")
        rebind_start_index = playbook.index("Restart selected collector with active runtime binding")
        self.assertLess(rebind_stop_index, rebind_map_index)
        self.assertLess(rebind_map_index, rebind_start_index)


if __name__ == "__main__":
    unittest.main()
