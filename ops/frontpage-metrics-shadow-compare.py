#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path


MINUTE_MS = 60_000
WINDOW_MS = 48 * 3_600_000
MAX_EVIDENCE_AGE_SECONDS = 120
GATE_SCHEMA_VERSION = 2


def _minute(timestamp_ms: int) -> int:
    return timestamp_ms // MINUTE_MS * MINUTE_MS


def _next_minute(timestamp_ms: int) -> int:
    return (timestamp_ms + MINUTE_MS - 1) // MINUTE_MS * MINUTE_MS


def _timestamp_ms(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def _timestamp(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, timezone.utc).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")


def _p99(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * 0.99) - 1)]


def _relative_percent(left: float, right: float) -> float:
    denominator = max(abs(left), abs(right), 1e-9)
    return abs(left - right) / denominator * 100


def _metric(payload: dict[str, object], key: str) -> float:
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{key} is unavailable")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{key} is unavailable")
    return result


def _v1_points(path: Path):
    payload = json.loads(path.read_text())
    result = {}
    services = {}
    for sample in payload.get("samples", []):
        minute = _minute(_timestamp_ms(sample["collected_at"]))
        host = sample["host"]
        result[minute] = {
            "cpu": float(host["cpu_percent"]),
            "ram": float(host["ram_used_bytes"]),
            "disk": float(host["disk_used_bytes"]) / max(float(host["disk_total_bytes"]), 1) * 100,
        }
        services[minute] = {
            service["id"]: service["status"]
            for service in sample.get("services", [])
            if service.get("visibility") == "public"
        }
    return result, services


def _v2_points(path: Path):
    connection = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
    try:
        host = {}
        observed_host_minutes = set()
        incomplete_host_minutes = set()
        for timestamp_ms, payload_json in connection.execute(
            "SELECT ts_ms,payload_json FROM host_points WHERE tier='1m' ORDER BY ts_ms"
        ):
            payload = json.loads(payload_json)
            minute = _minute(int(timestamp_ms))
            observed_host_minutes.add(minute)
            try:
                host[minute] = {
                    "cpu": _metric(payload, "cpu_percent"),
                    "ram": _metric(payload, "memory_used_bytes"),
                    "disk": _metric(payload, "disk_used_percent"),
                }
            except ValueError:
                incomplete_host_minutes.add(minute)
        services = {}
        for timestamp_ms, service_id, payload_json in connection.execute(
            "SELECT ts_ms,service_id,payload_json FROM service_points WHERE tier='1m' ORDER BY ts_ms,service_id"
        ):
            payload = json.loads(payload_json)
            if payload.get("visibility") == "public":
                services.setdefault(_minute(int(timestamp_ms)), {})[service_id] = payload.get(
                    "status", "unknown"
                )
        return host, services, observed_host_minutes, incomplete_host_minutes
    finally:
        connection.close()


