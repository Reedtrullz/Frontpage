import threading
import json
import io
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from ops.frontpage_metrics_v2.collector import LinuxCycleCollector
from ops.frontpage_metrics_v2.config import load_config
from ops.frontpage_metrics_v2.daemon import CollectorDaemon
from ops.frontpage_metrics_v2.incidents import IncidentEngine, IncidentTransitionSet
from ops.frontpage_metrics_v2.model import ServiceSample, SourceResult, WorkloadConfig
from ops.frontpage_metrics_v2.projections import build_projection_files
from ops.frontpage_metrics_v2.publisher import ProjectionPublisher
from ops.frontpage_metrics_v2.store import CycleWriteStatus, MetricsStore


class FakeCollector:
    def __init__(self):
        self.calls = 0
        self.running = False

    def collect_cycle(self, now_ms):
        if self.running:
            raise AssertionError("overlapping collection")
        self.running = True
        self.calls += 1
        self.running = False
        return {"ts_ms": now_ms, "source_errors": ["psi unavailable"]}


class FakeEngine:
    def __init__(self):
        self.state = 0

    def evaluate(self, cycle, active):
        self.state += 1
        return IncidentTransitionSet()

    def checkpoint(self):
        return self.state

    def restore(self, checkpoint):
        self.state = checkpoint


class FakeStore:
    def __init__(self, statuses=None):
        self.statuses = list(statuses or [CycleWriteStatus(0.1, False)])
        self.orders = []

    def commit_cycle(self, cycle, evaluate, now_ms):
        self.orders.extend(["persist", "evaluate", "compact", "commit", "read"])
        transitions = evaluate(cycle)
        status = self.statuses.pop(0) if self.statuses else CycleWriteStatus(0.1, False)
        return status, transitions, {"cycle": cycle}


class FakePublisher:
    def __init__(self):
        self.snapshots = []

    def publish(self, snapshot):
        self.snapshots.append(snapshot)


class FailingStore(FakeStore):
    def commit_cycle(self, cycle, evaluate, now_ms):
        evaluate(cycle)
        raise RuntimeError("commit failed")


class FakeStopEvent:
    def __init__(self, waits_to_stop):
        self.waits_to_stop = waits_to_stop
        self.waits = []
        self.stopped = False

    def is_set(self):
        return self.stopped

    def wait(self, timeout):
        self.waits.append(timeout)
        if len(self.waits) >= self.waits_to_stop:
            self.stopped = True
        return self.stopped


