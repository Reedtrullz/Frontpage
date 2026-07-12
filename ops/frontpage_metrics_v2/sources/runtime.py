from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class RuntimeWorkload:
    workload_id: str
    cgroup_path: str
    image_sha: str


def load_runtime_map(path: Path, allowed_workload_ids: set[str]) -> dict[str, RuntimeWorkload]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or set(payload) != {"generated_at", "workloads"}:
        raise ValueError("Invalid runtime map")
    generated_at = payload["generated_at"]
    if not isinstance(generated_at, str) or not generated_at.endswith("Z"):
        raise ValueError("Invalid runtime map timestamp")
    try:
        datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("Invalid runtime map timestamp") from error
    workloads = payload["workloads"]
    if not isinstance(workloads, list) or len(workloads) > len(allowed_workload_ids):
        raise ValueError("Invalid runtime workload list")
    result: dict[str, RuntimeWorkload] = {}
    for item in workloads:
        if not isinstance(item, dict) or set(item) != {"workload_id", "cgroup_path", "image_sha"}:
            raise ValueError("Invalid runtime workload")
        workload_id = item["workload_id"]
        cgroup_path = item["cgroup_path"]
        image_sha = item["image_sha"]
        if workload_id not in allowed_workload_ids or workload_id in result:
            raise ValueError("Runtime map contains an unknown or duplicate workload")
        if (
            not isinstance(cgroup_path, str)
            or not cgroup_path
            or Path(cgroup_path).is_absolute()
            or ".." in Path(cgroup_path).parts
        ):
            raise ValueError("Invalid runtime cgroup path")
        if not isinstance(image_sha, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_sha):
            raise ValueError("Invalid runtime image SHA")
        result[workload_id] = RuntimeWorkload(workload_id, cgroup_path, image_sha)
    return result


def apply_runtime_map(
    configured_paths: Mapping[str, str],
    runtime_map: Mapping[str, RuntimeWorkload],
) -> dict[str, str]:
    return {
        workload_id: runtime_map.get(workload_id, RuntimeWorkload(workload_id, path, "")).cgroup_path
        for workload_id, path in configured_paths.items()
    }
