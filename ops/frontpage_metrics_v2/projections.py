from __future__ import annotations

from datetime import datetime, timezone
from collections import defaultdict
from typing import Mapping, Sequence


def _timestamp(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _resource_state(value: float | None, warning: float, critical: float) -> str:
    if value is None:
        return "unknown"
    if value >= critical:
        return "critical"
    if value >= warning:
        return "watch"
    return "healthy"


def _latest_by(rows, key):
    result = {}
    for row in rows:
        result[row[key]] = row
    return result


def _disk_rate(payload: Mapping[str, object]) -> float:
    return float(sum(
        values.get("read_bytes_per_second", 0) + values.get("write_bytes_per_second", 0)
        for values in payload.get("disk_rates", {}).values()
    ))


def _network_rate(payload: Mapping[str, object]) -> float:
    return float(sum(
        values.get("receive_bytes_per_second", 0) + values.get("transmit_bytes_per_second", 0)
        for values in payload.get("network_rates", {}).values()
    ))


def _host_value(payload: Mapping[str, object], resource: str) -> float | None:
    if resource == "cpu":
        return payload.get("cpu_percent")
    if resource == "ram":
        return payload.get("memory_used_bytes")
    if resource == "disk_io":
        return _disk_rate(payload)
    if resource == "network":
        return _network_rate(payload)
    raise ValueError(f"Unknown resource: {resource}")


def _workload_value(payload: Mapping[str, object], resource: str) -> float | None:
    if resource == "cpu":
        return payload.get("cpu_percent")
    if resource == "ram":
        return payload.get("memory_current_bytes")
    if resource == "disk_io":
        return float(
            (payload.get("io_read_bytes_per_second") or 0)
            + (payload.get("io_write_bytes_per_second") or 0)
        )
    raise ValueError(f"Unsupported workload resource: {resource}")


def _day(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, timezone.utc).strftime("%Y-%m-%d")


def _host_series(rows: Sequence[Mapping[str, object]], generated_at: str, range_name: str, resolution: int) -> dict[str, object]:
    ordered = sorted(rows, key=lambda row: row["ts_ms"])
    resources = (
        ("cpu", "cpu-total", "CPU total", "percent"),
        ("ram", "ram-used", "RAM used", "bytes"),
        ("disk_io", "disk-io-total", "Disk I/O total", "bytes_per_second"),
        ("network", "network-total", "Network total", "bytes_per_second"),
    )
    return {
        "schema_version": 2,
        "generated_at": generated_at,
        "range": range_name,
        "resolution_seconds": resolution,
        "view": "host",
        "resource": None,
        "timestamps": [_timestamp(row["ts_ms"]) for row in ordered],
        "series": [
            {
                "id": series_id,
                "label": label,
                "unit": unit,
                "values": [_host_value(row["payload"], resource) for row in ordered],
            }
            for resource, series_id, label, unit in resources
        ],
        "coverage_percent": (
            sum(row["coverage_percent"] for row in ordered) / len(ordered)
            if ordered else 0
        ),
        "truncated": False,
    }


def _workload_series(
    workload_rows: Sequence[Mapping[str, object]],
    host_rows: Sequence[Mapping[str, object]],
    generated_at: str,
    range_name: str,
    resolution: int,
    resource: str,
) -> dict[str, object] | None:
    timestamps = sorted({row["ts_ms"] for row in host_rows})
    if not timestamps:
        return None
    by_workload: dict[str, dict[int, Mapping[str, object]]] = defaultdict(dict)
    labels: dict[str, str] = {}
    for row in workload_rows:
        by_workload[row["workload_id"]][row["ts_ms"]] = row
        labels[row["workload_id"]] = row["payload"].get("label", row["workload_id"])
    series = []
    attributed_by_timestamp = {timestamp: 0.0 for timestamp in timestamps}
    for workload_id, rows in by_workload.items():
        values = []
        for timestamp in timestamps:
            row = rows.get(timestamp)
            value = None if row is None else _workload_value(row["payload"], resource)
            values.append(value)
            if value is not None:
                attributed_by_timestamp[timestamp] += float(value)
        series.append({
            "id": workload_id,
            "label": labels[workload_id],
            "unit": "percent" if resource == "cpu" else "bytes" if resource == "ram" else "bytes_per_second",
            "values": values,
        })
    host_by_timestamp = {row["ts_ms"]: row for row in host_rows}
    residual_values = []
    for timestamp in timestamps:
        host_value = _host_value(host_by_timestamp[timestamp]["payload"], resource)
        residual_values.append(
            None if host_value is None else max(0.0, float(host_value) - attributed_by_timestamp[timestamp])
        )
    unit = "percent" if resource == "cpu" else "bytes" if resource == "ram" else "bytes_per_second"
    series.sort(
        key=lambda item: max((float(value) for value in item["values"] if value is not None), default=0.0),
        reverse=True,
    )
    truncated = len(series) > 16
    series = series[:16]
    series.append({"id": "system-untracked", "label": "system/untracked", "unit": unit, "values": residual_values})
    return {
        "schema_version": 2,
        "generated_at": generated_at,
        "range": range_name,
        "resolution_seconds": resolution,
        "view": "workloads",
        "resource": resource,
        "timestamps": [_timestamp(timestamp) for timestamp in timestamps],
        "series": series,
        "coverage_percent": sum(row["coverage_percent"] for row in host_rows) / len(host_rows),
        "truncated": truncated,
    }


def _series_files(host_rows, workload_rows, generated_at):
    owner_files = {}
    manifest_files = []
    tiers = (
        ("15s", "1h", 15, "1h.v2.json"),
        ("1m", "24h", 60, "minute"),
        ("15m", "30d", 900, "quarter-hour"),
    )
    for tier, range_name, resolution, destination in tiers:
        tier_host = [row for row in host_rows if row["tier"] == tier]
        tier_workloads = [row for row in workload_rows if row["tier"] == tier]
        groups = {None: tier_host} if tier == "15s" else {
            day: [row for row in tier_host if _day(row["ts_ms"]) == day]
            for day in sorted({_day(row["ts_ms"]) for row in tier_host})
        }
        for day, grouped_host in groups.items():
            if not grouped_host:
                continue
            suffix = destination if day is None else f"{destination}/{day}.v2.json"
            host_path = f"host/{suffix}"
            owner_files[host_path] = _host_series(grouped_host, generated_at, range_name, resolution)
            manifest_files.append(host_path)
            timestamps = {row["ts_ms"] for row in grouped_host}
            grouped_workloads = [row for row in tier_workloads if row["ts_ms"] in timestamps]
            for resource in ("cpu", "ram", "disk_io"):
                workload_projection = _workload_series(
                    grouped_workloads,
                    grouped_host,
                    generated_at,
                    range_name,
                    resolution,
                    resource,
                )
                if workload_projection is None:
                    continue
                workload_path = f"workloads/{resource}/{suffix}"
                owner_files[workload_path] = workload_projection
                manifest_files.append(workload_path)
    return owner_files, manifest_files


def _incident_payload(row: Mapping[str, object], *, public: bool) -> dict[str, object]:
    summary = row["summary"]
    payload = {
        "id": row["id"],
        "rule_id": summary.get("rule_id", "collector-freshness"),
        "title": summary.get("title", "Observability incident"),
        "severity": summary.get("severity", "warning"),
        "state": row["state"],
        "visibility": row["visibility"],
        "resource": summary.get("resource"),
        "opened_at": _timestamp(row["opened_at_ms"]),
        "updated_at": _timestamp(summary.get("updated_at_ms", row["opened_at_ms"])),
        "coverage_percent": float(row["evidence"].get("coverage_percent", 100)),
        "capability_state": row["evidence"].get("capability_state", "available"),
        "summary": summary.get("title", "Observability incident"),
    }
    if row.get("recovered_at_ms") is not None:
        payload["resolved_at"] = _timestamp(row["recovered_at_ms"])
    if not public:
        target_id = summary.get("target_id")
        if target_id and summary.get("rule_id") == "workload-oom-kill":
            payload["workload_id"] = target_id
        payload["evidence"] = {
            "trigger_value": row["evidence"].get("trigger_value"),
            "threshold_value": row["evidence"].get("threshold_value"),
            "peak_value": row["evidence"].get("peak_value"),
            "points": [
                {"recorded_at": _timestamp(point["recorded_at_ms"]), "value": point.get("value")}
                for point in row["evidence"].get("points", [])
            ],
        }
    return payload


def build_projection_files(snapshot: Mapping[str, object]) -> dict[str, object]:
    host_rows = snapshot.get("host", [])
    latest_host_row = host_rows[-1] if host_rows else None
    host = latest_host_row["payload"] if latest_host_row else {}
    host_available = bool(
        latest_host_row
        and latest_host_row.get("coverage_percent", 0) > 0
        and host
    )
    collected_ms = latest_host_row["ts_ms"] if latest_host_row else 0
    collected_at = _timestamp(collected_ms)
    generated_at = _timestamp(collected_ms)
    services = list(_latest_by(snapshot.get("services", []), "service_id").values())
    workloads = list(_latest_by(snapshot.get("workloads", []), "workload_id").values())

    memory_total = host.get("memory_total_bytes", 0)
    memory_used = host.get("memory_used_bytes")
    memory_percent = None if not memory_total or memory_used is None else memory_used / memory_total * 100
    disk_percent = host.get("disk_used_percent")
    cpu = host.get("cpu_percent")
    disk_rate = _disk_rate(host)
    network_rate = _network_rate(host)
    public_resources = [
        {"resource": "cpu", "label": "CPU", "state": _resource_state(cpu, 75, 90), "coverage_percent": latest_host_row["coverage_percent"] if latest_host_row else 0},
        {"resource": "ram", "label": "RAM", "state": _resource_state(memory_percent, 80, 90), "coverage_percent": latest_host_row["coverage_percent"] if latest_host_row else 0},
        {"resource": "disk_io", "label": "Disk", "state": _resource_state(disk_percent, 80, 90), "coverage_percent": latest_host_row["coverage_percent"] if latest_host_row else 0},
        {"resource": "network", "label": "Network", "state": "healthy" if host_available else "unknown", "coverage_percent": latest_host_row["coverage_percent"] if latest_host_row else 0},
    ]
    public_services = [
        {
            "id": row["service_id"],
            "label": row["payload"].get("label", row["service_id"]),
            "status": row["payload"].get("status", "unknown"),
            "checked_at": _timestamp(row["payload"].get("checked_at_ms", row["ts_ms"])),
            "latency_ms": row["payload"].get("latency_ms"),
            "availability_percent": None,
            "coverage_percent": 100,
        }
        for row in services
        if row["payload"].get("visibility") == "public"
    ]
    overall = "disruption" if any(service["status"] == "down" for service in public_services) else "degraded" if any(service["status"] == "unknown" for service in public_services) else "operational"
    public_latest = {
        "schema_version": 2,
        "generated_at": generated_at,
        "collected_at": collected_at,
        "freshness": "fresh" if host_available else "unavailable",
        "overall_state": overall if host_available else "unknown",
        "resources": public_resources,
        "services": public_services,
    }

    exact_totals = [
        ("cpu", "CPU total", "percent", float(cpu or 0), "available"),
        ("ram", "RAM total", "bytes", float(memory_used or 0), "available"),
        ("disk_io", "Disk I/O", "bytes_per_second", float(disk_rate), "available"),
        ("network", "Network total", "bytes_per_second", float(network_rate), "unavailable"),
    ]
    owner_totals = [
        {
            "resource": resource,
            "label": label,
            "unit": unit,
            "current": value,
            "average": value,
            "peak": value,
            "state": public_resources[index]["state"],
            "freshness": "fresh" if host_available else "unavailable",
            "updated_at": collected_at,
            "attribution_coverage_percent": 0,
            "reconciliation_error_percent": 0,
            "workload_view": workload_view,
        }
        for index, (resource, label, unit, value, workload_view) in enumerate(exact_totals)
    ]
    owner_workloads = []
    for row in workloads:
        payload = row["payload"]
        resources = [
            {"resource": "cpu", "unit": "percent", "current": float(payload.get("cpu_percent") or 0), "average": float(payload.get("cpu_percent") or 0), "peak": float(payload.get("cpu_percent") or 0), "change_1h": None, "coverage_percent": row["coverage_percent"]},
            {"resource": "ram", "unit": "bytes", "current": float(payload.get("memory_current_bytes", 0)), "average": float(payload.get("memory_current_bytes", 0)), "peak": float(payload.get("memory_current_bytes", 0)), "change_1h": None, "coverage_percent": row["coverage_percent"]},
            {"resource": "disk_io", "unit": "bytes_per_second", "current": float((payload.get("io_read_bytes_per_second") or 0) + (payload.get("io_write_bytes_per_second") or 0)), "average": float((payload.get("io_read_bytes_per_second") or 0) + (payload.get("io_write_bytes_per_second") or 0)), "peak": float((payload.get("io_read_bytes_per_second") or 0) + (payload.get("io_write_bytes_per_second") or 0)), "change_1h": None, "coverage_percent": row["coverage_percent"]},
        ]
        owner_workloads.append(
            {
                "id": row["workload_id"],
                "label": payload.get("label", row["workload_id"]),
                "kind": payload.get("kind", "systemd"),
                "cgroup_path": payload.get("cgroup_path"),
                "resources": resources,
                "processes": payload.get("processes", [])[:20],
            }
        )

    host_values = {"cpu": float(cpu or 0), "ram": float(memory_used or 0), "disk_io": float(disk_rate)}
    attributed = {"cpu": 0.0, "ram": 0.0, "disk_io": 0.0}
    for workload in owner_workloads:
        for resource in workload["resources"]:
            attributed[resource["resource"]] += float(resource["current"])
    residual_resources = []
    for resource_name, unit in (("cpu", "percent"), ("ram", "bytes"), ("disk_io", "bytes_per_second")):
        residual = max(0.0, host_values[resource_name] - attributed[resource_name])
        residual_resources.append(
            {"resource": resource_name, "unit": unit, "current": residual, "average": residual, "peak": residual, "change_1h": None, "coverage_percent": latest_host_row["coverage_percent"] if latest_host_row else 0}
        )
        denominator = host_values[resource_name]
        coverage = 0 if denominator <= 0 else min(100.0, attributed[resource_name] / denominator * 100)
        next(total for total in owner_totals if total["resource"] == resource_name)["attribution_coverage_percent"] = coverage
    owner_workloads.append(
        {"id": "system-untracked", "label": "system/untracked", "kind": "residual", "resources": residual_resources, "processes": []}
    )

    owner_incidents = [_incident_payload(row, public=False) for row in snapshot.get("incidents", [])]
    public_incidents = [_incident_payload(row, public=True) for row in snapshot.get("incidents", []) if row["visibility"] == "public"]
    owner_latest = {
        "schema_version": 2,
        "generated_at": generated_at,
        "collected_at": collected_at,
        "freshness": "fresh" if host_available else "unavailable",
        "host": {
            "totals": owner_totals,
            "capabilities": [
                {"id": row["key"], "label": row["key"].replace("-", " ").title(), "state": row["state"], "detail": row["detail"]}
                for row in snapshot.get("capabilities", [])[:8]
            ],
        },
        "workloads": owner_workloads,
        "diagnostics": [
            {"id": f"source-error-{index + 1}", "severity": "warning", "message": message}
            for index, message in enumerate(host.get("source_errors", [])[:32])
        ],
        "incidents": owner_incidents[:256],
    }
    series_files, series_manifest = _series_files(host_rows, snapshot.get("workloads", []), generated_at)
    incident_list_owner = {"schema_version": 2, "generated_at": generated_at, "incidents": owner_incidents[:256]}
    incident_list_public = {"schema_version": 2, "generated_at": generated_at, "incidents": public_incidents[:256]}
    owner_files = {
        "latest.v2.json": owner_latest,
        "incidents.v2.json": incident_list_owner,
        **series_files,
        "manifest.v2.json": {"schema_version": 2, "files": ["latest.v2.json", "incidents.v2.json", *series_manifest]},
    }
    return {
        "public": {"latest.v2.json": public_latest, "incidents.v2.json": incident_list_public},
        "owner": owner_files,
    }
