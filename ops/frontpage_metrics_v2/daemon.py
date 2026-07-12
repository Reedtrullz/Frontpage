from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

from .incidents import IncidentRecord


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
    ) -> None:
        self.collector = collector
        self.store = store
        self.incident_engine = incident_engine
        self.publisher = publisher
        self.interval_seconds = interval_seconds
        self.monotonic = monotonic
        self.wall_clock_ms = wall_clock_ms
        self.projection_builder = projection_builder
        self.active_incidents: tuple[IncidentRecord, ...] = ()

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
        cycle = self.collector.collect_cycle(self.wall_clock_ms())
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
        self.publisher.publish(self.projection_builder(snapshot))
        return DaemonCycleResult(status.duration_seconds, status.skip_next_cycle)

    def run_forever(self, stop_event) -> None:
        if stop_event.is_set():
            return
        deadline = self.monotonic()
        while not stop_event.is_set():
            result = self.run_once()
            deadline += self.interval_seconds * (2 if result.skip_next_cycle else 1)
            now = self.monotonic()
            if now > deadline:
                deadline = now + self.interval_seconds
            stop_event.wait(max(0.0, deadline - now))
