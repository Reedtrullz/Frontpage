import dataclasses
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from ops.frontpage_metrics_v2.model import WorkloadConfig
from ops.frontpage_metrics_v2.sources.cgroup import collect_workloads
from ops.frontpage_metrics_v2.sources.processes import collect_processes
from ops.frontpage_metrics_v2.sources.procfs import HostPaths, collect_host
from ops.frontpage_metrics_v2.sources.runtime import load_runtime_map
from ops.frontpage_metrics_v2.sources.services import collect_services, service_result


FIXTURES = Path(__file__).parent / "fixtures" / "observability-v2"


class HostSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.proc_root = Path(self.temporary.name) / "proc"
        shutil.copytree(FIXTURES / "proc", self.proc_root)
        self.paths = HostPaths(
            proc_root=self.proc_root,
            filesystems=(Path("/"),),
            block_devices=("vda",),
            network_interfaces=("eth0",),
        )

    def test_collects_host_gauges_and_positive_counter_deltas(self):
        first = collect_host(None, self.paths, now_ms=1000)
        self.assertTrue(first.available)
        self.assertEqual(first.value.memory_used_bytes, 600000 * 1024)
        self.assertEqual(first.value.logical_cpu_count, 2)
        self.assertIsNone(first.value.cpu_percent)

        (self.proc_root / "stat").write_text("cpu  160 0 60 880 0 0 0 0 0 0\n")
        (self.proc_root / "diskstats").write_text(
            "8 0 vda 12 0 108 0 25 0 216 0 0 0 0\n"
        )
        (self.proc_root / "net" / "dev").write_text(
            "Inter-| Receive | Transmit\n face |bytes packets errs drop|bytes packets errs drop\n"
            " eth0: 1300 13 1 2 0 0 0 0 2600 26 3 4 0 0 0 0\n"
        )
        second = collect_host(first.value, self.paths, now_ms=2000)

        self.assertAlmostEqual(second.value.cpu_percent, 70.0)
        self.assertEqual(second.value.disk_rates["vda"]["read_bytes_per_second"], 4096)
        self.assertEqual(second.value.disk_rates["vda"]["write_bytes_per_second"], 8192)
        self.assertEqual(second.value.network_rates["eth0"]["receive_bytes_per_second"], 300)
        self.assertEqual(second.value.network_rates["eth0"]["transmit_bytes_per_second"], 600)

    def test_reboot_produces_explicit_rate_gaps(self):
        first = collect_host(None, self.paths, now_ms=1000).value
        (self.proc_root / "sys" / "kernel" / "random" / "boot_id").write_text("boot-b\n")
        second = collect_host(first, self.paths, now_ms=2000).value
        self.assertIsNone(second.cpu_percent)
        self.assertEqual(second.disk_rates, {})
        self.assertEqual(second.network_rates, {})

    def test_missing_psi_is_a_capability_gap_not_sample_failure(self):
        shutil.rmtree(self.proc_root / "pressure")
        result = collect_host(None, self.paths, now_ms=1000)
        self.assertTrue(result.available)
        self.assertEqual(result.capabilities["psi"], "unavailable")
        self.assertEqual(result.value.pressure, {})

    def test_malformed_optional_sources_do_not_discard_host_sample(self):
        (self.proc_root / "pressure" / "cpu").write_text("not-psi\n")
        (self.proc_root / "net" / "snmp").unlink()
        result = collect_host(None, self.paths, now_ms=1000)
        self.assertTrue(result.available)
        self.assertEqual(result.capabilities["psi"], "partial")
        self.assertEqual(result.capabilities["tcp_retransmits"], "unavailable")
        self.assertIsNone(result.value.tcp_retransmits)


class WorkloadSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "cgroup"
        shutil.copytree(FIXTURES / "cgroup", self.root)
        self.config = (
            WorkloadConfig(
                id="frontpage-app",
                label="Frontpage app",
                match_type="systemd-unit",
                match_value="frontpage.service",
                project_slug="frontpage",
            ),
        )

    def test_collects_cgroup_cpu_memory_io_oom_and_pressure(self):
        result = collect_workloads(self.config, None, self.root, now_ms=1000)
        sample = result.value[0]
        self.assertEqual(sample.memory_current_bytes, 268435456)
        self.assertEqual(sample.io_read_bytes, 4096)
        self.assertEqual(sample.io_write_bytes, 8192)
        self.assertEqual(sample.oom_kill_events, 1)
        self.assertEqual(sample.pids, (123,))
        self.assertEqual(result.capabilities["cgroup_v2"], "available")

    def test_workload_deltas_and_resets_are_explicit(self):
        first = collect_workloads(self.config, None, self.root, now_ms=1000).value
        path = self.root / "system.slice" / "frontpage.service"
        (path / "cpu.stat").write_text("usage_usec 1500000\n")
        (path / "io.stat").write_text("8:0 rbytes=8192 wbytes=16384 rios=8 wios=16\n")
        second = collect_workloads(self.config, first, self.root, now_ms=2000).value[0]
        self.assertEqual(second.cpu_percent, 50.0)
        self.assertEqual(second.io_read_bytes_per_second, 4096)
        self.assertEqual(second.io_write_bytes_per_second, 8192)

        (path / "cpu.stat").write_text("usage_usec 10\n")
        reset = collect_workloads(self.config, (second,), self.root, now_ms=3000).value[0]
        self.assertIsNone(reset.cpu_percent)

    def test_workload_cpu_is_normalized_to_the_host_total_scale(self):
        first = collect_workloads(self.config, None, self.root, now_ms=1000).value
        path = self.root / "system.slice" / "frontpage.service"
        (path / "cpu.stat").write_text("usage_usec 1500000\n")
        second = collect_workloads(
            self.config,
            first,
            self.root,
            now_ms=2000,
            logical_cpu_count=2,
        ).value[0]
        self.assertEqual(second.cpu_percent, 25.0)

    def test_path_escape_is_rejected_without_reading_outside_root(self):
        config = (WorkloadConfig("escape", "Escape", "cgroup-path", "../secret", None),)
        result = collect_workloads(config, None, self.root, now_ms=1000)
        self.assertFalse(result.available)
        self.assertTrue(any("outside" in error for error in result.errors))

    def test_optional_pressure_and_process_visibility_fail_independently(self):
        path = self.root / "system.slice" / "frontpage.service"
        (path / "cpu.pressure").write_text("bad-pressure\n")
        (path / "cgroup.procs").unlink()
        result = collect_workloads(self.config, None, self.root, now_ms=1000)
        self.assertTrue(result.available)
        self.assertEqual(result.value[0].pids, ())
        self.assertEqual(result.capabilities["psi"], "partial")
        self.assertEqual(result.capabilities["process_visibility"], "unavailable")