class CollectorDaemonTests(unittest.TestCase):
    def test_full_cycle_overrun_logs_phase_times_without_hiding_gap_or_relaxing_database_guard(self):
        clock = iter((0.0, 9.0, 15.0, 16.0, 17.0))
        daemon = CollectorDaemon(FakeCollector(), FakeStore([CycleWriteStatus(0.1, False)]),
                                 FakeEngine(), FakePublisher(), monotonic=lambda: next(clock),
                                 wall_clock_ms=lambda: 15000)
        output = io.StringIO()
        with mock.patch("sys.stderr", output):
            result = daemon.run_once()
        self.assertTrue(output.getvalue(), "Full-cycle overrun needs a timing receipt")
        receipt = json.loads(output.getvalue())
        self.assertEqual(receipt["ts_ms"], 15000)
        self.assertEqual(receipt["collection_seconds"], 9.0)
        self.assertAlmostEqual(receipt["database_seconds"], 0.1)
        self.assertAlmostEqual(receipt["projection_read_seconds"], 5.9)
        self.assertEqual(receipt["build_seconds"], 1.0)
        self.assertEqual(receipt["publish_seconds"], 1.0)
        self.assertEqual(receipt["total_seconds"], 17.0)
        self.assertFalse(result.skip_next_cycle)

    def test_run_once_preserves_required_order_and_publishes_partial_cycle(self):
        collector = FakeCollector()
        store = FakeStore()
        publisher = FakePublisher()
        daemon = CollectorDaemon(collector, store, FakeEngine(), publisher, wall_clock_ms=lambda: 1000)
        result = daemon.run_once()
        self.assertEqual(store.orders, ["persist", "evaluate", "compact", "commit", "read"])
        self.assertEqual(publisher.snapshots[0]["cycle"]["source_errors"], ["psi unavailable"])
        self.assertFalse(result.skip_next_cycle)

    def test_boot_primes_counters_and_waits_for_utc_slots(self):
        ticks = iter((1000, 1000, 15000, 16200))
        stop = FakeStopEvent(waits_to_stop=2)
        collector = FakeCollector()
        daemon = CollectorDaemon(
            collector,
            FakeStore([CycleWriteStatus(0.1, False), CycleWriteStatus(0.1, False)]),
            FakeEngine(),
            FakePublisher(),
            wall_clock_ms=lambda: next(ticks),
        )
        daemon.run_forever(stop)
        self.assertEqual(collector.calls, 2)
        self.assertAlmostEqual(stop.waits[0], 14.0)

    def test_slow_write_skips_one_utc_slot_without_backlog(self):
        ticks = iter((1000, 1000, 15000, 16000, 30000, 45000))
        stop = FakeStopEvent(waits_to_stop=3)
        collector = FakeCollector()
        daemon = CollectorDaemon(
            collector,
            FakeStore([CycleWriteStatus(6.0, True)]),
            FakeEngine(), FakePublisher(),
            wall_clock_ms=lambda: next(ticks),
        )
        with mock.patch("sys.stderr", io.StringIO()):
            daemon.run_forever(stop)
        self.assertEqual(stop.waits, [14.0, 14.0, 15.0])
        self.assertEqual(collector.calls, 2)

    def test_already_set_stop_event_runs_no_cycle(self):
        stop = threading.Event()
        stop.set()
        collector = FakeCollector()
        CollectorDaemon(collector, FakeStore(), FakeEngine(), FakePublisher()).run_forever(stop)
        self.assertEqual(collector.calls, 0)

    def test_failed_transaction_restores_incident_engine_checkpoint(self):
        engine = FakeEngine()
        daemon = CollectorDaemon(FakeCollector(), FailingStore(), engine, FakePublisher())
        with self.assertRaisesRegex(RuntimeError, "commit failed"):
            daemon.run_once()
        self.assertEqual(engine.state, 0)

    def test_real_once_cycle_publishes_separate_contract_valid_trees(self):
        repo = Path(__file__).parents[2]
        fixtures = repo / "ops/tests/fixtures/observability-v2"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = replace(
                load_config(repo / "ops/frontpage-metrics-v2.config.json"),
                public_dir=root / "metrics/public",
                owner_dir=root / "metrics/owner",
                database_path=root / "private/metrics.sqlite3",
                runtime_map_path=root / "runtime-map.json",
                workloads=(WorkloadConfig("frontpage-app", "Frontpage app", "systemd-unit", "frontpage.service", "frontpage"),),
                services=({"id": "frontpage-public", "label": "Frontpage", "visibility": "public", "url": "https://example.com/", "expected_status": 200, "timeout_ms": 1000},),
            )
            store = MetricsStore.open(config.database_path)
            self.addCleanup(store.close)
            config.runtime_map_path.write_text(json.dumps({
                "generated_at": "2026-07-12T20:00:00Z",
                "workloads": [{
                    "workload_id": "frontpage-app",
                    "cgroup_path": "system.slice/frontpage.service",
                    "image_sha": "sha256:" + "a" * 64,
                }],
            }))
            collector = LinuxCycleCollector(config, proc_root=fixtures / "proc", cgroup_root=fixtures / "cgroup")
            service_result = SourceResult(
                (ServiceSample("frontpage-public", "public", "up", 1_700_000_000_000, 5),),
                True,
                {"service_checks": "available"},
                (),
            )
            with mock.patch("ops.frontpage_metrics_v2.collector.collect_services", return_value=service_result):
                CollectorDaemon(
                    collector,
                    store,
                    IncidentEngine(config.thresholds),
                    ProjectionPublisher(config.public_dir, config.owner_dir),
                    wall_clock_ms=lambda: 1_700_000_000_000,
                    projection_builder=build_projection_files,
                ).run_once()
            public_latest = json.loads((config.public_dir / "latest.v2.json").read_text())
            owner_latest = json.loads((config.owner_dir / "latest.v2.json").read_text())
            self.assertNotIn("workloads", public_latest)
            self.assertIn("workloads", owner_latest)
            self.assertEqual(owner_latest["workloads"][0]["kind"], "container")
            self.assertTrue(config.database_path.exists())
            self.assertFalse((config.owner_dir / config.database_path.name).exists())


if __name__ == "__main__":
    unittest.main()
