#!/usr/bin/env python3
"""Copy the active v1 collector snapshots into Frontpage's Cloudflare DO."""

import argparse
from datetime import datetime
import hashlib
import json
import re
import stat
import subprocess
import time
import gzip
import os
from pathlib import Path
from urllib.request import Request, urlopen


V1_CAPS = {"latest.json": 512 * 1024, "history.json": 4 * 1024 * 1024}


def read_v1(root: Path, name: str) -> bytes:
    if root.is_symlink() or name not in V1_CAPS:
        raise ValueError("Symlinked or invalid snapshot root")
    path = root / name
    if path.is_symlink():
        raise ValueError("Symlinked snapshot")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            raise ValueError("Snapshot is not a regular file")
        data = handle.read(V1_CAPS[name] + 1)
    if len(data) > V1_CAPS[name]:
        raise ValueError(f"{name} exceeds its application size cap")
    return data


def v1_snapshot(root: Path) -> dict[str, bytes]:
    files = {name: read_v1(root, name) for name in V1_CAPS}
    latest = json.loads(files["latest.json"])
    history = json.loads(files["history.json"])
    if (latest.get("schema_version") != 1 or history.get("schema_version") != 1
            or not isinstance(history.get("samples"), list) or not history["samples"]
            or history["samples"][-1] != latest):
        raise ValueError("Snapshot pair is inconsistent")
    # The collector publishes by atomic renames, but two reads can straddle publication.
    # Reject changed inputs before the first request; retry on the next scheduled tick.
    if any(read_v1(root, name) != data for name, data in files.items()):
        raise ValueError("Snapshot changed during upload preparation")
    return files


def upload(root: Path, base_url: str, secret: str) -> None:
    files = v1_snapshot(root)
    generation = hashlib.sha256(files["latest.json"] + b"\0" + files["history.json"]).hexdigest()
    payloads = {name: gzip.compress(data, mtime=0) for name, data in files.items()}
    if any(len(body) > 1024 * 1024 for body in payloads.values()):
        raise ValueError("Snapshot exceeds the compressed upload size cap")
    payloads["v1/commit"] = b""
    for name, body in payloads.items():
        request = Request(
            f"{base_url.rstrip('/')}/__collector/{name}", data=body,
            headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/gzip",
                     "X-Frontpage-Generation": generation, "User-Agent": "frontpage-metrics-upload/1"},
            method="PUT",
        )
        with urlopen(request, timeout=20) as response:
            if response.status != 204:
                raise RuntimeError(f"{name} upload returned {response.status}")


V2_PATH = re.compile(r"^(?:latest|incidents)\.v2\.json$|^host/1h\.v2\.json$|^host/(?:minute|quarter-hour)/\d{4}-\d{2}-\d{2}\.v2\.json$|^workloads/(?:cpu|ram|disk_io|network)/(?:1h\.v2\.json|(?:minute|quarter-hour)/\d{4}-\d{2}-\d{2}\.v2\.json)$")


def read_projection(root: Path, name: str) -> bytes:
    if root.is_symlink() or (name != "manifest.v2.json" and not V2_PATH.fullmatch(name)):
        raise ValueError("Invalid projection root or path")
    root = root.resolve()
    path = root / name
    # Reject symlinks below the configured root; macOS /var itself is a system symlink.
    if any(parent.is_symlink() for parent in (path, *path.parents) if parent == root or root in parent.parents):
        raise ValueError("Symlinked projection")
    cap = 4 * 1024 * 1024 if "/" in name else 512 * 1024
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            raise ValueError("Projection is not a regular file")
        data = handle.read(cap + 1)
    if len(data) > cap:
        raise ValueError("Projection exceeds application cap")
    return data


def v2_snapshot(root: Path) -> dict[str, bytes]:
    manifest_data = read_projection(root / "owner", "manifest.v2.json")
    manifest = json.loads(manifest_data)
    if (set(manifest) != {"schema_version", "files"} or manifest["schema_version"] != 2
            or not isinstance(manifest["files"], list) or len(manifest["files"]) > 256
            or len(set(manifest["files"])) != len(manifest["files"])
            or any(not isinstance(name, str) or not V2_PATH.fullmatch(name) for name in manifest["files"])):
        raise ValueError("Invalid owner manifest")
    files = {"owner/manifest.v2.json": manifest_data}
    for namespace, names in (("public", ["latest.v2.json", "incidents.v2.json"]), ("owner", manifest["files"])):
        for name in names:
            files[namespace + "/" + name] = read_projection(root / namespace, name)
    if sum(map(len, files.values())) > 32 * 1024 * 1024:
        raise ValueError("Snapshot exceeds 32 MiB")
    latest = json.loads(files["owner/latest.v2.json"])
    collected = latest["collected_at"]
    generated = latest["generated_at"]
    collected_seconds = datetime.fromisoformat(collected.replace("Z", "+00:00")).timestamp()
    if not 0 <= time.time() - collected_seconds <= 45:
        raise ValueError("Snapshot is stale or future dated")
    for name, data in files.items():
        payload = json.loads(data)
        if name.endswith(("latest.v2.json", "incidents.v2.json", "1h.v2.json")):
            if payload["generated_at"] != generated:
                raise ValueError("Projection publication is incomplete")
        elif "/" + generated[:10] + ".v2.json" in name:
            resolution = 60 if "/minute/" in name else 900
            expected = collected_seconds // resolution * resolution
            actual = datetime.fromisoformat(payload["generated_at"].replace("Z", "+00:00")).timestamp()
            if actual != expected:
                raise ValueError("Projection rollup publication is incomplete")
        if name.endswith("latest.v2.json") and payload["collected_at"] != collected:
            raise ValueError("Latest projections disagree")
    # Reads can race the collector's multi-file publication. Reject, then try on the next timer tick.
    for name in ("public/latest.v2.json", "owner/latest.v2.json", "owner/manifest.v2.json"):
        namespace, relative = name.split("/", 1)
        if read_projection(root / namespace, relative) != files[name]:
            raise ValueError("Projection changed during upload preparation")
    return files