class ProcessSourceTests(unittest.TestCase):
    def test_process_rows_expose_only_the_positive_allowlist(self):
        result = collect_processes(
            {"frontpage-app": (123,)}, FIXTURES / "proc", previous={}, now_ms=2000
        )
        row = dataclasses.asdict(result.value["frontpage-app"][0])
        self.assertEqual(
            set(row),
            {"pid", "comm", "uid", "cpu_percent", "rss_bytes", "state", "workload_id"},
        )
        self.assertNotIn("SECRET_TOKEN", json.dumps(row))

    def test_processes_are_ranked_and_capped_at_20(self):
        with tempfile.TemporaryDirectory() as directory:
            proc_root = Path(directory)
            for pid in range(1, 25):
                source = FIXTURES / "proc" / "123"
                target = proc_root / str(pid)
                shutil.copytree(source, target)
                (target / "stat").write_text(
                    f"{pid} (worker {pid}) R 1 1 1 0 0 0 0 0 0 {pid} {pid} 0 0 20 0 1 0 100 0 0\n"
                )
            result = collect_processes(
                {"frontpage-app": tuple(range(1, 25))},
                proc_root,
                previous={("frontpage-app", pid): (0, 1000) for pid in range(1, 25)},
                now_ms=2000,
            )
        rows = result.value["frontpage-app"]
        self.assertEqual(len(rows), 20)
        self.assertGreaterEqual(rows[0].cpu_percent, rows[-1].cpu_percent)

    def test_process_cpu_is_normalized_to_the_host_total_scale(self):
        with tempfile.TemporaryDirectory() as directory:
            proc_root = Path(directory)
            shutil.copytree(FIXTURES / "proc" / "123", proc_root / "123")
            one_core = collect_processes(
                {"frontpage-app": (123,)},
                proc_root,
                previous={("frontpage-app", 123): (0, 1000)},
                now_ms=2000,
                logical_cpu_count=1,
            ).value["frontpage-app"][0]
            two_cores = collect_processes(
                {"frontpage-app": (123,)},
                proc_root,
                previous={("frontpage-app", 123): (0, 1000)},
                now_ms=2000,
                logical_cpu_count=2,
            ).value["frontpage-app"][0]
        self.assertEqual(one_core.cpu_percent, 100)
        self.assertEqual(two_cores.cpu_percent, 75)


class RuntimeMapTests(unittest.TestCase):
    def test_runtime_map_is_strict_and_allowlisted(self):
        payload = {
            "generated_at": "2026-07-12T20:00:00Z",
            "workloads": [
                {
                    "workload_id": "frontpage-app",
                    "cgroup_path": "system.slice/docker-abc.scope",
                    "image_sha": "sha256:" + "a" * 64,
                }
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime.json"
            path.write_text(json.dumps(payload))
            runtime = load_runtime_map(path, {"frontpage-app"})
            self.assertEqual(runtime["frontpage-app"].cgroup_path, payload["workloads"][0]["cgroup_path"])

            payload["workloads"][0]["image_sha"] = "sha256:" + "z" * 64
            path.write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError, "SHA"):
                load_runtime_map(path, {"frontpage-app"})


class ServiceSourceTests(unittest.TestCase):
    def test_service_errors_are_redacted_and_partial_failure_survives(self):
        services = (
            {"id": "up", "label": "Up", "visibility": "public", "url": "https://example.com/", "expected_status": 200, "timeout_ms": 1000},
            {"id": "down", "label": "Down", "visibility": "owner", "url": "https://internal.example/secret", "expected_status": 200, "timeout_ms": 1000},
        )

        class Response:
            status = 200

            def read(self, _size):
                return b"{}"

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        def opener(request, **_kwargs):
            if "internal" in request.full_url:
                raise RuntimeError("secret /root/token")
            return Response()

        result = collect_services(services, now_ms=1000, opener=opener)
        self.assertTrue(result.available)
        self.assertEqual([item.status for item in result.value], ["up", "unknown"])
        self.assertNotIn("secret", json.dumps(dataclasses.asdict(result)))

    def test_service_result_marks_redirect_errors_down(self):
        class RedirectError(Exception):
            code = 302

            def close(self):
                return None

        row = service_result(
            {"id": "redirect", "label": "Redirect", "visibility": "public", "url": "https://example.com/start", "expected_status": 200, "timeout_ms": 1000},
            now_ms=1000,
            opener=lambda *_args, **_kwargs: (_ for _ in ()).throw(RedirectError()),
        )
        self.assertEqual(row.status, "down")


if __name__ == "__main__":
    unittest.main()
