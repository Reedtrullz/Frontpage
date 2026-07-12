from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
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


def response_matches_check(response, check: object) -> bool:
    if not check or check["type"] == "http-status":
        return True
    try:
        value = json.loads(response.read(MAX_CHECK_BODY_BYTES))
        for field in check["path"]:
            if not isinstance(value, dict):
                return False
            value = value.get(field)
        return value == check["expected"]
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
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
    try:
        request = urllib.request.Request(
            str(service["url"]),
            headers={"User-Agent": STATUS_USER_AGENT},
            method="GET",
        )
        with opener(request, timeout=timeout_seconds) as response:
            latency_ms = min(10000, int(round((time.monotonic() - started) * 1000)))
            status = (
                "up"
                if response.status == int(service.get("expected_status", 200))
                and response_matches_check(response, service.get("check"))
                else "down"
            )
    except urllib.error.HTTPError as error:
        try:
            latency_ms = min(10000, int(round((time.monotonic() - started) * 1000)))
            status = (
                "up"
                if error.code == int(service.get("expected_status", 200))
                and response_matches_check(error, service.get("check"))
                else "down"
            )
        finally:
            error.close()
    except Exception as error:
        if getattr(error, "code", None) is not None:
            status = "down"
            close = getattr(error, "close", None)
            if callable(close):
                close()
        else:
            status = "unknown"
            latency_ms = None
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
    rows = tuple(service_result(service, now_ms, opener) for service in config)
    available = any(row.status != "unknown" for row in rows)
    return SourceResult(rows, available, {"service_checks": "available" if available else "unavailable"}, ())


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

