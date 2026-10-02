from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from typing import Callable

from .incidents import IncidentRecord


def run_aligned(collect, stop_event, interval_seconds=15, wall_clock_ms=lambda: int(time.time() * 1000)):
    """Use UTC slots; overruns leave gaps instead of shifting the cadence."""
    interval_ms = int(interval_seconds * 1000)
    while not stop_event.is_set():
        now = wall_clock_ms()
        deadline = (now // interval_ms + 1) * interval_ms
        if stop_event.wait(max(0, (deadline - now) / 1000)):
            return
        skip = collect()
        if skip:
            stop_event.wait(max(0, (deadline + interval_ms - wall_clock_ms()) / 1000))


@dataclass(frozen=True)
class DaemonCycleResult:
    duration_seconds: float
    skip_next_cycle: bool


class CollectorDaemon:
    def __init__(
        self,
        collector,
        store,
        incident_engine,
        publisher,
        *,
        interval_seconds: float = 15.0,
        monotonic: Callable[[], float] = time.monotonic,
        wall_clock_ms: Callable[[], int] = lambda: int(time.time() * 1000),
        projection_builder: Callable[[object], object] = lambda snapshot: snapshot,
        active_incidents: tuple[IncidentRecord, ...] = (),
    ) -> None:
        self.collector = collector
        self.store = store
        self.incident_engine = incident_engine
        self.publisher = publisher
        self.interval_seconds = interval_seconds
        self.monotonic = monotonic
        self.wall_clock_ms = wall_clock_ms
        self.projection_builder = projection_builder
        self.active_incidents = active_incidents

    def _evaluate(self, cycle):
        return self.incident_engine.evaluate(cycle, self.active_incidents)

    def _apply_transitions(self, transitions) -> None:
        active = {incident.id: incident for incident in self.active_incidents}
        for incident in (*transitions.opened, *transitions.updated):
            active[incident.id] = incident
        for incident in transitions.recovered:
            active.pop(incident.id, None)
        self.active_incidents = tuple(active.values())

    def run_once(self) -> DaemonCycleResult:
        started = self.monotonic()
        cycle = self.collector.collect_cycle(self.wall_clock_ms())
        collected = self.monotonic()
        checkpoint = self.incident_engine.checkpoint()
        try:
            status, transitions, snapshot = self.store.commit_cycle(
                cycle,
                self._evaluate,
                int(cycle["ts_ms"]),
            )
        except Exception:
            self.incident_engine.restore(checkpoint)
            raise
        self._apply_transitions(transitions)
        read = self.monotonic()
        projection = self.projection_builder(snapshot)
        built = self.monotonic()
        self.publisher.publish(projection)
        published = self.monotonic()
        if published - started >= self.interval_seconds or status.skip_next_cycle:
            print(json.dumps({
                "event": "frontpage_metrics_cycle_slow", "ts_ms": cycle["ts_ms"],
                "collection_seconds": collected - started,
                "database_seconds": status.duration_seconds,
                "projection_read_seconds": max(0, read - collected - status.duration_seconds),
                "build_seconds": built - read, "publish_seconds": published - built,
                "total_seconds": published - started, "database_backpressure": status.skip_next_cycle,
            }), file=sys.stderr, flush=True)
        return DaemonCycleResult(status.duration_seconds, status.skip_next_cycle)

    def run_forever(self, stop_event) -> None:
        if stop_event.is_set():
            return
        # Prime counters without publishing a partial boot sample.
        self.collector.collect_cycle(self.wall_clock_ms())
        run_aligned(lambda: self.run_once().skip_next_cycle, stop_event,
                    self.interval_seconds, self.wall_clock_ms)
