from __future__ import annotations

import json
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Mapping, Sequence

from .migrations import migrate


TIERS = {"15s", "1m", "15m"}
TABLES = {"host_points", "workload_points", "service_points"}
RETENTION_MS = {
    "15s": 3600_000,
    "1m": 7 * 86400_000,
    "15m": 30 * 86400_000,
}
INCIDENT_RETENTION_MS = 90 * 86400_000
MAX_EVIDENCE_BYTES = 256 * 1024
_WRITER_LOCK = threading.Lock()
_WRITER_PATHS: set[str] = set()


@dataclass(frozen=True)
class CycleWriteStatus:
    duration_seconds: float
    skip_next_cycle: bool


def _json_object(value: object, label: str) -> str:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    try:
        return json.dumps(value, separators=(",", ":"), sort_keys=True, allow_nan=False)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must contain valid JSON values") from error


def _coverage(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
        raise ValueError("coverage_percent must be between 0 and 100")
    return float(value)


class MetricsStore:
    def __init__(
        self,
        path: Path,
        connection: sqlite3.Connection,
        writer_key: str,
        clock: Callable[[], float],
    ) -> None:
        self.path = path
        self._connection = connection
        self._writer_key = writer_key
        self._clock = clock
        self._closed = False

    @classmethod
    def open(
        cls,
        path: Path,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> "MetricsStore":
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        writer_key = str(path.resolve())
        with _WRITER_LOCK:
            if writer_key in _WRITER_PATHS:
                raise RuntimeError("Observability database already has an active writer")
            _WRITER_PATHS.add(writer_key)
        connection: sqlite3.Connection | None = None
        try:
            connection = sqlite3.connect(path, timeout=5.0)
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=5000")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA wal_autocheckpoint=1000")
            migrate(connection)
            connection.commit()
            return cls(path, connection, writer_key, clock)
        except Exception:
            if connection is not None:
                connection.close()
            with _WRITER_LOCK:
                _WRITER_PATHS.discard(writer_key)
            raise

    def close(self) -> None:
        if self._closed:
            return
        try:
            self._connection.close()
        finally:
            with _WRITER_LOCK:
                _WRITER_PATHS.discard(self._writer_key)
            self._closed = True

    def scalar(self, sql: str, parameters: Sequence[object] = ()) -> object:
        row = self._connection.execute(sql, parameters).fetchone()
        return None if row is None else row[0]

    def count(self, table: str, tier: str | None = None) -> int:
        if table not in TABLES:
            raise ValueError("Unknown metrics table")
        if tier is None:
            return int(self.scalar(f"SELECT count(*) FROM {table}"))
        if tier not in TIERS:
            raise ValueError("Unknown metrics tier")
        return int(self.scalar(f"SELECT count(*) FROM {table} WHERE tier=?", (tier,)))

    def executemany(self, sql: str, rows: Iterable[Sequence[object]]) -> None:
        with self._connection:
            self._connection.executemany(sql, rows)

    def write_cycle(self, cycle: Mapping[str, object]) -> CycleWriteStatus:
        started = self._clock()
        ts_ms = cycle.get("ts_ms")
        if isinstance(ts_ms, bool) or not isinstance(ts_ms, int) or ts_ms < 0:
            raise ValueError("Cycle ts_ms must be a non-negative integer")
        workloads = cycle.get("workloads")
        services = cycle.get("services")
        capabilities = cycle.get("capabilities")
        if not isinstance(workloads, list) or not isinstance(services, list) or not isinstance(capabilities, list):
            raise ValueError("Cycle inventories must be arrays")

        connection = self._connection
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                "INSERT OR REPLACE INTO host_points(tier,ts_ms,payload_json,coverage_percent) VALUES('15s',?,?,?)",
                (ts_ms, _json_object(cycle.get("host"), "host payload"), _coverage(cycle.get("host_coverage_percent"))),
            )
            for workload in workloads:
                if not isinstance(workload, dict) or not isinstance(workload.get("workload_id"), str):
                    raise ValueError("Invalid workload payload")
                connection.execute(
                    "INSERT OR REPLACE INTO workload_points(tier,ts_ms,workload_id,payload_json,coverage_percent) VALUES('15s',?,?,?,?)",
                    (ts_ms, workload["workload_id"], _json_object(workload, "workload payload"), _coverage(workload.get("coverage_percent"))),
                )
            for service in services:
                if not isinstance(service, dict) or not isinstance(service.get("service_id"), str):
                    raise ValueError("Invalid service payload")
                connection.execute(
                    "INSERT OR REPLACE INTO service_points(tier,ts_ms,service_id,payload_json) VALUES('15s',?,?,?)",
                    (ts_ms, service["service_id"], _json_object(service, "service payload")),
                )
            for capability in capabilities:
                if not isinstance(capability, dict) or set(capability) != {"key", "state", "detail"}:
                    raise ValueError("Invalid capability payload")
                if capability["state"] not in {"available", "partial", "unavailable"}:
                    raise ValueError("Invalid capability state")
                if not all(isinstance(capability[key], str) for key in ("key", "detail")):
                    raise ValueError("Invalid capability text")
                connection.execute(
                    "INSERT OR REPLACE INTO capabilities(key,state,detail,observed_at_ms) VALUES(?,?,?,?)",
                    (capability["key"], capability["state"], capability["detail"], ts_ms),
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        duration = self._clock() - started
        return CycleWriteStatus(duration, duration > 5.0)

    def upsert_incident(self, incident: Mapping[str, object]) -> None:
        required = {"id", "state", "opened_at_ms", "visibility", "summary", "evidence"}
        if not required.issubset(incident):
            raise ValueError("Invalid incident")
        evidence = incident["evidence"]
        if isinstance(evidence, str):
            evidence_json = evidence
        else:
            evidence_json = _json_object(evidence, "incident evidence")
        if len(evidence_json.encode("utf-8")) > MAX_EVIDENCE_BYTES:
            raise ValueError("Incident evidence exceeds 256 KiB")
        try:
            decoded_evidence = json.loads(evidence_json)
        except json.JSONDecodeError as error:
            raise ValueError("Incident evidence must contain a JSON object") from error
        if not isinstance(decoded_evidence, dict):
            raise ValueError("Incident evidence must contain a JSON object")
        summary_json = _json_object(incident["summary"], "incident summary")
        with self._connection:
            self._connection.execute(
                """INSERT OR REPLACE INTO incidents(
                id,state,opened_at_ms,recovered_at_ms,visibility,summary_json,evidence_json
                ) VALUES(?,?,?,?,?,?,?)""",
                (
                    incident["id"],
                    incident["state"],
                    incident["opened_at_ms"],
                    incident.get("recovered_at_ms"),
                    incident["visibility"],
                    summary_json,
                    evidence_json,
                ),
            )

    def prune(self, now_ms: int) -> None:
        with self._connection:
            for table in TABLES:
                for tier, retention_ms in RETENTION_MS.items():
                    self._connection.execute(
                        f"DELETE FROM {table} WHERE tier=? AND ts_ms<=?",
                        (tier, now_ms - retention_ms),
                    )
            self._connection.execute(
                "DELETE FROM incidents WHERE recovered_at_ms IS NOT NULL AND recovered_at_ms<=?",
                (now_ms - INCIDENT_RETENTION_MS,),
            )

    def compact(self, now_ms: int) -> CycleWriteStatus:
        started = self._clock()
        self.prune(now_ms)
        duration = self._clock() - started
        return CycleWriteStatus(duration, duration > 5.0)

    def _run_integrity_check(self) -> str:
        return str(self.scalar("PRAGMA integrity_check"))

    def integrity_check(self) -> None:
        result = self._run_integrity_check()
        if result != "ok":
            raise RuntimeError(f"Observability database integrity check failed: {result}")

    def read_projection_snapshot(self) -> dict[str, object]:
        uri = f"file:{self.path.resolve()}?mode=ro"
        reader = sqlite3.connect(uri, uri=True, timeout=5.0)
        reader.row_factory = sqlite3.Row
        try:
            reader.execute("BEGIN")
            host = [
                {"tier": row["tier"], "ts_ms": row["ts_ms"], "payload": json.loads(row["payload_json"]), "coverage_percent": row["coverage_percent"]}
                for row in reader.execute("SELECT * FROM host_points ORDER BY ts_ms")
            ]
            workloads = [
                {"tier": row["tier"], "ts_ms": row["ts_ms"], "workload_id": row["workload_id"], "payload": json.loads(row["payload_json"]), "coverage_percent": row["coverage_percent"]}
                for row in reader.execute("SELECT * FROM workload_points ORDER BY ts_ms,workload_id")
            ]
            services = [
                {"tier": row["tier"], "ts_ms": row["ts_ms"], "service_id": row["service_id"], "payload": json.loads(row["payload_json"])}
                for row in reader.execute("SELECT * FROM service_points ORDER BY ts_ms,service_id")
            ]
            capabilities = [dict(row) for row in reader.execute("SELECT * FROM capabilities ORDER BY key")]
            incidents = [
                {
                    "id": row["id"],
                    "state": row["state"],
                    "opened_at_ms": row["opened_at_ms"],
                    "recovered_at_ms": row["recovered_at_ms"],
                    "visibility": row["visibility"],
                    "summary": json.loads(row["summary_json"]),
                    "evidence": json.loads(row["evidence_json"]),
                }
                for row in reader.execute("SELECT * FROM incidents ORDER BY opened_at_ms")
            ]
            reader.commit()
            return {"host": host, "workloads": workloads, "services": services, "capabilities": capabilities, "incidents": incidents}
        finally:
            reader.close()
