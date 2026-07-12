from __future__ import annotations

import json
import re
import urllib.parse
from pathlib import Path
from typing import Mapping

from .model import CollectorConfig, ThresholdConfig, WorkloadConfig


SCHEMA_VERSION = 2
MAX_WORKLOADS = 32
MAX_SERVICES = 64
MAX_CHECK_PATH_FIELDS = 3
MAX_CHECK_EXPECTED_LENGTH = 80
MAX_PATTERN_LENGTH = 160
FIXED_VALUES = {
    "sample_interval_seconds": 15,
    "raw_seconds": 3600,
    "minute_seconds": 604800,
    "quarter_hour_seconds": 2592000,
    "incident_seconds": 7776000,
}
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
SIMPLE_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,62}$")
DEVICE_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,63}$")


def _object(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _exact_keys(
    value: Mapping[str, object],
    allowed: set[str],
    required: set[str],
    label: str,
) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"Unknown {label} keys: {', '.join(sorted(unknown))}")
    missing = required - set(value)
    if missing:
        raise ValueError(f"Missing {label} keys: {', '.join(sorted(missing))}")


def _id(value: object, label: str) -> str:
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise ValueError(f"Invalid {label} id")
    return value


def _text(value: object, label: str, maximum: int = 80) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ValueError(f"Invalid {label}")
    return value


def _number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Invalid {label}")
    return float(value)


def _fixed(value: object, key: str) -> int:
    expected = FIXED_VALUES[key]
    if isinstance(value, bool) or value != expected:
        raise ValueError(f"{key} must be exactly {expected}")
    return expected


def _validate_url(url: object) -> str:
    value = _text(url, "service URL", 2048)
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Service URL must be http or https")
    if parsed.username or parsed.password:
        raise ValueError("Service URL must not contain credentials")
    if parsed.params or parsed.query or parsed.fragment:
        raise ValueError("Service URL must not contain params, query, or fragment")
    return value


def _validate_check(value: object) -> dict[str, object]:
    check = _object(value, "service check")
    check_type = check.get("type")
    if check_type == "http-status":
        _exact_keys(check, {"type"}, {"type"}, "http-status service check")
        return {"type": "http-status"}
    _exact_keys(
        check,
        {"type", "path", "expected"},
        {"type", "path", "expected"},
        "json-field service check",
    )
    if check_type != "json-field":
        raise ValueError("Invalid service check")
    path = check["path"]
    if (
        not isinstance(path, list)
        or not 1 <= len(path) <= MAX_CHECK_PATH_FIELDS
        or not all(isinstance(item, str) and SIMPLE_NAME_PATTERN.fullmatch(item) for item in path)
    ):
        raise ValueError("Invalid json-field service check path")
    expected = check["expected"]
    if not isinstance(expected, str) or len(expected) > MAX_CHECK_EXPECTED_LENGTH:
        raise ValueError("Invalid json-field service check expected value")
    return {"type": "json-field", "path": list(path), "expected": expected}


def _parse_service(value: object) -> dict[str, object]:
    service = _object(value, "service")
    allowed = {
        "id",
        "label",
        "project_slug",
        "visibility",
        "url",
        "expected_status",
        "timeout_ms",
        "check",
    }
    required = allowed - {"project_slug", "check"}
    _exact_keys(service, allowed, required, "service")
    visibility = service["visibility"]
    if visibility not in {"public", "owner"}:
        raise ValueError("Service visibility must be public or owner")
    status = service["expected_status"]
    if isinstance(status, bool) or not isinstance(status, int) or not 100 <= status <= 599:
        raise ValueError("Invalid expected service status")
    timeout = service["timeout_ms"]
    if isinstance(timeout, bool) or not isinstance(timeout, int):
        raise ValueError("Invalid service timeout")
    normalized: dict[str, object] = {
        "id": _id(service["id"], "service"),
        "label": _text(service["label"], "service label"),
        "visibility": visibility,
        "url": _validate_url(service["url"]),
        "expected_status": status,
        "timeout_ms": max(1000, min(timeout, 10000)),
    }
    project_slug = service.get("project_slug")
    if project_slug is not None:
        normalized["project_slug"] = _id(project_slug, "project slug")
    if "check" in service:
        normalized["check"] = _validate_check(service["check"])
    return normalized


