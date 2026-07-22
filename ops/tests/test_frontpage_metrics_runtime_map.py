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
        self.assertIn("if observability_v2_enabled else []", playbook)
        self.assertIn("OBSERVABILITY_V2_SHADOW_GATE=approved", playbook)
        self.assertIn("shadow-evidence-epoch.json", playbook)
        self.assertIn("Start a new shadow evidence epoch", playbook)
        self.assertIn("--evidence-epoch", playbook)
        self.assertIn("observer_package_files:", playbook)
        self.assertIn("Remove stale observer bytecode", playbook)
        self.assertIn("Remove stale observability collector source files", playbook)
        self.assertIn("or observer_stale_package_files_removed.changed", playbook)
        self.assertIn('src: "ops/frontpage_metrics_v2/{{ item }}"', playbook)
        self.assertNotIn("src: ops/frontpage_metrics_v2\n", playbook)
        restart_index = playbook.index("Enable observability collector shadow service")
        epoch_index = playbook.index("Start a new shadow evidence epoch")
        self.assertLess(restart_index, epoch_index)
        self.assertNotIn('"{{ metrics_dir }}:/metrics:ro"', playbook)
        self.assertNotIn("v2-shadow:/metrics", playbook)
        self.assertNotIn("/private:/metrics", playbook)

    def test_ansible_preserves_promoted_mode_on_ordinary_deployments(self):
        playbook = (SCRIPT.parent.parent / "ansible-playbook.yml").read_text()
        self.assertIn("Gather systemd service state for observability mode", playbook)
        self.assertIn("observability_v2_enabled", playbook)
        self.assertIn("observability_v2_promote\n            or (", playbook)
        self.assertNotIn(
            "if observability_v2_promote else 'frontpage-metrics-collector-v2-shadow.service'",
            playbook,
        )
        self.assertNotIn("if observability_v2_promote else []", playbook)
        self.assertIn(
            "'FRONTPAGE_OBSERVABILITY_V2': '1'\n"
            "                } if observability_v2_enabled else {}",
            playbook,
        )
        self.assertIn(
            "- (not observability_v2_enabled) or "
            "('FRONTPAGE_OBSERVABILITY_V2=1' in container_info.container.Config.Env)",
            playbook,
        )
        self.assertIn("Read both observability collector service states", playbook)
        self.assertIn("exactly one observability collector is active", playbook)
        self.assertEqual(
            playbook.count(
                "when: (not observability_v2_enabled) or observability_v2_promote"
            ),
            3,
        )

    def test_ansible_observer_package_manifest_matches_local_python_sources(self):
        playbook = (SCRIPT.parent.parent / "ansible-playbook.yml").read_text()
        manifest_block = playbook.split("observer_package_files:", 1)[1].split(
            "owner_github_login:", 1
        )[0]
        manifest = {
            line.strip().removeprefix("- ")
            for line in manifest_block.splitlines()
            if line.strip().startswith("- ")
        }
        package_root = SCRIPT.parent / "frontpage_metrics_v2"
        local_sources = {
            str(path.relative_to(package_root)) for path in package_root.rglob("*.py")
        }
        self.assertEqual(manifest, local_sources)

    def test_ansible_runs_collector_preflights_as_the_observer_without_become_user(self):
        playbook = (SCRIPT.parent.parent / "ansible-playbook.yml").read_text()
        self.assertNotIn("become_user:", playbook)
        self.assertEqual(playbook.count("- /usr/sbin/runuser"), 5)
        self.assertEqual(playbook.count('- "{{ observer_user }}"'), 5)
        self.assertEqual(
            playbook.count("- /usr/local/bin/frontpage-metrics-runtime-map"), 3
        )
        self.assertIn("name: acl", playbook)
        self.assertIn("ansible.posix.acl:", playbook)
        self.assertIn('permissions: x', playbook)
        self.assertIn("FRONTPAGE_OBSERVABILITY_RESET_EVIDENCE", playbook)
        self.assertIn("shadow_collector_restart_required", playbook)
        self.assertIn("'restarted' if shadow_collector_restart_required else 'started'", playbook)
        self.assertIn("Normalize existing shadow projection directory ownership", playbook)
        self.assertIn("Normalize existing shadow projection file ownership", playbook)
        stop_index = playbook.index("Stop shadow collector before rebuilding runtime state")
        map_index = playbook.index("Generate current allowlisted runtime map")
        start_index = playbook.index("Enable observability collector shadow service")
        self.assertLess(stop_index, map_index)
        self.assertLess(map_index, start_index)
        rebind_map_index = playbook.index("Regenerate runtime map for newly active container")
        health_index = playbook.index("Wait for application to become healthy")
        self.assertLess(rebind_map_index, health_index)
        self.assertNotIn("Stop selected collector before active runtime rebinding", playbook)
        self.assertNotIn("Restart selected collector with active runtime binding", playbook)
        self.assertNotIn("Restart shadow collector after rollback binding", playbook)


if __name__ == "__main__":
    unittest.main()
