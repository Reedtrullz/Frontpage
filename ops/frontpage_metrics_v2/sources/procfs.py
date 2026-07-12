from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from ..model import HostSample, SourceResult


SECTOR_BYTES = 512


@dataclass(frozen=True)
class HostPaths:
    proc_root: Path
    filesystems: tuple[Path, ...]
    block_devices: tuple[str, ...]
    network_interfaces: tuple[str, ...]


def _read_key_values(path: Path) -> dict[str, int]:
    values: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        key, raw = line.split(":", 1)
        values[key] = int(raw.strip().split()[0]) * 1024
    return values


def _read_cpu(path: Path) -> tuple[int, int, int]:
    lines = path.read_text(encoding="utf-8").splitlines()
    parts = [int(value) for value in lines[0].split()[1:]]
    if len(parts) < 4:
        raise ValueError("invalid cpu counters")
    idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
    logical_cpu_count = sum(
        bool(re.fullmatch(r"cpu\d+", line.split(maxsplit=1)[0]))
        for line in lines[1:]
        if line
    )
    return sum(parts), idle, max(1, logical_cpu_count)


def _read_diskstats(path: Path, devices: tuple[str, ...]) -> dict[str, dict[str, int]]:
    selected = set(devices)
    result: dict[str, dict[str, int]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 14 or parts[2] not in selected:
            continue
        result[parts[2]] = {
            "read_bytes": int(parts[5]) * SECTOR_BYTES,
            "write_bytes": int(parts[9]) * SECTOR_BYTES,
            "read_operations": int(parts[3]),
            "write_operations": int(parts[7]),
            "io_time_ms": int(parts[12]),
        }
    return result


def _read_network(path: Path, interfaces: tuple[str, ...]) -> dict[str, dict[str, int]]:
    selected = set(interfaces)
    result: dict[str, dict[str, int]] = {}
    for line in path.read_text(encoding="utf-8").splitlines()[2:]:
        if ":" not in line:
            continue
        name, raw = line.split(":", 1)
        name = name.strip()
        if name not in selected:
            continue
        values = [int(value) for value in raw.split()]
        if len(values) < 16:
            continue
        result[name] = {
            "receive_bytes": values[0],
            "receive_packets": values[1],
            "receive_errors": values[2],
            "receive_drops": values[3],
            "transmit_bytes": values[8],
            "transmit_packets": values[9],
            "transmit_errors": values[10],
            "transmit_drops": values[11],
        }
    return result


def _read_tcp_retransmits(path: Path) -> int | None:
    lines = path.read_text(encoding="utf-8").splitlines()
    for index in range(0, len(lines) - 1, 2):
        headings = lines[index].split()
        values = lines[index + 1].split()
        if headings[:1] == ["Tcp:"] and values[:1] == ["Tcp:"] and "RetransSegs" in headings:
            position = headings.index("RetransSegs")
            return int(values[position])
    return None


def read_pressure_file(path: Path) -> dict[str, float]:
    result: dict[str, float] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if not parts:
            continue
        prefix = parts[0]
        for item in parts[1:]:
            key, value = item.split("=", 1)
            result[f"{prefix}_{key}"] = float(value)
    if not result or "some_total" not in result:
        raise ValueError("invalid pressure source")
    return result


def _filesystem_usage(paths: tuple[Path, ...]) -> dict[str, dict[str, int]]:
    result: dict[str, dict[str, int]] = {}
    for path in paths:
        stats = os.statvfs(path)
        result[str(path)] = {
            "total_bytes": stats.f_blocks * stats.f_frsize,
            "available_bytes": stats.f_bavail * stats.f_frsize,
            "used_bytes": (stats.f_blocks - stats.f_bfree) * stats.f_frsize,
        }
    return result


def _positive_rates(
    current: Mapping[str, Mapping[str, int]],
    previous: Mapping[str, Mapping[str, int]],
    elapsed_seconds: float,
    names: Mapping[str, str],
) -> dict[str, dict[str, float]]:
    if elapsed_seconds <= 0:
        return {}
    result: dict[str, dict[str, float]] = {}
    for source_id, counters in current.items():
        before = previous.get(source_id)
        if before is None or any(counters[key] < before.get(key, counters[key]) for key in names):
            continue
        result[source_id] = {
            output: (counters[key] - before[key]) / elapsed_seconds
            for key, output in names.items()
            if key in before
        }
    return result


def collect_host(previous: HostSample | None, paths: HostPaths, now_ms: int) -> SourceResult[HostSample]:
    try:
        root = paths.proc_root
        boot_id = (root / "sys/kernel/random/boot_id").read_text(encoding="utf-8").strip()
        cpu_total, cpu_idle, logical_cpu_count = _read_cpu(root / "stat")
        memory = _read_key_values(root / "meminfo")
        load = tuple(float(value) for value in (root / "loadavg").read_text(encoding="utf-8").split()[:3])
        uptime = float((root / "uptime").read_text(encoding="utf-8").split()[0])
        disks = _read_diskstats(root / "diskstats", paths.block_devices)
        networks = _read_network(root / "net/dev", paths.network_interfaces)
        errors: list[str] = []
        try:
            retransmits = _read_tcp_retransmits(root / "net/snmp")
        except (OSError, ValueError, IndexError):
            retransmits = None
            errors.append("host tcp retransmit source unavailable")
        pressure: dict[str, Mapping[str, float]] = {}
        pressure_failures = 0
        for name in ("cpu", "memory", "io"):
            pressure_path = root / "pressure" / name
            if pressure_path.is_file():
                try:
                    pressure[name] = read_pressure_file(pressure_path)
                except (OSError, ValueError):
                    pressure_failures += 1
                    errors.append(f"host psi {name} source unavailable")

        cpu_percent: float | None = None
        disk_rates: Mapping[str, Mapping[str, float]] = {}
        network_rates: Mapping[str, Mapping[str, float]] = {}
        same_boot = previous is not None and previous.boot_id == boot_id
        elapsed = 0 if previous is None else (now_ms - previous.observed_at_ms) / 1000
        if same_boot and elapsed > 0:
            total_delta = cpu_total - previous.cpu_total_ticks
            idle_delta = cpu_idle - previous.cpu_idle_ticks
            if total_delta > 0 and 0 <= idle_delta <= total_delta:
                cpu_percent = round((1 - idle_delta / total_delta) * 100, 4)
            disk_rates = _positive_rates(
                disks,
                previous.disk_counters,
                elapsed,
                {"read_bytes": "read_bytes_per_second", "write_bytes": "write_bytes_per_second", "read_operations": "read_operations_per_second", "write_operations": "write_operations_per_second"},
            )
            network_rates = _positive_rates(
                networks,
                previous.network_counters,
                elapsed,
                {"receive_bytes": "receive_bytes_per_second", "transmit_bytes": "transmit_bytes_per_second", "receive_packets": "receive_packets_per_second", "transmit_packets": "transmit_packets_per_second", "receive_errors": "receive_errors_per_second", "transmit_errors": "transmit_errors_per_second", "receive_drops": "receive_drops_per_second", "transmit_drops": "transmit_drops_per_second"},
            )

        sample = HostSample(
            observed_at_ms=now_ms,
            boot_id=boot_id,
            cpu_total_ticks=cpu_total,
            cpu_idle_ticks=cpu_idle,
            cpu_percent=cpu_percent,
            memory_total_bytes=memory["MemTotal"],
            memory_used_bytes=memory["MemTotal"] - memory.get("MemAvailable", 0),
            load_average=load,
            uptime_seconds=uptime,
            logical_cpu_count=logical_cpu_count,
            filesystem_usage=_filesystem_usage(paths.filesystems),
            disk_counters=disks,
            disk_rates=disk_rates,
            network_counters=networks,
            network_rates=network_rates,
            tcp_retransmits=retransmits,
            pressure=pressure,
        )
        capabilities = {
            "psi": (
                "available"
                if len(pressure) == 3
                else "partial"
                if pressure or pressure_failures
                else "unavailable"
            ),
            "tcp_retransmits": "available" if retransmits is not None else "unavailable",
            "configured_disks": "available" if len(disks) == len(paths.block_devices) else "partial",
            "configured_interfaces": "available" if len(networks) == len(paths.network_interfaces) else "partial",
        }
        return SourceResult(sample, True, capabilities, tuple(errors))
    except (OSError, ValueError, KeyError, IndexError):
        return SourceResult(None, False, {"host": "unavailable"}, ("host source unavailable",))