def _parse_workload(value: object) -> WorkloadConfig:
    workload = _object(value, "workload")
    _exact_keys(
        workload,
        {"id", "label", "project_slug", "match"},
        {"id", "label", "match"},
        "workload",
    )
    match = _object(workload["match"], "workload match")
    _exact_keys(match, {"type", "value"}, {"type", "value"}, "workload match")
    match_type = match["type"]
    if match_type not in {"systemd-unit", "cgroup-path", "cgroup-pattern"}:
        raise ValueError("Invalid workload match type")
    raw_match_value = match["value"]
    if not isinstance(raw_match_value, str) or not raw_match_value:
        raise ValueError("Invalid workload match value")
    if len(raw_match_value) > MAX_PATTERN_LENGTH:
        raise ValueError(f"Workload match values may contain at most {MAX_PATTERN_LENGTH} characters")
    match_value = raw_match_value
    if match_type == "cgroup-pattern":
        if not (match_value.startswith("^") and match_value.endswith("$")):
            raise ValueError("Cgroup pattern must be anchored with ^ and $")
        try:
            re.compile(match_value)
        except re.error as error:
            raise ValueError("Invalid cgroup pattern") from error
    elif match_type == "cgroup-path":
        path = Path(match_value)
        if path.is_absolute() or ".." in path.parts or any(char in match_value for char in "*?[]"):
            raise ValueError("Invalid exact cgroup path")
    else:
        if any(char in match_value for char in "*?[]/"):
            raise ValueError("Invalid exact systemd unit")
    project_slug = workload.get("project_slug")
    return WorkloadConfig(
        id=_id(workload["id"], "workload"),
        label=_text(workload["label"], "workload label"),
        match_type=match_type,
        match_value=match_value,
        project_slug=None if project_slug is None else _id(project_slug, "project slug"),
    )


def _unique(items: tuple[object, ...], value_for, label: str) -> None:
    seen: set[str] = set()
    for item in items:
        value = value_for(item)
        if value in seen:
            raise ValueError(f"Duplicate {label} id: {value}")
        seen.add(value)


def _parse_paths(value: object) -> dict[str, object]:
    paths = _object(value, "paths")
    keys = {
        "public_dir",
        "owner_dir",
        "database_path",
        "runtime_map_path",
        "root_filesystems",
        "block_devices",
        "network_interfaces",
    }
    _exact_keys(paths, keys, keys, "paths")
    result: dict[str, object] = {}
    for key in ("public_dir", "owner_dir", "database_path", "runtime_map_path"):
        path = Path(_text(paths[key], key, 4096))
        if not path.is_absolute():
            raise ValueError(f"{key} must be an absolute path")
        result[key] = path
    roots = paths["root_filesystems"]
    if not isinstance(roots, list) or not roots or len(roots) > 8:
        raise ValueError("root_filesystems must contain 1 to 8 paths")
    root_paths = tuple(Path(_text(item, "root filesystem", 4096)) for item in roots)
    if any(not path.is_absolute() for path in root_paths):
        raise ValueError("Root filesystem paths must be absolute")
    result["root_filesystems"] = root_paths
    for key in ("block_devices", "network_interfaces"):
        items = paths[key]
        if (
            not isinstance(items, list)
            or not items
            or len(items) > 32
            or not all(isinstance(item, str) and DEVICE_PATTERN.fullmatch(item) for item in items)
            or len(set(items)) != len(items)
        ):
            raise ValueError(f"Invalid {key}")
        result[key] = tuple(items)
    return result


