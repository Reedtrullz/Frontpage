from __future__ import annotations

from dataclasses import dataclass
from statistics import fmean
from typing import Mapping, Sequence


@dataclass(frozen=True)
class GaugeRollup:
    minimum: float | None
    maximum: float | None
    mean: float | None
    last: float | None
    sample_count: int
    coverage_percent: float


@dataclass(frozen=True)
class CounterRollup:
    sum_delta: float
    mean_rate: float | None
    maximum_rate: float | None
    last_counter: float | None
    reset_count: int
    sample_count: int
    coverage_percent: float


@dataclass(frozen=True)
class ServiceRollup:
    up_count: int
    down_count: int
    unknown_count: int
    availability_percent: float | None
    coverage_percent: float
    last_state: str | None
    transitions: int


@dataclass(frozen=True)
class RollupBucket:
    expected_samples: int
    interval_seconds: float


def _coverage(sample_count: int, expected_samples: int) -> float:
    if expected_samples <= 0:
        raise ValueError("expected_samples must be positive")
    return min(100.0, sample_count * 100 / expected_samples)


def rollup_gauge(values: Sequence[float | int | None], expected_samples: int) -> GaugeRollup:
    present = [float(value) for value in values if value is not None]
    if not present:
        return GaugeRollup(None, None, None, None, 0, 0.0)
    return GaugeRollup(
        min(present),
        max(present),
        fmean(present),
        next(float(value) for value in reversed(values) if value is not None),
        len(present),
        _coverage(len(present), expected_samples),
    )


def rollup_counter(
    values: Sequence[float | int | None],
    expected_samples: int,
    interval_seconds: float,
) -> CounterRollup:
    if interval_seconds <= 0:
        raise ValueError("interval_seconds must be positive")
    deltas: list[float] = []
    reset_count = 0
    for before, current in zip(values, values[1:]):
        if before is None or current is None:
            continue
        if current < before:
            reset_count += 1
            continue
        deltas.append(float(current) - float(before))
    rates = [delta / interval_seconds for delta in deltas]
    present = [float(value) for value in values if value is not None]
    return CounterRollup(
        sum(deltas),
        fmean(rates) if rates else None,
        max(rates) if rates else None,
        present[-1] if present else None,
        reset_count,
        len(present),
        _coverage(len(present), expected_samples),
    )


def _rollup_service_states(states: Sequence[str | None], expected_samples: int) -> ServiceRollup:
    up = sum(state == "up" for state in states)
    down = sum(state == "down" for state in states)
    unknown = sum(state in {None, "unknown"} for state in states)
    known = up + down
    transitions = 0
    previous = None
    for state in states:
        if state not in {"up", "down"}:
            previous = None
            continue
        if previous is not None and state != previous:
            transitions += 1
        previous = state
    last = next((state for state in reversed(states) if state is not None), None)
    return ServiceRollup(
        up,
        down,
        unknown,
        None if known == 0 else up / known * 100,
        _coverage(known, expected_samples),
        last,
        transitions,
    )


def rollup_service(points, bucket=None, *, expected_samples=None):
    if expected_samples is not None:
        return _rollup_service_states(points, expected_samples)
    if isinstance(bucket, int):
        return _rollup_service_states(points, bucket)
    if bucket is None:
        raise ValueError("rollup_service requires a bucket or expected_samples")
    grouped: dict[str, list[str | None]] = {}
    for point in points:
        grouped.setdefault(str(point["service_id"]), []).append(point.get("status"))
    return {
        service_id: _rollup_service_states(states, bucket.expected_samples)
        for service_id, states in grouped.items()
    }


def bucket_start_ms(timestamp_ms: int, bucket_seconds: int) -> int:
    if bucket_seconds <= 0:
        raise ValueError("bucket_seconds must be positive")
    size = bucket_seconds * 1000
    return timestamp_ms // size * size


def _rollup_metric_records(
    points: Sequence[Mapping[str, object]],
    expected_samples: int,
    interval_seconds: float,
) -> dict[str, object]:
    gauge_names = sorted({key for point in points for key in point.get("gauges", {})})
    counter_names = sorted({key for point in points for key in point.get("counters", {})})
    return {
        "gauges": {
            name: rollup_gauge([point.get("gauges", {}).get(name) for point in points], expected_samples)
            for name in gauge_names
        },
        "counters": {
            name: rollup_counter(
                [point.get("counters", {}).get(name) for point in points],
                expected_samples,
                interval_seconds,
            )
            for name in counter_names
        },
    }


def rollup_host(points, bucket):
    return _rollup_metric_records(points, bucket.expected_samples, bucket.interval_seconds)


def rollup_workload(points, bucket):
    return _rollup_metric_records(points, bucket.expected_samples, bucket.interval_seconds)
