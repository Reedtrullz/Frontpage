from __future__ import annotations

from dataclasses import asdict, replace
from pathlib import Path

from .model import CollectorConfig, HostSample, WorkloadConfig, WorkloadSample
from .sources.cgroup import collect_workloads
from .sources.processes import collect_processes, snapshot_process_counters
from .sources.procfs import HostPaths, collect_host
from .sources.runtime import load_runtime_map
from .sources.services import collect_services


_CAPABILITY_RANK = {"available": 0, "partial": 1, "unavailable": 2}


class LinuxCycleCollector:
    def __init__(
        self,
        config: CollectorConfig,
        *,
        proc_root: Path = Path("/proc"),
        cgroup_root: Path = Path("/sys/fs/cgroup"),
    ) -> None:
        self.config = config
        self.proc_root = proc_root
        self.cgroup_root = cgroup_root
        self.previous_host: HostSample | None = None
        self.previous_workloads: tuple[WorkloadSample, ...] | None = None
        self.previous_process_counters: dict[tuple[str, int], tuple[int, int]] = {}

    def _resolved_workloads(self) -> tuple[tuple[WorkloadConfig, ...], set[str]]:
        if not self.config.runtime_map_path.is_file():
            return self.config.workloads, set()
        runtime = load_runtime_map(
            self.config.runtime_map_path,
            {workload.id for workload in self.config.workloads},
        )
        return (
            tuple(
                replace(workload, match_type="cgroup-path", match_value=runtime[workload.id].cgroup_path)
                if workload.id in runtime
                else workload
                for workload in self.config.workloads
            ),
            set(runtime),
        )

    @staticmethod
    def _capabilities(*sources) -> list[dict[str, str]]:
        states: dict[str, str] = {}
        for source in sources:
            for key, state in source.capabilities.items():
                if key not in states or _CAPABILITY_RANK[state] > _CAPABILITY_RANK[states[key]]:
                    states[key] = state
        return [
            {"key": key.replace("_", "-"), "state": state, "detail": f"{key.replace('_', ' ')} is {state}."}
            for key, state in sorted(states.items())
        ]

    def collect_cycle(self, now_ms: int) -> dict[str, object]:
        host_result = collect_host(
            self.previous_host,
            HostPaths(
                self.proc_root,
                self.config.root_filesystems,
                self.config.block_devices,
                self.config.network_interfaces,
            ),
            now_ms,
        )
        resolved_workloads, runtime_workload_ids = self._resolved_workloads()
        workloads_result = collect_workloads(
            resolved_workloads,
            self.previous_workloads,
            self.cgroup_root,
            now_ms,
            logical_cpu_count=(
                host_result.value.logical_cpu_count
                if host_result.value is not None
                else 1
            ),
        )
        workload_pids = {
            workload.workload_id: workload.pids for workload in workloads_result.value or ()
        }
        processes_result = collect_processes(
            workload_pids,
            self.proc_root,
            self.previous_process_counters,
            now_ms,
            logical_cpu_count=(
                host_result.value.logical_cpu_count
                if host_result.value is not None
                else 1
            ),
        )
        services_result = collect_services(self.config.services, now_ms)

        previous_workloads = {
            workload.workload_id: workload for workload in self.previous_workloads or ()
        }
        config_by_id = {workload.id: workload for workload in self.config.workloads}
        process_rows = processes_result.value or {}
        workloads = []
        for sample in workloads_result.value or ():
            before = previous_workloads.get(sample.workload_id)
            metadata = config_by_id[sample.workload_id]
            payload = asdict(sample)
            payload.update(
                {
                    "label": metadata.label,
                    "project_slug": metadata.project_slug,
                    "kind": "container" if sample.workload_id in runtime_workload_ids else "systemd",
                    "coverage_percent": 100.0,
                    "oom_kill_delta": (
                        0
                        if before is None or sample.oom_kill_events < before.oom_kill_events
                        else sample.oom_kill_events - before.oom_kill_events
                    ),
                    "processes": [asdict(process) for process in process_rows.get(sample.workload_id, ())],
                }
            )
            workloads.append(payload)

        services = []
        service_config = {str(service["id"]): service for service in self.config.services}
        for sample in services_result.value or ():
            configured = service_config[sample.id]
            services.append(
                {
                    "service_id": sample.id,
                    "label": configured["label"],
                    "project_slug": configured.get("project_slug"),
                    "visibility": sample.visibility,
                    "status": sample.status,
                    "latency_ms": sample.latency_ms,
                    "checked_at_ms": sample.checked_at_ms,
                }
            )

        host = asdict(host_result.value) if host_result.value is not None else {}
        if host:
            root = host.get("filesystem_usage", {}).get("/", {})
            total = root.get("total_bytes", 0)
            host["disk_used_percent"] = 0 if not total else root.get("used_bytes", 0) / total * 100
            host["reconciliation_error_threshold_percent"] = (
                self.config.thresholds.reconciliation_error_percent
            )
        source_errors = [
            *host_result.errors,
            *workloads_result.errors,
            *processes_result.errors,
            *services_result.errors,
        ]
        host["source_errors"] = source_errors[:32]
        cycle = {
            "ts_ms": now_ms,
            "freshness": "fresh" if host_result.available else "unavailable",
            "host": host,
            "host_coverage_percent": 100.0 if host_result.available else 0.0,
            "workloads": workloads,
            "services": services,
            "capabilities": self._capabilities(
                host_result,
                workloads_result,
                processes_result,
                services_result,
            )[:32],
            "source_errors": source_errors[:32],
        }
        self.previous_host = host_result.value
        self.previous_workloads = workloads_result.value
        self.previous_process_counters = snapshot_process_counters(
            workload_pids,
            self.proc_root,
            now_ms,
        )
        return cycle
