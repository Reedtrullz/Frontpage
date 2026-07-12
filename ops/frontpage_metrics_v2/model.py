from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Generic, Literal, Mapping, TypeVar


CapabilityState = Literal["available", "partial", "unavailable"]
T = TypeVar("T")


@dataclass(frozen=True)
class WorkloadConfig:
    id: str
    label: str
    match_type: Literal["systemd-unit", "cgroup-path", "cgroup-pattern"]
    match_value: str
    project_slug: str | None


@dataclass(frozen=True)
class ThresholdConfig:
    disk_warning_percent: float
    disk_critical_percent: float
    service_failures: int
    service_recoveries: int
    reconciliation_error_percent: float


@dataclass(frozen=True)
class CollectorConfig:
    sample_interval_seconds: int
    raw_retention_seconds: int
    minute_retention_seconds: int
    quarter_hour_retention_seconds: int
    incident_retention_seconds: int
    public_dir: Path
    owner_dir: Path
    database_path: Path
    runtime_map_path: Path
    root_filesystems: tuple[Path, ...]
    block_devices: tuple[str, ...]
    network_interfaces: tuple[str, ...]
    network_attribution_mode: Literal["host-only", "workload"]
    network_attribution_capability: CapabilityState
    thresholds: ThresholdConfig
    workloads: tuple[WorkloadConfig, ...]
    services: tuple[dict[str, object], ...]


@dataclass(frozen=True)
class HostSample:
    observed_at_ms: int
    boot_id: str
    cpu_total_ticks: int
    cpu_idle_ticks: int
    cpu_percent: float | None
    memory_total_bytes: int
    memory_used_bytes: int
    load_average: tuple[float, float, float]
    uptime_seconds: float
    disk_counters: Mapping[str, Mapping[str, int]] = field(default_factory=dict)
    network_counters: Mapping[str, Mapping[str, int]] = field(default_factory=dict)
    tcp_retransmits: int | None = None
    pressure: Mapping[str, Mapping[str, float]] = field(default_factory=dict)


@dataclass(frozen=True)
class WorkloadSample:
    workload_id: str
    observed_at_ms: int
    cgroup_path: str
    cpu_usage_usec: int
    cpu_percent: float | None
    memory_current_bytes: int
    io_read_bytes: int
    io_write_bytes: int
    oom_events: int
    oom_kill_events: int
    pids: tuple[int, ...] = ()
    pressure: Mapping[str, Mapping[str, float]] = field(default_factory=dict)


@dataclass(frozen=True)
class ProcessSample:
    pid: int
    comm: str
    uid: int
    cpu_percent: float
    rss_bytes: int
    state: str
    workload_id: str


@dataclass(frozen=True)
class ServiceSample:
    id: str
    visibility: Literal["public", "owner"]
    status: Literal["up", "down", "unknown"]
    checked_at_ms: int
    latency_ms: int | None


@dataclass(frozen=True)
class CapabilityReport:
    states: Mapping[str, CapabilityState]
    details: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class SourceResult(Generic[T]):
    value: T | None
    available: bool
    capabilities: Mapping[str, CapabilityState] = field(default_factory=dict)
    errors: tuple[str, ...] = ()
