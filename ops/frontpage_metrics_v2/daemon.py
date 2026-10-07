from __future__ import annotations

import json
import sys
import time
import queue
import threading
from concurrent.futures import TimeoutError as FutureTimeout
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


def run_pipeline(acquire, consume, stop_event, *, interval_seconds=15,
                 wall_clock_ms=lambda: int(time.time() * 1000), capacity=4,
                 aligned=None):
    """Acquire real UTC slots independently; one consumer owns persistence."""
    if isinstance(capacity, bool) or not isinstance(capacity, int) or capacity <= 0:
        raise ValueError("Pipeline capacity must be a positive integer")
    pending = queue.Queue(maxsize=capacity)
    backpressure = threading.Event()
    finished = threading.Event()
    errors = []

    def sample(now_ms=None):
        now_ms = wall_clock_ms() if now_ms is None else now_ms
        if backpressure.is_set():
            backpressure.clear()
            print(json.dumps({"event": "frontpage_metrics_acquisition_skipped",
                              "ts_ms": now_ms, "reason": "database_backpressure"}),
                  file=sys.stderr, flush=True)
            return False
        if pending.full():
            print(json.dumps({"event": "frontpage_metrics_acquisition_skipped",
                              "ts_ms": now_ms, "reason": "queue_full"}),
                  file=sys.stderr, flush=True)
            return False
        row = acquire(now_ms)
        pending.put_nowait(row)
        return False

    def produce():
        try:
            (aligned or run_aligned)(sample, stop_event, interval_seconds, wall_clock_ms)
        except BaseException as error:
            errors.append(error)
            stop_event.set()
        finally:
            finished.set()

    producer = threading.Thread(target=produce, name="frontpage-host-sampler", daemon=True)
    producer.start()
    try:
        while not finished.is_set() or not pending.empty():
            if errors:
                raise errors[0]
            try:
                row = pending.get(timeout=0.1)
            except queue.Empty:
                continue
            if consume(row):
                backpressure.set()
        if errors:
            raise errors[0]
    finally:
        stop_event.set()
        producer.join()


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
        return self.persist_cycle(cycle, started=started, collected=collected)

    def persist_cycle(self, cycle, *, started=None, collected=None, pipeline_timings=None) -> DaemonCycleResult:
        started = self.monotonic() if started is None else started
        collected = started if collected is None else collected
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
                **(pipeline_timings or {}),
            }), file=sys.stderr, flush=True)
        return DaemonCycleResult(status.duration_seconds, status.skip_next_cycle)

    def run_sampled(self, stop_event, service_batches) -> None:
        if stop_event.is_set():
            return
        self.collector.collect_observations(self.wall_clock_ms())

        def acquire(now_ms):
            started = self.monotonic()
            services = service_batches.start(now_ms)
            cycle = self.collector.collect_observations(now_ms)
            return cycle, services, started, self.monotonic()

        def consume(pending):
            cycle, services, started, acquired = pending
            dequeued = self.monotonic()
            while True:
                if stop_event.is_set():
                    print(json.dumps({"event": "frontpage_metrics_acquisition_abandoned",
                                      "ts_ms": cycle["ts_ms"], "reason": "shutdown"}), file=sys.stderr, flush=True)
                    raise InterruptedError("Collector stopping")
                try:
                    service_rows = services.result(timeout=0.1)
                    break
                except FutureTimeout:
                    continue
            self.collector.complete_cycle(cycle, service_rows)
            collected = self.monotonic()
            return self.persist_cycle(cycle, started=started, collected=collected, pipeline_timings={
                "acquisition_seconds": acquired - started, "queue_wait_seconds": dequeued - acquired,
                "service_wait_seconds": collected - dequeued, "collection_includes_queue": True,
            }).skip_next_cycle

        try:
            run_pipeline(acquire, consume, stop_event, interval_seconds=self.interval_seconds,
                         wall_clock_ms=self.wall_clock_ms)
        except InterruptedError:
            if not stop_event.is_set():
                raise

    def run_forever(self, stop_event) -> None:
        if stop_event.is_set():
            return
        # Prime counters without publishing a partial boot sample.
        self.collector.collect_cycle(self.wall_clock_ms())
        run_aligned(lambda: self.run_once().skip_next_cycle, stop_event,
                    self.interval_seconds, self.wall_clock_ms)
