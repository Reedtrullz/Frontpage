#!/usr/bin/env python3
import argparse
import signal
import sys
import threading
from dataclasses import replace
from pathlib import Path


for candidate in (Path(__file__).resolve().parent.parent, Path("/usr/local/lib/frontpage")):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from ops.frontpage_metrics_v2.collector import LinuxCycleCollector
from ops.frontpage_metrics_v2.config import load_config
from ops.frontpage_metrics_v2.daemon import CollectorDaemon
from ops.frontpage_metrics_v2.incidents import IncidentEngine
from ops.frontpage_metrics_v2.projections import build_projection_files
from ops.frontpage_metrics_v2.publisher import ProjectionPublisher
from ops.frontpage_metrics_v2.store import MetricsStore


def parse_args():
    parser = argparse.ArgumentParser(description="Collect Frontpage observability projections")
    parser.add_argument("--config", required=True)
    parser.add_argument("--metrics-dir", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--runtime-map", required=True)
    parser.add_argument("--once", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    metrics_dir = Path(args.metrics_dir)
    config = replace(
        load_config(Path(args.config)),
        public_dir=metrics_dir / "public",
        owner_dir=metrics_dir / "owner",
        database_path=Path(args.database),
        runtime_map_path=Path(args.runtime_map),
    )
    store = MetricsStore.open(config.database_path)
    stop_event = threading.Event()

    def stop(_signum, _frame):
        stop_event.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    daemon = CollectorDaemon(
        LinuxCycleCollector(config),
        store,
        IncidentEngine(config.thresholds),
        ProjectionPublisher(config.public_dir, config.owner_dir),
        interval_seconds=config.sample_interval_seconds,
        projection_builder=build_projection_files,
    )
    try:
        if args.once:
            daemon.run_once()
        else:
            daemon.run_forever(stop_event)
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
