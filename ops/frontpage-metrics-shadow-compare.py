#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def _minute(timestamp_ms: int) -> int:
    return timestamp_ms // 60_000 * 60_000


def _timestamp_ms(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def _p99(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * 0.99) - 1)]


def _relative_percent(left: float, right: float) -> float:
    denominator = max(abs(left), abs(right), 1e-9)
    return abs(left - right) / denominator * 100


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
        for timestamp_ms, payload_json in connection.execute(
            "SELECT ts_ms,payload_json FROM host_points WHERE tier='1m' ORDER BY ts_ms"
        ):
            payload = json.loads(payload_json)
            host[int(timestamp_ms)] = {
                "cpu": float(payload["cpu_percent"]),
                "ram": float(payload["memory_used_bytes"]),
                "disk": float(payload["disk_used_percent"]),
            }
        services = {}
        for timestamp_ms, service_id, payload_json in connection.execute(
            "SELECT ts_ms,service_id,payload_json FROM service_points WHERE tier='1m' ORDER BY ts_ms,service_id"
        ):
            payload = json.loads(payload_json)
            if payload.get("visibility") == "public":
                services.setdefault(int(timestamp_ms), {})[service_id] = payload.get("status", "unknown")
        return host, services
    finally:
        connection.close()


def compare(v1_history: Path, v2_database: Path, projection_root: Path | None = None) -> dict[str, object]:
    v1_host, v1_services = _v1_points(v1_history)
    v2_host, v2_services = _v2_points(v2_database)
    paired = sorted(set(v1_host).intersection(v2_host))
    divergences = {
        metric: [_relative_percent(v1_host[timestamp][metric], v2_host[timestamp][metric]) for timestamp in paired]
        for metric in ("cpu", "ram", "disk")
    }
    service_comparisons = 0
    service_mismatches = 0
    for timestamp in paired:
        for service_id in set(v1_services.get(timestamp, {})).intersection(v2_services.get(timestamp, {})):
            service_comparisons += 1
            service_mismatches += v1_services[timestamp][service_id] != v2_services[timestamp][service_id]
    duration_hours = 0.0 if len(paired) < 2 else (paired[-1] - paired[0]) / 3_600_000
    maximum_gap_seconds = 0 if len(paired) < 2 else max(
        (current - previous) // 1000 for previous, current in zip(paired, paired[1:])
    )
    expected_minutes = 0 if not paired else int((paired[-1] - paired[0]) / 60_000) + 1
    p99 = {metric: _p99(values) for metric, values in divergences.items()}
    service_mismatch_percent = (
        0.0 if service_comparisons == 0 else service_mismatches / service_comparisons * 100
    )
    approved = (
        duration_hours >= 48
        and max(0, expected_minutes - len(paired)) == 0
        and maximum_gap_seconds <= 120
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
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "approved": approved,
        "duration_hours": round(duration_hours, 3),
        "paired_minutes": len(paired),
        "missed_minutes": max(0, expected_minutes - len(paired)),
        "maximum_gap_seconds": maximum_gap_seconds,
        "p99_relative_divergence_percent": p99,
        "public_service_comparisons": service_comparisons,
        "public_service_mismatch_percent": service_mismatch_percent,
        "database_size_bytes": database_size,
        "projection_size_bytes": projection_size,
        "thresholds": {
            "minimum_duration_hours": 48,
            "maximum_gap_seconds": 120,
            "maximum_p99_relative_divergence_percent": 2,
            "public_service_mismatch_percent": 0,
        },
    }


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
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = compare(args.v1_history, args.v2_database, args.projection_root)
    _atomic_write(args.output, result)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["approved"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
