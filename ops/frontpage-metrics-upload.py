#!/usr/bin/env python3
"""Copy the active v1 collector snapshots into Frontpage's Cloudflare DO."""

import gzip
import os
from pathlib import Path
from urllib.request import Request, urlopen


def upload(root: Path, base_url: str, secret: str) -> None:
    for name, cap in (("latest.json", 512 * 1024), ("history.json", 4 * 1024 * 1024)):
        path = root / name
        data = path.read_bytes()
        if len(data) > cap:
            raise ValueError(f"{name} exceeds its application size cap")
        body = gzip.compress(data)
        if len(body) > 1024 * 1024:
            raise ValueError(f"{name} exceeds the upload size cap")
        request = Request(
            f"{base_url.rstrip('/')}/__collector/{name}",
            data=body,
            headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/gzip",
                     "User-Agent": "frontpage-metrics-upload/1"},
            method="PUT",
        )
        with urlopen(request, timeout=20) as response:
            if response.status != 204:
                raise RuntimeError(f"{name} upload returned {response.status}")


if __name__ == "__main__":
    upload(Path(os.environ["FRONTPAGE_METRICS_DIR"]), os.environ["FRONTPAGE_UPLOAD_URL"],
           Path(os.environ["FRONTPAGE_UPLOAD_SECRET_FILE"]).read_text().strip())
