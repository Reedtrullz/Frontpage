#!/usr/bin/env python3
import argparse
import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path


ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
CONTAINER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
IMAGE_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")


def validate_allowlist(entries):
    if not isinstance(entries, list) or len(entries) > 32:
        raise ValueError("Runtime allowlist must be an array of at most 32 entries")
    result = {}
    container_names = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"workload_id", "container_name"}:
            raise ValueError("Invalid runtime allowlist entry")
        workload_id = entry["workload_id"]
        container_name = entry["container_name"]
        if not isinstance(workload_id, str) or not ID_PATTERN.fullmatch(workload_id):
            raise ValueError("Invalid workload id")
        if not isinstance(container_name, str) or not CONTAINER_PATTERN.fullmatch(container_name):
            raise ValueError("Invalid container name")
        if workload_id in result or container_name in container_names:
            raise ValueError("Runtime allowlist contains a duplicate binding")
        result[workload_id] = container_name
        container_names.add(container_name)
    return result


def _timestamp(value):
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError("Invalid generated timestamp")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("Invalid generated timestamp") from error
    return value


def _cgroup_for_pid(proc_root, pid):
    if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0:
        raise ValueError("Invalid container pid")
    lines = (Path(proc_root) / str(pid) / "cgroup").read_text(encoding="utf-8").splitlines()
    unified = [line.split("::", 1)[1] for line in lines if line.startswith("0::")]
    if len(unified) != 1:
        raise ValueError("Container cgroup v2 path is unavailable")
    value = unified[0].lstrip("/")
    path = Path(value)
    if not value or path.is_absolute() or ".." in path.parts:
        raise ValueError("Invalid container cgroup path")
    return path.as_posix()


def generate_runtime_map(allowlist, facts, proc_root, generated_at):
    if isinstance(allowlist, list):
        allowlist = validate_allowlist(allowlist)
    if not isinstance(allowlist, dict):
        raise ValueError("Invalid runtime allowlist")
    if not isinstance(facts, dict) or set(facts) != {"containers"}:
        raise ValueError("Invalid container facts")
    containers = facts["containers"]
    if not isinstance(containers, list) or len(containers) > 64:
        raise ValueError("Invalid container facts")
    facts_by_name = {}
    for fact in containers:
        if not isinstance(fact, dict) or set(fact) != {"name", "pid", "image_sha"}:
            raise ValueError("Invalid container fact")
        name = fact["name"].lstrip("/") if isinstance(fact["name"], str) else fact["name"]
        if name in facts_by_name:
            raise ValueError("Container facts contain a duplicate name")
        facts_by_name[name] = fact

    workloads = []
    for workload_id, container_name in sorted(allowlist.items()):
        fact = facts_by_name.get(container_name)
        if fact is None:
            continue
        image_sha = fact["image_sha"]
        if not isinstance(image_sha, str) or not IMAGE_PATTERN.fullmatch(image_sha):
            raise ValueError("Invalid container image SHA")
        workloads.append(
            {
                "workload_id": workload_id,
                "cgroup_path": _cgroup_for_pid(proc_root, fact["pid"]),
                "image_sha": image_sha,
            }
        )
    return {"generated_at": _timestamp(generated_at), "workloads": workloads}


def atomic_write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o640)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            descriptor = -1
            json.dump(payload, handle, separators=(",", ":"), sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="Generate an allowlisted Frontpage cgroup runtime map")
    parser.add_argument("--allowlist", required=True)
    parser.add_argument("--facts", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--proc-root", default="/proc")
    parser.add_argument("--generated-at", required=True)
    args = parser.parse_args()
    entries = json.loads(Path(args.allowlist).read_text(encoding="utf-8"))
    facts = json.loads(Path(args.facts).read_text(encoding="utf-8"))
    payload = generate_runtime_map(
        validate_allowlist(entries),
        facts,
        Path(args.proc_root),
        args.generated_at,
    )
    atomic_write_json(Path(args.output), payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
