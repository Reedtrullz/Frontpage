from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping

from ..model import ProcessSample, SourceResult


MAX_PROCESSES = 20
STATE_NAMES = {
    "R": "running",
    "S": "sleeping",
    "D": "sleeping",
    "T": "stopped",
    "t": "stopped",
    "Z": "zombie",
}


def _read_stat(path: Path) -> tuple[str, str, int]:
    raw = path.read_text(encoding="utf-8").strip()
    left = raw.find("(")
    right = raw.rfind(")")
    if left < 0 or right <= left:
        raise ValueError("invalid process stat")
    comm = raw[left + 1 : right]
    fields = raw[right + 2 :].split()
    return comm, fields[0], int(fields[11]) + int(fields[12])


def _read_status(path: Path) -> tuple[int, int]:
    uid = None
    rss = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("Uid:"):
            uid = int(line.split()[1])
        elif line.startswith("VmRSS:"):
            rss = int(line.split()[1]) * 1024
    if uid is None:
        raise ValueError("process uid unavailable")
    return uid, rss


def collect_processes(
    workload_pids: Mapping[str, tuple[int, ...]],
    proc_root: Path,
    previous: Mapping[tuple[str, int], tuple[int, int]],
    now_ms: int,
) -> SourceResult[dict[str, tuple[ProcessSample, ...]]]:
    clock_ticks = int(os.sysconf("SC_CLK_TCK"))
    result: dict[str, tuple[ProcessSample, ...]] = {}
    errors: list[str] = []
    for workload_id, pids in workload_pids.items():
        rows: list[ProcessSample] = []
        for pid in pids:
            try:
                root = proc_root / str(pid)
                comm, state, ticks = _read_stat(root / "stat")
                uid, rss = _read_status(root / "status")
                cgroup = (root / "cgroup").read_text(encoding="utf-8")
                if "0::/" not in cgroup:
                    raise ValueError("process cgroup unavailable")
                cpu_percent = 0.0
                before = previous.get((workload_id, pid))
                if before is not None:
                    before_ticks, before_ms = before
                    elapsed = (now_ms - before_ms) / 1000
                    if elapsed > 0 and ticks >= before_ticks:
                        cpu_percent = min(100.0, (ticks - before_ticks) / clock_ticks / elapsed * 100)
                rows.append(
                    ProcessSample(
                        pid=pid,
                        comm=comm[:64],
                        uid=uid,
                        cpu_percent=round(cpu_percent, 4),
                        rss_bytes=rss,
                        state=STATE_NAMES.get(state, "unknown"),
                        workload_id=workload_id,
                    )
                )
            except (OSError, ValueError, IndexError):
                errors.append(f"process {pid}: sample unavailable")
        rows.sort(key=lambda item: (item.cpu_percent, item.rss_bytes, -item.pid), reverse=True)
        result[workload_id] = tuple(rows[:MAX_PROCESSES])
    capabilities = {"process_visibility": "available" if result else "unavailable"}
    return SourceResult(result, bool(result), capabilities, tuple(errors))

