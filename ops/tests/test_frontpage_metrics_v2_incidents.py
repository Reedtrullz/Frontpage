import json
import tempfile
import unittest
from pathlib import Path

from ops.frontpage_metrics_v2.incidents import IncidentEngine
from ops.frontpage_metrics_v2.model import ThresholdConfig
from ops.frontpage_metrics_v2.store import MetricsStore


NOW = 2_000_000_000_000


def thresholds():
    return ThresholdConfig(80, 90, 2, 2, 10)


def cycle(now_ms=NOW, **overrides):
    payload = {
        "ts_ms": now_ms,
        "freshness": "fresh",
        "host": {"disk_used_percent": 50, "psi": {}},
        "services": [{"service_id": "frontpage-public", "status": "up"}],
        "workloads": [],
        "capabilities": {"psi": "available"},
    }
    payload.update(overrides)
    return payload


class IncidentEngineTests(unittest.TestCase):
    def test_service_requires_two_failures_and_two_successes(self):
        engine = IncidentEngine(thresholds())
        first = engine.evaluate(cycle(services=[{"service_id": "frontpage-public", "status": "down"}]), ())
        self.assertEqual(first.opened, ())
        second = engine.evaluate(cycle(NOW + 15_000, services=[{"service_id": "frontpage-public", "status": "down"}]), ())
        self.assertEqual(second.opened[0].rule_id, "service-down")
        active = second.opened
        third = engine.evaluate(cycle(NOW + 30_000), active)
        self.assertEqual(third.recovered, ())
        fourth = engine.evaluate(cycle(NOW + 45_000), active)
        self.assertEqual(fourth.recovered[0].state, "recovered")

    def test_disk_thresholds_use_severity_and_hysteresis(self):
        engine = IncidentEngine(thresholds())
        opened = engine.evaluate(cycle(host={"disk_used_percent": 91, "psi": {}}), ()).opened[0]
        self.assertEqual(opened.severity, "critical")
        still_active = engine.evaluate(cycle(NOW + 15_000, host={"disk_used_percent": 78, "psi": {}}), (opened,))
        self.assertEqual(still_active.recovered, ())
        recovered = engine.evaluate(cycle(NOW + 30_000, host={"disk_used_percent": 74, "psi": {}}), (opened,))
        self.assertEqual(recovered.recovered[0].state, "recovered")

    def test_oom_delta_opens_owner_incident_and_psi_disabled_opens_nothing(self):
        engine = IncidentEngine(thresholds())
        result = engine.evaluate(
            cycle(
                workloads=[{"workload_id": "frontpage-app", "oom_kill_delta": 1}],
                host={"disk_used_percent": 50, "psi": {"memory_some_avg10": 99}},
                capabilities={"psi": "unavailable"},
            ),
            (),
        )
        self.assertEqual(len(result.opened), 1)
        self.assertEqual(result.opened[0].rule_id, "workload-oom-kill")
        self.assertEqual(result.opened[0].visibility, "owner")

    def test_stale_collector_opens_freshness_incident(self):
        engine = IncidentEngine(thresholds())
        result = engine.evaluate(cycle(freshness="stale"), ())
        self.assertEqual(result.opened[0].rule_id, "collector-freshness")

    def test_evidence_is_bounded_and_survives_metric_pruning(self):
        engine = IncidentEngine(thresholds())
        for index in range(30):
            engine.evaluate(
                cycle(
                    NOW + index * 15_000,
                    workloads=[{"workload_id": "frontpage-app", "oom_kill_delta": 0}],
                ),
                (),
            )
        transitions = engine.evaluate(
            cycle(NOW + 30 * 15_000, workloads=[{"workload_id": "frontpage-app", "oom_kill_delta": 1}]),
            (),
        )
        evidence = transitions.opened[0].evidence
        self.assertLessEqual(len(evidence["points"]), 21)
        self.assertTrue(any(point["value"] == 0 for point in evidence["points"][:-1]))
        self.assertEqual(evidence["trigger_value"], 1)
        self.assertEqual(evidence["threshold_value"], 1)
        self.assertLessEqual(len(json.dumps(evidence).encode()), 256 * 1024)
        self.assertLessEqual(len(transitions.opened[0].id), 63)

        with tempfile.TemporaryDirectory() as directory:
            store = MetricsStore.open(Path(directory) / "metrics.sqlite3")
            self.addCleanup(store.close)
            store.persist_incidents(transitions)
            store.prune(NOW + 31 * 86400_000)
            incident = store.get_incident(transitions.opened[0].id)
        self.assertGreater(len(incident["evidence"]["points"]), 0)
        self.assertEqual(incident["summary"]["rule_id"], "workload-oom-kill")

    def test_internal_service_incidents_remain_owner_only(self):
        engine = IncidentEngine(thresholds())
        service = {"service_id": "frontpage-internal", "status": "down", "visibility": "owner"}
        engine.evaluate(cycle(services=[service]), ())
        opened = engine.evaluate(cycle(NOW + 15_000, services=[service]), ()).opened[0]
        self.assertEqual(opened.visibility, "owner")

    def test_persisted_active_incident_hydrates_without_duplicate_after_restart(self):
        service = {"service_id": "frontpage-public", "status": "down", "visibility": "public"}
        first_engine = IncidentEngine(thresholds())
        first_engine.evaluate(cycle(services=[service]), ())
        opened = first_engine.evaluate(
            cycle(NOW + 15_000, services=[service]), ()
        ).opened
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "metrics.sqlite3"
            store = MetricsStore.open(path)
            store.persist_incidents(type("Transitions", (), {"opened": opened, "updated": (), "recovered": ()})())
            store.close()
            reopened = MetricsStore.open(path)
            active = reopened.read_active_incidents()
            reopened.close()

        self.assertEqual(active[0].id, opened[0].id)
        restarted_engine = IncidentEngine(thresholds())
        restarted_engine.evaluate(cycle(NOW + 30_000, services=[service]), active)
        transitions = restarted_engine.evaluate(
            cycle(NOW + 45_000, services=[service]), active
        )
        self.assertEqual(transitions.opened, ())

    def test_missing_measurements_never_recover_active_incidents(self):
        disk_engine = IncidentEngine(thresholds())
        disk = disk_engine.evaluate(cycle(host={"disk_used_percent": 91}), ()).opened[0]
        self.assertEqual(
            disk_engine.evaluate(cycle(NOW + 15_000, host={}), (disk,)).recovered,
            (),
        )

        oom_engine = IncidentEngine(thresholds())
        oom = oom_engine.evaluate(
            cycle(workloads=[{"workload_id": "frontpage-app", "oom_kill_delta": 1}]),
            (),
        ).opened[0]
        self.assertEqual(
            oom_engine.evaluate(cycle(NOW + 15_000, workloads=[]), (oom,)).recovered,
            (),
        )


if __name__ == "__main__":
    unittest.main()