def compare(
    v1_history: Path,
    v2_database: Path,
    projection_root: Path | None = None,
    *,
    evidence_start_ms: int | None = None,
    now_ms: int | None = None,
) -> dict[str, object]:
    generated_ms = now_ms if now_ms is not None else int(datetime.now(timezone.utc).timestamp() * 1000)
    v1_host, v1_services = _v1_points(v1_history)
    v2_host, v2_services, v2_observed, v2_incomplete = _v2_points(v2_database)
    v1_observed = set(v1_host)
    effective_epoch = _next_minute(
        evidence_start_ms
        if evidence_start_ms is not None
        else max(min(v1_observed, default=0), min(v2_observed, default=0))
    )
    overlap_end = (
        min(max(v1_observed), max(v2_observed))
        if v1_observed and v2_observed
        else None
    )
    window_start = (
        max(effective_epoch, overlap_end - WINDOW_MS)
        if overlap_end is not None and overlap_end >= effective_epoch
        else None
    )
    paired = (
        sorted(
            timestamp
            for timestamp in set(v1_host).intersection(v2_host)
            if window_start <= timestamp <= overlap_end
        )
        if window_start is not None and overlap_end is not None
        else []
    )
    divergences = {
        metric: [_relative_percent(v1_host[timestamp][metric], v2_host[timestamp][metric]) for timestamp in paired]
        for metric in ("cpu", "ram", "disk")
    }
    service_comparisons = 0
    service_mismatches = 0
    expected_service_ids = set()
    for timestamp in paired:
        expected_service_ids.update(v1_services.get(timestamp, {}))
        expected_service_ids.update(v2_services.get(timestamp, {}))
    for timestamp in paired:
        for service_id in expected_service_ids:
            service_comparisons += 1
            left = v1_services.get(timestamp, {}).get(service_id)
            right = v2_services.get(timestamp, {}).get(service_id)
            service_mismatches += left is None or right is None or left != right
    duration_hours = (
        0.0
        if window_start is None or overlap_end is None
        else (overlap_end - window_start) / 3_600_000
    )
    expected_minutes = (
        0
        if window_start is None or overlap_end is None
        else int((overlap_end - window_start) / MINUTE_MS) + 1
    )
    if window_start is None or overlap_end is None:
        maximum_gap_seconds = 0
    else:
        boundaries = [window_start - MINUTE_MS, *paired, overlap_end + MINUTE_MS]
        maximum_gap_seconds = max(
            (current - previous) // 1000
            for previous, current in zip(boundaries, boundaries[1:])
        )
    missed_minutes = max(0, expected_minutes - len(paired))
    incomplete_v2_host_minutes = (
        0
        if window_start is None or overlap_end is None
        else sum(window_start <= timestamp <= overlap_end for timestamp in v2_incomplete)
    )
    total_incomplete_v2_host_minutes = sum(timestamp >= effective_epoch for timestamp in v2_incomplete)
    evidence_age_seconds = (
        None if overlap_end is None else round((generated_ms - overlap_end) / 1000, 3)
    )
    p99 = {metric: _p99(values) for metric, values in divergences.items()}
    service_mismatch_percent = (
        0.0 if service_comparisons == 0 else service_mismatches / service_comparisons * 100
    )
    approved = (
        duration_hours >= 48
        and missed_minutes == 0
        and maximum_gap_seconds <= 120
        and evidence_age_seconds is not None
        and 0 <= evidence_age_seconds <= MAX_EVIDENCE_AGE_SECONDS
        and all(value is not None and value < 2 for value in p99.values())
        and service_comparisons > 0
        and service_mismatch_percent == 0
    )
    projection_size = 0
    if projection_root and projection_root.exists():
        projection_size = sum(path.stat().st_size for path in projection_root.rglob("*.json"))
    database_size = sum(
        candidate.stat().st_size
        for candidate in (
            v2_database,
            Path(f"{v2_database}-wal"),
            Path(f"{v2_database}-shm"),
        )
        if candidate.exists()
    )
    return {
        "schema_version": GATE_SCHEMA_VERSION,
        "generated_at": _timestamp(generated_ms),
        "approved": approved,
        "evidence_started_at": _timestamp(effective_epoch),
        "window_started_at": None if window_start is None else _timestamp(window_start),
        "window_ended_at": None if overlap_end is None else _timestamp(overlap_end),
        "evidence_age_seconds": evidence_age_seconds,
        "duration_hours": round(duration_hours, 3),
        "paired_minutes": len(paired),
        "missed_minutes": missed_minutes,
        "incomplete_v2_host_minutes": incomplete_v2_host_minutes,
        "total_incomplete_v2_host_minutes_since_epoch": total_incomplete_v2_host_minutes,
        "maximum_gap_seconds": maximum_gap_seconds,
        "p99_relative_divergence_percent": p99,
        "public_service_comparisons": service_comparisons,
        "public_service_mismatch_percent": service_mismatch_percent,
        "database_size_bytes": database_size,
        "projection_size_bytes": projection_size,
        "thresholds": {
            "minimum_duration_hours": 48,
            "maximum_gap_seconds": 120,
            "maximum_evidence_age_seconds": MAX_EVIDENCE_AGE_SECONDS,
            "maximum_p99_relative_divergence_percent": 2,
            "public_service_mismatch_percent": 0,
        },
    }


def _load_evidence_epoch(path: Path) -> tuple[dict[str, object], int]:
    payload = json.loads(path.read_text())
    required = {"schema_version", "started_at", "commit_sha", "reason"}
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Evidence epoch must contain the exact required fields")
    if payload["schema_version"] != 1:
        raise ValueError("Unsupported evidence epoch schema")
    if not isinstance(payload["started_at"], str):
        raise ValueError("Evidence epoch started_at must be a timestamp")
    if not isinstance(payload["commit_sha"], str) or not re.fullmatch(
        r"[a-f0-9]{40}", payload["commit_sha"]
    ):
        raise ValueError("Evidence epoch commit_sha must be a full Git SHA")
    if payload["reason"] != "collector_or_comparator_change":
        raise ValueError("Evidence epoch reason is invalid")
    return payload, _timestamp_ms(payload["started_at"])


def _atomic_write(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o640)
        with os.fdopen(descriptor, "w") as handle:
            descriptor = -1
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--v1-history", type=Path, required=True)
    parser.add_argument("--v2-database", type=Path, required=True)
    parser.add_argument("--projection-root", type=Path)
    parser.add_argument("--evidence-epoch", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evidence_epoch, evidence_start_ms = _load_evidence_epoch(args.evidence_epoch)
    result = compare(
        args.v1_history,
        args.v2_database,
        args.projection_root,
        evidence_start_ms=evidence_start_ms,
    )
    result["evidence_epoch"] = evidence_epoch
    _atomic_write(args.output, result)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["approved"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