def _parse_thresholds(value: object) -> ThresholdConfig:
    thresholds = _object(value, "thresholds")
    keys = {
        "disk_warning_percent",
        "disk_critical_percent",
        "service_failures",
        "service_recoveries",
        "reconciliation_error_percent",
    }
    _exact_keys(thresholds, keys, keys, "thresholds")
    warning = _number(thresholds["disk_warning_percent"], "disk warning threshold")
    critical = _number(thresholds["disk_critical_percent"], "disk critical threshold")
    reconciliation = _number(
        thresholds["reconciliation_error_percent"],
        "reconciliation error threshold",
    )
    failures = thresholds["service_failures"]
    recoveries = thresholds["service_recoveries"]
    if not 0 < warning < critical <= 100:
        raise ValueError("Disk thresholds must increase within 0 to 100")
    if not 0 < reconciliation <= 100:
        raise ValueError("Invalid reconciliation error threshold")
    if any(isinstance(item, bool) or not isinstance(item, int) or not 1 <= item <= 10 for item in (failures, recoveries)):
        raise ValueError("Service transition thresholds must be integers from 1 to 10")
    return ThresholdConfig(warning, critical, failures, recoveries, reconciliation)


def load_payload(value: object) -> CollectorConfig:
    payload = _object(value, "collector config")
    keys = {
        "schema_version",
        "sample_interval_seconds",
        "retention",
        "paths",
        "network_attribution",
        "thresholds",
        "workloads",
        "services",
    }
    _exact_keys(payload, keys, keys, "collector config")
    if payload["schema_version"] != SCHEMA_VERSION:
        raise ValueError("Unsupported config schema_version")
    sample_interval = _fixed(payload["sample_interval_seconds"], "sample_interval_seconds")
    retention = _object(payload["retention"], "retention")
    retention_keys = {"raw_seconds", "minute_seconds", "quarter_hour_seconds", "incident_seconds"}
    _exact_keys(retention, retention_keys, retention_keys, "retention")

    workloads_value = payload["workloads"]
    if not isinstance(workloads_value, list) or len(workloads_value) > MAX_WORKLOADS:
        raise ValueError(f"At most {MAX_WORKLOADS} workloads may be configured")
    workloads = tuple(_parse_workload(item) for item in workloads_value)
    _unique(workloads, lambda item: item.id, "workload")

    services_value = payload["services"]
    if not isinstance(services_value, list) or len(services_value) > MAX_SERVICES:
        raise ValueError(f"At most {MAX_SERVICES} services may be configured")
    services = tuple(_parse_service(item) for item in services_value)
    _unique(services, lambda item: item["id"], "service")

    network = _object(payload["network_attribution"], "network attribution")
    _exact_keys(network, {"mode", "capability"}, {"mode", "capability"}, "network attribution")
    mode = network["mode"]
    capability = network["capability"]
    if mode not in {"host-only", "workload"}:
        raise ValueError("Invalid network attribution mode")
    if capability not in {"available", "partial", "unavailable"}:
        raise ValueError("Invalid network attribution capability")
    if mode == "workload" and capability != "available":
        raise ValueError("Workload network attribution requires an available capability")

    paths = _parse_paths(payload["paths"])
    return CollectorConfig(
        sample_interval_seconds=sample_interval,
        raw_retention_seconds=_fixed(retention["raw_seconds"], "raw_seconds"),
        minute_retention_seconds=_fixed(retention["minute_seconds"], "minute_seconds"),
        quarter_hour_retention_seconds=_fixed(
            retention["quarter_hour_seconds"],
            "quarter_hour_seconds",
        ),
        incident_retention_seconds=_fixed(retention["incident_seconds"], "incident_seconds"),
        public_dir=paths["public_dir"],
        owner_dir=paths["owner_dir"],
        database_path=paths["database_path"],
        runtime_map_path=paths["runtime_map_path"],
        root_filesystems=paths["root_filesystems"],
        block_devices=paths["block_devices"],
        network_interfaces=paths["network_interfaces"],
        network_attribution_mode=mode,
        network_attribution_capability=capability,
        thresholds=_parse_thresholds(payload["thresholds"]),
        workloads=workloads,
        services=services,
    )


def load_config(path: Path) -> CollectorConfig:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Unable to load collector config: {path}") from error
    return load_payload(payload)
