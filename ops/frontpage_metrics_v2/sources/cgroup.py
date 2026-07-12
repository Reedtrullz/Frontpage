from __future__ import annotations

import re
from pathlib import Path

from ..model import SourceResult, WorkloadConfig, WorkloadSample
from .procfs import read_pressure_file


def _mapping(path: Path) -> dict[str, int]:
    result: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        key, value = line.split(None, 1)
        result[key] = int(value)
    return result


def _resolve_under_root(root: Path, relative: str) -> Path:
    resolved_root = root.resolve()
    resolved = (root / relative).resolve()
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise ValueError("workload path resolves outside cgroup root")
    return resolved


def _resolve_workload(config: WorkloadConfig, root: Path) -> Path:
    if config.match_type == "systemd-unit":
        return _resolve_under_root(root, f"system.slice/{config.match_value}")
    if config.match_type == "cgroup-path":
        return _resolve_under_root(root, config.match_value)
    pattern = re.compile(config.match_value)
    matches = [
        path
        for path in root.rglob("*")
        if path.is_dir() and pattern.fullmatch(path.relative_to(root).as_posix())
    ]
    if len(matches) != 1:
        raise ValueError("workload pattern must resolve exactly one cgroup")
    return _resolve_under_root(root, matches[0].relative_to(root).as_posix())


def _read_io(path: Path) -> tuple[int, int]:
    read_bytes = 0
    write_bytes = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        fields = {}
        for item in line.split()[1:]:
            key, value = item.split("=", 1)
            fields[key] = int(value)
        read_bytes += fields.get("rbytes", 0)
        write_bytes += fields.get("wbytes", 0)
    return read_bytes, write_bytes


def _delta_rate(current: int, previous: int, elapsed_seconds: float) -> float | None:
    if elapsed_seconds <= 0 or current < previous:
        return None
    return (current - previous) / elapsed_seconds


def collect_workloads(
    config: tuple[WorkloadConfig, ...],
    previous: tuple[WorkloadSample, ...] | None,
    cgroup_root: Path,
    now_ms: int,
) -> SourceResult[tuple[WorkloadSample, ...]]:
    previous_by_id = {item.workload_id: item for item in previous or ()}
    samples: list[WorkloadSample] = []
    errors: list[str] = []
    pressure_sources = 0
    process_sources = 0
    for workload in config:
        try:
            path = _resolve_workload(workload, cgroup_root)
            cpu = _mapping(path / "cpu.stat")
            memory_current = int((path / "memory.current").read_text(encoding="utf-8").strip())
            memory_events = _mapping(path / "memory.events")
            io_read, io_write = _read_io(path / "io.stat")
            try:
                pids = tuple(
                    sorted(
                        int(value)
                        for value in (path / "cgroup.procs").read_text(encoding="utf-8").split()
                    )
                )
                process_sources += 1
            except (OSError, ValueError):
                pids = ()
                errors.append(f"workload {workload.id}: process visibility unavailable")
            pressure = {}
            for name in ("cpu", "memory", "io"):
                pressure_path = path / f"{name}.pressure"
                if pressure_path.is_file():
                    try:
                        pressure[name] = read_pressure_file(pressure_path)
                    except (OSError, ValueError):
                        errors.append(f"workload {workload.id}: psi {name} unavailable")
            if len(pressure) == 3:
                pressure_sources += 1

            before = previous_by_id.get(workload.id)
            elapsed = 0 if before is None else (now_ms - before.observed_at_ms) / 1000
            cpu_percent = None
            read_rate = None
            write_rate = None
            if before is not None:
                cpu_rate = _delta_rate(cpu["usage_usec"], before.cpu_usage_usec, elapsed)
                cpu_percent = None if cpu_rate is None else cpu_rate / 10_000
                read_rate = _delta_rate(io_read, before.io_read_bytes, elapsed)
                write_rate = _delta_rate(io_write, before.io_write_bytes, elapsed)
            samples.append(
                WorkloadSample(
                    workload_id=workload.id,
                    observed_at_ms=now_ms,
                    cgroup_path=path.relative_to(cgroup_root.resolve()).as_posix(),
                    cpu_usage_usec=cpu["usage_usec"],
                    cpu_percent=cpu_percent,
                    memory_current_bytes=memory_current,
                    io_read_bytes=io_read,
                    io_write_bytes=io_write,
                    io_read_bytes_per_second=read_rate,
                    io_write_bytes_per_second=write_rate,
                    oom_events=memory_events.get("oom", 0),
                    oom_kill_events=memory_events.get("oom_kill", 0),
                    pids=pids,
                    pressure=pressure,
                )
            )
        except (OSError, ValueError, KeyError):
            errors.append(f"workload {workload.id}: source unavailable or outside cgroup root")
    capabilities = {
        "cgroup_v2": "partial" if samples and errors else "available" if samples else "unavailable",
        "psi": (
            "available"
            if samples and pressure_sources == len(samples)
            else "partial"
            if pressure_sources or any("psi" in error for error in errors)
            else "unavailable"
        ),
        "process_visibility": (
            "available"
            if samples and process_sources == len(samples)
            else "partial"
            if process_sources
            else "unavailable"
        ),
    }
    return SourceResult(tuple(samples), bool(samples), capabilities, tuple(errors))
