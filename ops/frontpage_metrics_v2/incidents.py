from __future__ import annotations

import json
import hashlib
from dataclasses import dataclass, replace
from typing import Mapping, Sequence

from .model import ThresholdConfig


MAX_EVIDENCE_POINTS = 21
MAX_RECOVERED_EVIDENCE_POINTS = 42
MAX_EVIDENCE_BYTES = 256 * 1024


@dataclass(frozen=True)
class IncidentRecord:
    id: str
    rule_id: str
    target_id: str
    title: str
    severity: str
    state: str
    visibility: str
    opened_at_ms: int
    updated_at_ms: int
    recovered_at_ms: int | None
    summary: Mapping[str, object]
    evidence: Mapping[str, object]

    def to_store(self) -> dict[str, object]:
        stored_summary = {
            "rule_id": self.rule_id,
            "target_id": self.target_id,
            "title": self.title,
            "severity": self.severity,
            "updated_at_ms": self.updated_at_ms,
            **dict(self.summary),
        }
        return {
            "id": self.id,
            "state": self.state,
            "opened_at_ms": self.opened_at_ms,
            "recovered_at_ms": self.recovered_at_ms,
            "visibility": self.visibility,
            "summary": stored_summary,
            "evidence": dict(self.evidence),
        }


@dataclass(frozen=True)
class IncidentTransitionSet:
    opened: tuple[IncidentRecord, ...] = ()
    updated: tuple[IncidentRecord, ...] = ()
    recovered: tuple[IncidentRecord, ...] = ()