def send_v2(base_url: str, secret: str, action: str, body: bytes, *, json_body=False):
    request = Request(f"{base_url.rstrip('/')}/__collector/v2/{action}", data=body,
                      headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json" if json_body else "application/gzip",
                               "User-Agent": "frontpage-metrics-upload/2"}, method="PUT")
    with urlopen(request, timeout=5) as response:
        if response.status not in (200, 204):
            raise RuntimeError(f"v2 {action} returned {response.status}")
        if response.status == 200:
            data = response.read(512 * 1024 + 1)
            if len(data) > 512 * 1024:
                raise ValueError("Upload response exceeds cap")
            return json.loads(data)
    return None


def upload_v2(root: Path, base_url: str, secret: str) -> None:
    files = v2_snapshot(root)
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    body = json.dumps({"schema_version": 2, "files": hashes}, separators=(",", ":")).encode()
    if len(body) > 512 * 1024:
        raise ValueError("Upload manifest exceeds cap")
    missing = send_v2(base_url, secret, "prepare", body, json_body=True)["missing"]
    if not isinstance(missing, list) or len(missing) > 259 or any(value not in hashes.values() for value in missing):
        raise ValueError("Invalid missing-file response")
    by_hash = {hashes[name]: data for name, data in files.items()}
    for value in set(missing):
        compressed = gzip.compress(by_hash[value], compresslevel=1, mtime=0)
        if len(compressed) > 1024 * 1024:
            raise ValueError("Projection exceeds compressed upload cap")
        send_v2(base_url, secret, value, compressed)
    send_v2(base_url, secret, "commit", body, json_body=True)


def fresh_acceptance() -> dict:
    # Invoke the installed comparator; a cached shadow-gate.json is never promotion proof.
    result = subprocess.run([
        "/usr/local/bin/frontpage-metrics-shadow-compare",
        "--v1-history", "/var/lib/frontpage-metrics/v1/comparison-history.json",
        "--v2-database", "/var/lib/frontpage-metrics/private/metrics-v2-shadow.sqlite3",
        "--projection-root", "/var/lib/frontpage-metrics/v2-shadow",
        "--evidence-epoch", "/var/lib/frontpage-metrics/shadow-evidence-epoch.json",
        "--output", "/var/lib/frontpage-metrics/shadow-gate.json",
    ], capture_output=True, text=True, check=True, timeout=60)
    gate = json.loads(result.stdout)
    if gate.get("schema_version") != 3 or gate.get("approved") is not True:
        raise ValueError("Fresh schema-3 acceptance is required")
    return gate


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--v2", action="store_true")
    parser.add_argument("--activate", action="store_true")
    parser.add_argument("--deactivate", action="store_true")
    parser.add_argument("--expected-version")
    args = parser.parse_args()
    root = Path(os.environ["FRONTPAGE_METRICS_DIR"])
    url = os.environ["FRONTPAGE_UPLOAD_URL"]
    secret = Path(os.environ["FRONTPAGE_UPLOAD_SECRET_FILE"]).read_text().strip()
    if args.activate:
        if not args.v2 or not re.fullmatch(r"[a-f0-9]{40}", args.expected_version or "") or args.deactivate:
            parser.error("--activate requires --v2 and an exact --expected-version")
        fresh_acceptance()  # Fail before uploads or activation when the real gate has not passed.
        upload_v2(root, url, secret)
        gate = fresh_acceptance()  # Upload time cannot make the acceptance receipt stale.
        send_v2(url, secret, "activate", json.dumps({"version": args.expected_version, "gate": gate}).encode(), json_body=True)
    elif args.deactivate:
        send_v2(url, secret, "deactivate", b"")
    elif args.v2:
        upload_v2(root, url, secret)
    else:
        upload(root, url, secret)
