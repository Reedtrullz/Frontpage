#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
MAX_HISTORY = 1440
MAX_ITEMS = 64


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def clamp_timeout_ms(value):
    return max(1000, min(int(value), 10000))


def _validate_id(value):
    if not isinstance(value, str) or not value or len(value) > 63:
        raise ValueError("Invalid id")
    if not value[0].isalnum() or value.lower() != value:
        raise ValueError("Invalid id")
    for char in value:
        if not (char.isdigit() or char.islower() or char == "-"):
            raise ValueError("Invalid id")


def _reject_secret_url(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Service URL must be http or https")
    if parsed.username or parsed.password:
        raise ValueError("Service URL must not contain credentials")
    if parsed.params or parsed.query or parsed.fragment:
        raise ValueError("Service URL must not contain params, query, or fragment")


def load_config(path):
    data = json.loads(Path(path).read_text())
    if data.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported config schema_version")
    services = data.get("services", [])
    containers = data.get("containers", [])
    if len(services) > MAX_ITEMS or len(containers) > MAX_ITEMS:
        raise ValueError("Too many configured services or containers")

    seen_services = set()
    for service in services:
        _validate_id(service["id"])
        if service["id"] in seen_services:
            raise ValueError(f"Duplicate service id: {service['id']}")
        seen_services.add(service["id"])
        _reject_secret_url(service["url"])
        service["timeout_ms"] = clamp_timeout_ms(service.get("timeout_ms", 5000))
        if service.get("visibility") not in {"public", "owner"}:
            raise ValueError("Service visibility must be public or owner")

    seen_containers = set()
    for container in containers:
        _validate_id(container["id"])
        if container["id"] in seen_containers:
            raise ValueError(f"Duplicate container id: {container['id']}")
        seen_containers.add(container["id"])
        name = container.get("name")
        if not isinstance(name, str) or not name or any(c in name for c in "*?[]"):
            raise ValueError("Container names must be exact strings")

    return {"schema_version": SCHEMA_VERSION, "services": services, "containers": containers}


def read_cpu_times():
    first_line = Path("/proc/stat").read_text().splitlines()[0]
    parts = [int(part) for part in first_line.split()[1:]]
    idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
    total = sum(parts)
    return idle, total


def collect_cpu_percent():
    if not Path("/proc/stat").exists():
        return 0
    idle_a, total_a = read_cpu_times()
    time.sleep(0.1)
    idle_b, total_b = read_cpu_times()
    total_delta = total_b - total_a
    idle_delta = idle_b - idle_a
    if total_delta <= 0:
        return 0
    return round(max(0, min(100, (1 - idle_delta / total_delta) * 100)), 1)


def collect_meminfo():
    meminfo_path = Path("/proc/meminfo")
    if not meminfo_path.exists():
        return 0, 1
    values = {}
    for line in meminfo_path.read_text().splitlines():
        key, raw = line.split(":", 1)
        values[key] = int(raw.strip().split()[0]) * 1024
    total = values["MemTotal"]
    available = values.get("MemAvailable", 0)
    return total - available, total


def collect_uptime_seconds():
    uptime_path = Path("/proc/uptime")
    if not uptime_path.exists():
        return int(time.monotonic())
    return int(float(uptime_path.read_text().split()[0]))


def collect_load_average():
    try:
        return os.getloadavg()
    except OSError:
        return 0, 0, 0


def collect_host_metrics():
    ram_used, ram_total = collect_meminfo()
    disk = shutil.disk_usage("/")
    load_1m, load_5m, load_15m = collect_load_average()
    return {
        "cpu_percent": collect_cpu_percent(),
        "ram_used_bytes": int(ram_used),
        "ram_total_bytes": int(ram_total),
        "disk_used_bytes": int(disk.used),
        "disk_total_bytes": int(disk.total),
        "load_1m": round(float(load_1m), 2),
        "load_5m": round(float(load_5m), 2),
        "load_15m": round(float(load_15m), 2),
        "uptime_seconds": collect_uptime_seconds(),
    }


def service_result(service, opener=urllib.request.urlopen, now=utc_now):
    started = time.monotonic()
    timeout_seconds = clamp_timeout_ms(service.get("timeout_ms", 5000)) / 1000
    status = "unknown"
    latency_ms = None
    try:
        request = urllib.request.Request(service["url"], method="GET")
        with opener(request, timeout=timeout_seconds) as response:
            latency_ms = min(10000, int(round((time.monotonic() - started) * 1000)))
            status = "up" if response.status == int(service.get("expected_status", 200)) else "down"
    except urllib.error.HTTPError as error:
        latency_ms = min(10000, int(round((time.monotonic() - started) * 1000)))
        status = "up" if error.code == int(service.get("expected_status", 200)) else "down"
    except Exception:
        status = "unknown"
        latency_ms = None

    result = {
        "id": service["id"],
        "label": service["label"],
        "visibility": service["visibility"],
        "status": status,
        "checked_at": now(),
        "latency_ms": latency_ms,
    }
    if service.get("project_slug"):
        result["project_slug"] = service["project_slug"]
    return result


def container_status_from_inspect(data):
    state = data.get("State", {})
    if not state:
        return "unknown"
    if not state.get("Running"):
        return "down"
    health = state.get("Health")
    if isinstance(health, dict):
        return "up" if health.get("Status") == "healthy" else "down"
    return "up"


def inspect_container(name):
    try:
        completed = subprocess.run(
            ["docker", "inspect", name],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
        )
        if completed.returncode != 0:
            return "unknown"
        parsed = json.loads(completed.stdout)
        if not parsed:
            return "unknown"
        return container_status_from_inspect(parsed[0])
    except Exception:
        return "unknown"


def container_result(container, now=utc_now):
    result = {
        "id": container["id"],
        "label": container["label"],
        "status": inspect_container(container["name"]),
        "checked_at": now(),
    }
    if container.get("project_slug"):
        result["project_slug"] = container["project_slug"]
    return result


def prune_history(samples):
    return list(samples)[-MAX_HISTORY:]


def atomic_write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    os.replace(tmp, path)


def load_history(path):
    try:
        data = json.loads(Path(path).read_text())
        if data.get("schema_version") != SCHEMA_VERSION:
            return []
        return list(data.get("samples", []))
    except Exception:
        return []


def collect_snapshot(config):
    collected_at = utc_now()
    return {
        "schema_version": SCHEMA_VERSION,
        "collected_at": collected_at,
        "host": collect_host_metrics(),
        "services": [service_result(service) for service in config["services"]],
        "containers": [container_result(container) for container in config["containers"]],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--metrics-dir", required=True)
    args = parser.parse_args()

    config = load_config(Path(args.config))
    metrics_dir = Path(args.metrics_dir)
    snapshot = collect_snapshot(config)
    atomic_write_json(metrics_dir / "latest.json", snapshot)
    samples = prune_history(load_history(metrics_dir / "history.json") + [snapshot])
    atomic_write_json(
        metrics_dir / "history.json",
        {"schema_version": SCHEMA_VERSION, "samples": samples},
    )


if __name__ == "__main__":
    main()