class IncidentEngine:
    def __init__(self, thresholds: ThresholdConfig) -> None:
        self.thresholds = thresholds
        self._service_failures: dict[str, int] = {}
        self._service_successes: dict[str, int] = {}
        self._history: list[Mapping[str, object]] = []

    def _evidence(
        self,
        rule_id: str,
        target_id: str,
        value: float | int | None,
        *,
        threshold: float | int | None,
        coverage_percent: float,
        capability_state: str,
    ) -> dict[str, object]:
        evidence_key = f"{rule_id}:{target_id}"
        points = [
            {"recorded_at_ms": item["ts_ms"], "value": item["values"][evidence_key]}
            for item in self._history[-MAX_EVIDENCE_POINTS:]
            if evidence_key in item["values"]
        ]
        if points:
            points[-1] = {"recorded_at_ms": points[-1]["recorded_at_ms"], "value": value}
        present = [point["value"] for point in points if point["value"] is not None]
        evidence = {
            "rule_id": rule_id,
            "target_id": target_id,
            "trigger_value": value,
            "threshold_value": threshold,
            "peak_value": max(present) if present else value,
            "coverage_percent": coverage_percent,
            "capability_state": capability_state,
            "points": points,
        }
        while len(json.dumps(evidence, separators=(",", ":")).encode()) > MAX_EVIDENCE_BYTES and points:
            points.pop(0)
        return evidence

    def _open(
        self,
        rule_id: str,
        target_id: str,
        now_ms: int,
        *,
        title: str,
        severity: str,
        visibility: str,
        value: float | int | None,
        threshold: float | int | None,
        coverage_percent: float = 100.0,
        capability_state: str = "available",
    ) -> IncidentRecord:
        digest = hashlib.sha256(f"{rule_id}:{target_id}:{now_ms}".encode()).hexdigest()[:12]
        return IncidentRecord(
            id=f"{rule_id}-{digest}".replace("_", "-"),
            rule_id=rule_id,
            target_id=target_id,
            title=title,
            severity=severity,
            state="active",
            visibility=visibility,
            opened_at_ms=now_ms,
            updated_at_ms=now_ms,
            recovered_at_ms=None,
            summary={"title": title, "value": value},
            evidence=self._evidence(
                rule_id,
                target_id,
                value,
                threshold=threshold,
                coverage_percent=coverage_percent,
                capability_state=capability_state,
            ),
        )

    @staticmethod
    def _cycle_evidence(cycle: Mapping[str, object]) -> dict[str, object]:
        values: dict[str, float | int | None] = {
            "collector-freshness:collector": 0 if cycle.get("freshness") == "fresh" else 1,
        }
        host = cycle.get("host", {})
        values["disk-capacity:root"] = host.get("disk_used_percent")
        for service in cycle.get("services", []):
            status = service.get("status")
            values[f"service-down:{service['service_id']}"] = 1 if status == "down" else 0 if status == "up" else None
        for workload in cycle.get("workloads", []):
            values[f"workload-oom-kill:{workload['workload_id']}"] = int(workload.get("oom_kill_delta", 0))
        return {"ts_ms": int(cycle["ts_ms"]), "values": values}

    def evaluate(
        self,
        cycle: Mapping[str, object],
        active_incidents: Sequence[IncidentRecord],
    ) -> IncidentTransitionSet:
        now_ms = int(cycle["ts_ms"])
        self._history.append(self._cycle_evidence(cycle))
        self._history = self._history[-MAX_EVIDENCE_POINTS:]
        active = {(item.rule_id, item.target_id): item for item in active_incidents if item.state == "active"}
        opened: list[IncidentRecord] = []
        updated: list[IncidentRecord] = []
        recovered: list[IncidentRecord] = []

        def open_if_missing(rule_id, target_id, **kwargs):
            key = (rule_id, target_id)
            if key not in active:
                incident = self._open(rule_id, target_id, now_ms, **kwargs)
                active[key] = incident
                opened.append(incident)

        def recover_if_active(rule_id, target_id):
            incident = active.get((rule_id, target_id))
            if incident is not None:
                recovery_evidence = self._evidence(
                    rule_id,
                    target_id,
                    incident.summary.get("value"),
                    threshold=incident.evidence.get("threshold_value"),
                    coverage_percent=float(incident.evidence.get("coverage_percent", 100)),
                    capability_state=str(incident.evidence.get("capability_state", "available")),
                )
                combined = [*incident.evidence.get("points", []), *recovery_evidence["points"]]
                deduplicated = {
                    (point["recorded_at_ms"], point.get("value")): point for point in combined
                }
                recovery_evidence["points"] = list(deduplicated.values())[-MAX_RECOVERED_EVIDENCE_POINTS:]
                recovered.append(
                    replace(
                        incident,
                        state="recovered",
                        updated_at_ms=now_ms,
                        recovered_at_ms=now_ms,
                        evidence=recovery_evidence,
                    )
                )

        freshness = cycle.get("freshness")
        if freshness != "fresh":
            open_if_missing(
                "collector-freshness",
                "collector",
                title="Collector telemetry is not fresh",
                severity="warning",
                visibility="public",
                value=None,
                threshold=1,
            )
        else:
            recover_if_active("collector-freshness", "collector")

        for service in cycle.get("services", []):
            service_id = str(service["service_id"])
            status = service.get("status")
            if status == "down":
                self._service_failures[service_id] = self._service_failures.get(service_id, 0) + 1
                self._service_successes[service_id] = 0
                if self._service_failures[service_id] >= self.thresholds.service_failures:
                    open_if_missing(
                        "service-down",
                        service_id,
                        title="Service check is failing",
                        severity="critical",
                        visibility="owner" if service.get("visibility") == "owner" else "public",
                        value=self._service_failures[service_id],
                        threshold=self.thresholds.service_failures,
                    )
            elif status == "up":
                self._service_successes[service_id] = self._service_successes.get(service_id, 0) + 1
                self._service_failures[service_id] = 0
                if self._service_successes[service_id] >= self.thresholds.service_recoveries:
                    recover_if_active("service-down", service_id)
            else:
                self._service_failures[service_id] = 0
                self._service_successes[service_id] = 0

        disk_value = cycle.get("host", {}).get("disk_used_percent")
        disk_used = float(disk_value) if isinstance(disk_value, (int, float)) else None
        if disk_used is not None and disk_used >= self.thresholds.disk_warning_percent:
            severity = "critical" if disk_used >= self.thresholds.disk_critical_percent else "warning"
            key = ("disk-capacity", "root")
            if key not in active:
                open_if_missing(
                    "disk-capacity",
                    "root",
                    title="Root filesystem capacity pressure",
                    severity=severity,
                    visibility="public",
                    value=disk_used,
                    threshold=(
                        self.thresholds.disk_critical_percent
                        if severity == "critical"
                        else self.thresholds.disk_warning_percent
                    ),
                )
            elif active[key].severity != severity:
                updated.append(replace(active[key], severity=severity, updated_at_ms=now_ms))
        elif disk_used is not None and disk_used < self.thresholds.disk_warning_percent - 5:
            recover_if_active("disk-capacity", "root")

        current_oom_targets: set[str] = set()
        observed_oom_targets: set[str] = set()
        for workload in cycle.get("workloads", []):
            workload_id = str(workload["workload_id"])
            observed_oom_targets.add(workload_id)
            oom_delta = int(workload.get("oom_kill_delta", 0))
            if oom_delta > 0:
                current_oom_targets.add(workload_id)
                open_if_missing(
                    "workload-oom-kill",
                    workload_id,
                    title="Workload recorded an OOM kill",
                    severity="warning",
                    visibility="owner",
                    value=oom_delta,
                    threshold=1,
                )
        for rule_id, target_id in tuple(active):
            if (
                rule_id == "workload-oom-kill"
                and target_id in observed_oom_targets
                and target_id not in current_oom_targets
            ):
                recover_if_active(rule_id, target_id)

        return IncidentTransitionSet(tuple(opened), tuple(updated), tuple(recovered))
