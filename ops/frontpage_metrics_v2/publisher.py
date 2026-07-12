from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Mapping, Sequence


PUBLIC_FORBIDDEN_KEYS = {
    "workloads",
    "processes",
    "diagnostics",
    "cgroup_path",
    "systemd_unit",
    "container_id",
    "pid",
    "uid",
    "comm",
    "cpu_percent",
    "rss_bytes",
    "memory_current_bytes",
    "evidence",
}
LATEST_CAP_BYTES = 512 * 1024
SERIES_CAP_BYTES = 4 * 1024 * 1024
MAX_RANKED_WORKLOADS = 16
MAX_POINTS = {"1h": 240, "24h": 1440, "7d": 10080, "30d": 2880}


@dataclass(frozen=True)
class PublicationResult:
    path: Path
    size_bytes: int
    changed: bool


def _collect_keys(value: object) -> set[str]:
    if isinstance(value, dict):
        keys = set(value)
        for nested in value.values():
            keys.update(_collect_keys(nested))
        return keys
    if isinstance(value, list):
        result: set[str] = set()
        for nested in value:
            result.update(_collect_keys(nested))
        return result
    return set()


def _relative_json_path(value: str) -> PurePosixPath:
    if not isinstance(value, str) or "\\" in value:
        raise ValueError("Projection path must be a relative JSON path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not path.parts or path.suffix != ".json":
        raise ValueError("Projection path must be a relative JSON path")
    return path


class ProjectionPublisher:
    def __init__(self, public_dir: Path, owner_dir: Path) -> None:
        self.public_dir = Path(public_dir)
        self.owner_dir = Path(owner_dir)
        for directory in (self.public_dir, self.owner_dir):
            directory.mkdir(parents=True, exist_ok=True)
            os.chmod(directory, 0o750)

    @staticmethod
    def _encode(payload: Mapping[str, object], cap: int, label: str) -> bytes:
        try:
            encoded = (json.dumps(payload, separators=(",", ":"), sort_keys=True, allow_nan=False) + "\n").encode()
        except (TypeError, ValueError) as error:
            raise ValueError(f"{label} projection must contain valid JSON") from error
        if len(encoded) > cap:
            cap_label = "512 KiB" if cap == LATEST_CAP_BYTES else "4 MiB"
            raise ValueError(f"{label} projection exceeds {cap_label}")
        return encoded

    @staticmethod
    def _validate_bounds(relative: PurePosixPath, payload: Mapping[str, object], public: bool) -> None:
        if payload.get("schema_version") != 2:
            raise ValueError("Projection schema_version must be 2")
        name = relative.name
        if name == "latest.v2.json":
            if public:
                resources = payload.get("resources")
                services = payload.get("services")
                if not isinstance(resources, list) or not 1 <= len(resources) <= 4:
                    raise ValueError("Public latest resources must contain 1 to 4 rows")
                if not isinstance(services, list) or len(services) > 32:
                    raise ValueError("Public latest services exceed 32 rows")
            else:
                workloads = payload.get("workloads")
                incidents = payload.get("incidents")
                if not isinstance(workloads, list) or len(workloads) > 32:
                    raise ValueError("Owner latest workloads exceed 32 rows")
                if not isinstance(incidents, list) or len(incidents) > 256:
                    raise ValueError("Owner latest incidents exceed 256 rows")
                if any(not isinstance(row.get("processes"), list) or len(row["processes"]) > 20 for row in workloads):
                    raise ValueError("Owner latest processes exceed 20 rows per workload")
        elif name == "incidents.v2.json":
            incidents = payload.get("incidents")
            if not isinstance(incidents, list) or len(incidents) > 256:
                raise ValueError("Incident projection exceeds 256 rows")
        elif "range" in payload and "timestamps" in payload:
            range_name = payload.get("range")
            timestamps = payload.get("timestamps")
            series = payload.get("series")
            if range_name not in MAX_POINTS or not isinstance(timestamps, list) or not 1 <= len(timestamps) <= MAX_POINTS[range_name]:
                raise ValueError("Series timestamp count exceeds its range bound")
            if not isinstance(series, list) or not 1 <= len(series) <= 17:
                raise ValueError("Series count exceeds 17")
            if any(not isinstance(row.get("values"), list) or len(row["values"]) != len(timestamps) for row in series):
                raise ValueError("Series values must align with timestamps")

    @staticmethod
    def _prepare_parent(root: Path, relative: PurePosixPath) -> Path:
        target = root.joinpath(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        current = target.parent
        while current == root or root in current.parents:
            os.chmod(current, 0o750)
            if current == root:
                break
            current = current.parent
        return target

    @staticmethod
    def _atomic_write(target: Path, encoded: bytes, immutable: bool) -> PublicationResult:
        if target.exists():
            previous = target.read_bytes()
            if previous == encoded:
                return PublicationResult(target, len(encoded), False)
            if immutable:
                raise FileExistsError(f"Closed projection chunk is immutable: {target.name}")
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{target.name}.",
            suffix=".tmp",
            dir=target.parent,
        )
        temporary = Path(temporary_name)
        try:
            os.fchmod(descriptor, 0o640)
            with os.fdopen(descriptor, "wb") as handle:
                descriptor = -1
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
            directory_fd = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            return PublicationResult(target, len(encoded), True)
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            temporary.unlink(missing_ok=True)

    def _publish(
        self,
        root: Path,
        relative_path: str,
        payload: Mapping[str, object],
        *,
        immutable: bool,
        public: bool,
    ) -> PublicationResult:
        relative = _relative_json_path(relative_path)
        if public:
            forbidden = PUBLIC_FORBIDDEN_KEYS.intersection(_collect_keys(payload))
            if forbidden:
                raise ValueError(f"Public projection contains forbidden public key: {sorted(forbidden)[0]}")
        self._validate_bounds(relative, payload, public)
        cap = SERIES_CAP_BYTES if any(part in {"host", "workloads", "minute", "quarter-hour"} for part in relative.parts) else LATEST_CAP_BYTES
        encoded = self._encode(payload, cap, "Public" if public else "Owner")
        return self._atomic_write(self._prepare_parent(root, relative), encoded, immutable)

    def publish_public(self, relative_path: str, payload: Mapping[str, object], *, immutable: bool = False) -> PublicationResult:
        return self._publish(self.public_dir, relative_path, payload, immutable=immutable, public=True)

    def publish_owner(self, relative_path: str, payload: Mapping[str, object], *, immutable: bool = False) -> PublicationResult:
        return self._publish(self.owner_dir, relative_path, payload, immutable=immutable, public=False)

    def publish_manifest(self, files: Sequence[str]) -> PublicationResult:
        normalized = [str(_relative_json_path(path)) for path in files]
        if len(normalized) != len(set(normalized)) or len(normalized) > 256:
            raise ValueError("Invalid owner manifest file list")
        return self.publish_owner(
            "manifest.v2.json",
            {"schema_version": 2, "files": normalized},
        )

    def build_workload_series(self, rows: Sequence[Mapping[str, object]]) -> dict[str, object]:
        residual = next((row for row in rows if row.get("id") == "system-untracked"), None)
        ranked = [row for row in rows if row.get("id") != "system-untracked"]

        def rank(row: Mapping[str, object]) -> float:
            values = row.get("values", [])
            return max((float(value) for value in values if value is not None), default=0.0)

        ranked.sort(key=lambda row: (rank(row), str(row.get("id"))), reverse=True)
        selected = ranked[:MAX_RANKED_WORKLOADS]
        if residual is not None:
            selected.append(residual)
        return {"series": selected, "truncated": len(ranked) > MAX_RANKED_WORKLOADS}

    def publish(self, snapshot: Mapping[str, object]) -> tuple[PublicationResult, ...]:
        public_files = snapshot.get("public", {})
        owner_files = snapshot.get("owner", {})
        if not isinstance(public_files, dict) or not isinstance(owner_files, dict):
            raise ValueError("Projection snapshot must contain public and owner file maps")
        results = [self.publish_public(path, payload) for path, payload in public_files.items()]
        results.extend(self.publish_owner(path, payload) for path, payload in owner_files.items())
        return tuple(results)
