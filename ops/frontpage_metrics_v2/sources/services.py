from __future__ import annotations

import json
import time
import sys
import urllib.error
import urllib.request
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Callable, Mapping

from ..model import ServiceSample, SourceResult


STATUS_USER_AGENT = "reidar-tech-status/1.0"
MAX_CHECK_BODY_BYTES = 64 * 1024


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


STATUS_OPENER = urllib.request.build_opener(NoRedirectHandler())


def open_status_request(request, timeout):
    return STATUS_OPENER.open(request, timeout=timeout)


def response_matches_check(response, check: object, on_error=None) -> bool:
    if not check or check["type"] == "http-status":
        return True
    try:
        value = json.loads(response.read(MAX_CHECK_BODY_BYTES))
        for field in check["path"]:
            if not isinstance(value, dict):
                return False
            value = value.get(field)
        return value == check["expected"]
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        if on_error is not None:
            on_error(error)
        return False


def service_result(
    service: Mapping[str, object],
    now_ms: int,
    opener: Callable = open_status_request,
) -> ServiceSample:
    started = time.monotonic()
    timeout_seconds = max(1000, min(int(service.get("timeout_ms", 5000)), 10000)) / 1000
    status = "unknown"
    latency_ms = None
    phase = "open"
    http_status = None
    failure = None

    def body_failed(error):
        nonlocal failure
        failure = error

    try:
        request = urllib.request.Request(
            str(service["url"]),
            headers={"User-Agent": STATUS_USER_AGENT},
            method="GET",
        )
        with opener(request, timeout=timeout_seconds) as response:
            http_status = response.status
            phase = "body_check" if response.status == int(service.get("expected_status", 200)) else "http_status"
            latency_ms = min(10000, int(round((time.monotonic() - started) * 1000)))
            status = (
                "up"
                if response.status == int(service.get("expected_status", 200))
                and response_matches_check(response, service.get("check"), body_failed)
                else "down"
            )
    except urllib.error.HTTPError as error:
        http_status = error.code
        failure = error
        phase = "http_status"
        try:
            latency_ms = min(10000, int(round((time.monotonic() - started) * 1000)))
            status = (
                "up"
                if error.code == int(service.get("expected_status", 200))
                and response_matches_check(error, service.get("check"), body_failed)
                else "down"
            )
        finally:
            error.close()
    except Exception as error:
        failure = error
        if getattr(error, "code", None) is not None:
            status = "down"
            http_status = error.code
            close = getattr(error, "close", None)
            if callable(close):
                close()
        else:
            status = "unknown"
            latency_ms = None
    if status != "up":
        reason = getattr(failure, "reason", failure)
        # Deliberately omit exception text, URLs, response body and headers.
        print(json.dumps({
            "event": "frontpage_service_check_failed", "service_id": str(service["id"]),
            "ts_ms": now_ms, "status": status, "phase": phase,
            "error_type": type(failure).__name__ if failure is not None else None,
            "reason_type": type(reason).__name__ if reason is not None else None,
            "errno": getattr(reason, "errno", None) if isinstance(getattr(reason, "errno", None), int) else None,
            "http_status": http_status if isinstance(http_status, int) else None,
            "duration_seconds": time.monotonic() - started,
        }), file=sys.stderr, flush=True)
    return ServiceSample(
        id=str(service["id"]),
        visibility=service["visibility"],
        status=status,
        checked_at_ms=now_ms,
        latency_ms=latency_ms,
    )


def collect_services(
    config: tuple[Mapping[str, object], ...],
    now_ms: int,
    opener: Callable = open_status_request,
) -> SourceResult[tuple[ServiceSample, ...]]:
    with ThreadPoolExecutor(max_workers=8) as checks:
        rows = tuple(checks.map(lambda service: service_result(service, now_ms, opener), config))
    available = any(row.status != "unknown" for row in rows)
    return SourceResult(rows, available, {"service_checks": "available" if available else "unavailable"}, ())


class ServiceBatches:
    """One in-flight batch; a hung check never creates an unbounded backlog."""
    def __init__(self, config, *, opener=open_status_request):
        self.config = config
        self.opener = opener
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="frontpage-service-batch")
        self.pending = None

    def start(self, now_ms):
        if self.pending is not None and not self.pending.done():
            print(json.dumps({"event": "frontpage_service_batch_unavailable", "ts_ms": now_ms,
                              "reason": "previous_batch_pending"}), file=sys.stderr, flush=True)
            result = Future()
            result.set_result(SourceResult(
                tuple(ServiceSample(str(service["id"]), service["visibility"], "unknown", now_ms, None)
                      for service in self.config),
                False, {"service_checks": "unavailable"}, ("Service checks unavailable: previous batch pending.",),
            ))
            return result
        self.pending = self.executor.submit(collect_services, self.config, now_ms, self.opener)
        return self.pending

    def close(self):
        self.executor.shutdown(wait=True, cancel_futures=True)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def legacy_service_result(
    service: Mapping[str, object],
    opener: Callable = open_status_request,
    now: Callable[[], str] = _utc_now,
) -> dict[str, object]:
    row = service_result(service, int(time.time() * 1000), opener)
    result: dict[str, object] = {
        "id": service["id"],
        "label": service["label"],
        "visibility": service["visibility"],
        "status": row.status,
        "checked_at": now(),
        "latency_ms": row.latency_ms,
    }
    if service.get("project_slug"):
        result["project_slug"] = service["project_slug"]
    return result
