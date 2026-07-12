# Frontpage Observability Dashboard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `reidar.tech/status` page with owner-only, high-resolution host charts, explainable workload attribution, bounded incidents, and tiered retention while preserving the public trust boundary and read-only web runtime.

**Architecture:** A hardened Python Collector v2 samples Linux host and allowlisted workload sources every 15 seconds, stores private working state in SQLite, and atomically publishes physically separate public and owner JSON projections. Next.js reads the public projection for every visitor and opens owner projections only after independent server-side ownership verification; a small client chart surface fetches fixed, authenticated ranges on demand.

**Tech Stack:** Python 3 standard library, SQLite WAL, Linux `/proc` and cgroup v2, systemd, Next.js 16 App Router, React 19, TypeScript, Zod 4, Tailwind CSS 4, `uplot@1.6.32`, Vitest, Playwright, axe, Docker, and Ansible.

## Global Constraints

- Preserve the existing `/status` structure, typography, spacing, border treatment, semantic colors, public service inventory, and owner transition.
- Public routes may expose only coarse resource states, public service evidence, public-safe incidents, maintenance, freshness, and coverage.
- Public routes must never open or serialize owner projection files.
- Exact host values, workloads, systemd units, cgroups, containers, processes, diagnostics, PSI details, and owner incident evidence remain owner-only.
- The web container receives no shell, SSH, Docker socket, host PID namespace, host `/proc`, host cgroup mount, restart/deploy/prune controls, collector database, or writable metrics path.
- Retention is exactly `15 seconds for 1 hour`, `1 minute for 7 days`, and `15 minutes for 30 days`; bounded incident evidence is retained for 90 days.
- Workload identity is allowlisted and capped at 32. Current process drilldown is capped at 20 processes per workload.
- Process fields are positively allowlisted to `pid`, `comm`, `uid`, `cpu_percent`, `rss_bytes`, `state`, and normalized workload ID.
- Command lines, arguments, environment variables, executable paths, working directories, open files, sockets, and historical PID series are forbidden.
- Disk capacity is a host gauge and is never attributed to workloads; disk I/O is attributed separately.
- Phase-one network data is host-interface-only. Workload network mode is capability-unavailable until a separately reviewed eBPF helper is active.
- Collector v2 is the sole SQLite writer. Publication occurs only after incident evaluation and transactional compaction.
- Missing, stale, reset, truncated, unsupported, and partially attributed states must remain explicit; never fabricate continuity or healthy state.
- The dashboard remains read-only: no acknowledgements, notifications, restart actions, or operational mutations.
- Keep schema v1 and the existing owner panel available through shadow rollout and rollback.
- Do not implement or grant eBPF capabilities in this plan. Produce the compatibility/security gate that a separate eBPF plan will consume.
- Use the accepted existing-system modification concept, not a new monitoring-console redesign. Image generation is intentionally skipped because this is an approved modification inside an existing design system with a supplied PDF reference.
- Validate rendered frontend work with the Browser plugin first. Playwright is the fallback only when Browser is unavailable or fails, and the fallback reason must be recorded.
- Before long build/test loops, stop if `df -h /System/Volumes/Data` reports less than 30 GiB free.

## File and Ownership Map

| Area | Files | Responsibility |
|---|---|---|
| V2 contracts | `src/lib/metrics/v2/types.ts`, `schema.ts`, JSON schemas and fixtures | Strict public/owner/series/incident boundaries and bounds |
| Collector config/model | `ops/frontpage_metrics_v2/config.py`, `model.py` | Validated settings, allowlisted workloads, typed internal records |
| Linux collection | `ops/frontpage_metrics_v2/sources/*.py` | `/proc`, cgroup v2, PSI, service and process collection |
| Persistence | `ops/frontpage_metrics_v2/store.py`, `migrations.py` | SQLite WAL, schema, retention, transactions, integrity |
| Rollups/incidents | `rollups.py`, `incidents.py` | Metric-specific aggregation, hysteresis, evidence envelopes |
| Publication/daemon | `publisher.py`, `daemon.py`, executable wrapper | Atomic public/owner projections and 15-second lifecycle |
| Deployment | systemd units, Ansible, CI, deployment docs | Shadow mode, permissions, runtime mapping, promotion/rollback proof |
| Next.js read/API | `src/lib/metrics/v2/reader.ts`, owner API routes | Auth-first path selection, ETags, caps, fixed query enums |
| Chart client | `src/components/dashboard/observability/*` | Polling, range control, uPlot lifecycle, accessible summaries |
| Status composition | `OwnerObservabilityPanel.tsx`, `/status` page | Approved resource rows, workloads, incidents, v1 fallback |
| Public status | public incident and maintenance modules | Public-safe incident history and repository-owned maintenance |

---

### Task 1: Freeze Schema v2 Contracts and Cross-Language Fixtures

**Files:**
- Create: `src/lib/metrics/v2/types.ts`
- Create: `src/lib/metrics/v2/schema.ts`
- Create: `src/lib/metrics/v2/schema.test.ts`
- Create: `docs/superpowers/specs/2026-07-12-frontpage-observability-public.schema.v2.json`
- Create: `docs/superpowers/specs/2026-07-12-frontpage-observability-owner.schema.v2.json`
- Create: `docs/superpowers/specs/2026-07-12-frontpage-observability-series.schema.v2.json`
- Create: `docs/superpowers/specs/2026-07-12-frontpage-observability-incidents.schema.v2.json`
- Create: `ops/tests/fixtures/observability-v2/public-latest.json`
- Create: `ops/tests/fixtures/observability-v2/owner-latest.json`
- Create: `ops/tests/fixtures/observability-v2/host-series-1h.json`
- Create: `ops/tests/fixtures/observability-v2/incidents.json`
- Create: `ops/tests/test_frontpage_metrics_v2_contracts.py`

**Interfaces:**
- Produces `PublicLatestV2`, `OwnerLatestV2`, `SeriesV2`, `IncidentListV2`, `ObservabilityRange`, `ObservabilityView`, and `ObservabilityResource`.
- Produces `parsePublicLatestV2`, `parseOwnerLatestV2`, `parseSeriesV2`, and `parseIncidentListV2`.
- All objects are strict, timestamps are UTC ISO strings ending in `Z`, IDs match `^[a-z0-9][a-z0-9-]{0,62}$`, and arrays enforce the approved caps.

- [ ] **Step 1: Add failing TypeScript contract tests**

Add tests that import the four fixtures and prove public rejection of owner fields:

```ts
import publicFixture from "../../../../ops/tests/fixtures/observability-v2/public-latest.json";
import ownerFixture from "../../../../ops/tests/fixtures/observability-v2/owner-latest.json";
import seriesFixture from "../../../../ops/tests/fixtures/observability-v2/host-series-1h.json";
import incidentsFixture from "../../../../ops/tests/fixtures/observability-v2/incidents.json";
import {
  parseIncidentListV2,
  parseOwnerLatestV2,
  parsePublicLatestV2,
  parseSeriesV2,
} from "./schema";

it("parses the canonical v2 fixtures", () => {
  expect(parsePublicLatestV2(publicFixture).schema_version).toBe(2);
  expect(parseOwnerLatestV2(ownerFixture).workloads).toHaveLength(2);
  expect(parseSeriesV2(seriesFixture).range).toBe("1h");
  expect(parseIncidentListV2(incidentsFixture).incidents).toHaveLength(1);
});

it("rejects owner identities in the public contract", () => {
  expect(() =>
    parsePublicLatestV2({ ...publicFixture, workloads: ownerFixture.workloads }),
  ).toThrow(/Invalid public observability payload/);
});
```

- [ ] **Step 2: Add failing Python fixture-boundary tests**

Use a small standard-library fixture validator so the contract gate adds no Python dependency. Validate required keys, bounds, IDs, and forbidden public keys explicitly:

```python
FORBIDDEN_PUBLIC_KEYS = {
    "workloads", "processes", "diagnostics", "cgroup_path",
    "systemd_unit", "container_id", "cpu_percent", "rss_bytes",
}

def test_public_fixture_contains_no_owner_keys(self):
    payload = json.loads((FIXTURES / "public-latest.json").read_text())
    serialized_keys = collect_keys(payload)
    self.assertTrue(FORBIDDEN_PUBLIC_KEYS.isdisjoint(serialized_keys))
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npm test -- src/lib/metrics/v2/schema.test.ts
python3 -m unittest ops.tests.test_frontpage_metrics_v2_contracts
```

Expected: both commands fail because the v2 types, parsers, and fixtures do not exist.

- [ ] **Step 4: Implement exact bounded TypeScript contracts**

Define the closed enums and top-level shapes first:

```ts
export const OBSERVABILITY_SCHEMA_VERSION = 2 as const;
export const OBSERVABILITY_RANGES = ["1h", "24h", "7d", "30d"] as const;
export const OBSERVABILITY_VIEWS = ["host", "workloads"] as const;
export const OBSERVABILITY_RESOURCES = ["cpu", "ram", "disk_io", "network"] as const;
export const MAX_WORKLOADS = 32;
export const MAX_PROCESSES_PER_WORKLOAD = 20;
export const MAX_INCIDENTS = 256;

export type ObservabilityRange = (typeof OBSERVABILITY_RANGES)[number];
export type ObservabilityView = (typeof OBSERVABILITY_VIEWS)[number];
export type ObservabilityResource = (typeof OBSERVABILITY_RESOURCES)[number];
export type CapabilityState = "available" | "partial" | "unavailable";
export type DataFreshness = "fresh" | "stale" | "unavailable";
export type IncidentSeverity = "warning" | "critical";
export type IncidentState = "active" | "recovered" | "maintenance";
```

Use columnar series fields:

```ts
export interface SeriesV2 {
  schema_version: 2;
  generated_at: string;
  range: ObservabilityRange;
  resolution_seconds: 15 | 60 | 900;
  view: ObservabilityView;
  resource: ObservabilityResource | null;
  timestamps: string[];
  series: Array<{ id: string; label: string; unit: string; values: Array<number | null> }>;
  coverage_percent: number;
  truncated: boolean;
}
```

Build strict Zod schemas with these limits: `240` points for `1h`, `1440` for `24h`, `10080` for `7d`, and `2880` for `30d`; at most `32` workloads, `20` processes per workload, and `256` incidents.

- [ ] **Step 5: Write representative public/owner/series/incident fixtures and JSON Schemas**

Fixtures must include host totals, `system/untracked`, one missing point, a capability-unavailable network workload view, one recovered owner incident, and a public incident without private evidence. JSON Schemas must set `additionalProperties: false` at every object boundary.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
npm test -- src/lib/metrics/v2/schema.test.ts
python3 -m unittest ops.tests.test_frontpage_metrics_v2_contracts
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/metrics/v2 docs/superpowers/specs/*observability*schema.v2.json ops/tests/fixtures/observability-v2 ops/tests/test_frontpage_metrics_v2_contracts.py
git commit -m "feat: define observability v2 contracts"
```

---

### Task 2: Validate Collector v2 Configuration and Internal Models

**Files:**
- Create: `ops/frontpage_metrics_v2/__init__.py`
- Create: `ops/frontpage_metrics_v2/model.py`
- Create: `ops/frontpage_metrics_v2/config.py`
- Create: `ops/frontpage-metrics-v2.config.json`
- Create: `ops/tests/test_frontpage_metrics_v2_config.py`

**Interfaces:**
- Produces immutable dataclasses `CollectorConfig`, `WorkloadConfig`, `ThresholdConfig`, `HostSample`, `WorkloadSample`, `ProcessSample`, `CapabilityReport`, and `SourceResult[T]`.
- Produces `load_config(path: Path) -> CollectorConfig`.
- Workload match kinds are exactly `systemd-unit`, `cgroup-path`, and `cgroup-pattern`; deployment runtime mappings resolve container cgroups before collection.

- [ ] **Step 1: Add failing config tests**

Cover duplicate IDs, more than 32 workloads, unanchored patterns, patterns longer than 160 characters, secret URLs, invalid retention values, network attribution declared without capability, and valid config parsing:

```python
def test_rejects_unanchored_cgroup_pattern(self):
    payload = valid_config()
    payload["workloads"][0]["match"] = {
        "type": "cgroup-pattern",
        "value": "docker-.*",
    }
    with self.assertRaisesRegex(ValueError, "anchored"):
        load_payload(payload)

def test_retention_is_fixed(self):
    config = load_payload(valid_config())
    self.assertEqual(config.raw_retention_seconds, 3600)
    self.assertEqual(config.minute_retention_seconds, 7 * 86400)
    self.assertEqual(config.quarter_hour_retention_seconds, 30 * 86400)
```

- [ ] **Step 2: Run tests and verify RED**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_v2_config
```

Expected: import failure for `ops.frontpage_metrics_v2.config`.

- [ ] **Step 3: Implement dataclasses and strict config loading**

Use frozen dataclasses and positive field parsing:

```python
@dataclass(frozen=True)
class WorkloadConfig:
    id: str
    label: str
    match_type: Literal["systemd-unit", "cgroup-path", "cgroup-pattern"]
    match_value: str
    project_slug: str | None

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
    workloads: tuple[WorkloadConfig, ...]
    services: tuple[dict[str, object], ...]
```

Require exact approved values `15`, `3600`, `604800`, `2592000`, and `7776000`. Reuse the v1 URL/check validation rules without importing the executable script; move shared service validation into `ops/frontpage_metrics_v2/config.py` and leave a compatibility wrapper in v1 later.

- [ ] **Step 4: Add the production v2 config**

Declare the five public services, Frontpage internal service, allowlisted workloads, configured root filesystem, block device names, network interfaces, and alert thresholds. Container cgroup entries use a deployment-generated runtime mapping file, never Docker discovery.

- [ ] **Step 5: Run focused tests and compile**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_v2_config
python3 -m py_compile ops/frontpage_metrics_v2/*.py
```

- [ ] **Step 6: Commit**

```bash
git add ops/frontpage_metrics_v2 ops/frontpage-metrics-v2.config.json ops/tests/test_frontpage_metrics_v2_config.py
git commit -m "feat: validate observability collector config"
```

---

### Task 3: Collect Host, Cgroup, PSI, Service, and Sanitized Process Evidence

**Files:**
- Create: `ops/frontpage_metrics_v2/sources/__init__.py`
- Create: `ops/frontpage_metrics_v2/sources/procfs.py`
- Create: `ops/frontpage_metrics_v2/sources/cgroup.py`
- Create: `ops/frontpage_metrics_v2/sources/processes.py`
- Create: `ops/frontpage_metrics_v2/sources/services.py`
- Create: `ops/frontpage_metrics_v2/sources/runtime.py`
- Create: `ops/tests/fixtures/observability-v2/proc/`
- Create: `ops/tests/fixtures/observability-v2/cgroup/`
- Create: `ops/tests/test_frontpage_metrics_v2_sources.py`
- Modify: `ops/frontpage-metrics-collector.py`
- Modify: `ops/tests/test_frontpage_metrics_collector.py`

**Interfaces:**
- Produces `collect_host(previous, paths, now) -> SourceResult[HostSample]`.
- Produces `collect_workloads(config, previous, cgroup_root, now) -> SourceResult[tuple[WorkloadSample, ...]]`.
- Produces `collect_processes(workload_pids, proc_root, previous, now) -> SourceResult[dict[str, tuple[ProcessSample, ...]]]`.
- Produces `collect_services(config, now) -> SourceResult[tuple[ServiceSample, ...]]` while preserving no-redirect and redaction behavior.

- [ ] **Step 1: Add fixture-based failing source tests**

Test CPU/disk/network positive deltas, reboot/reset boundaries, memory, PSI present/absent, cgroup CPU/memory/I/O/OOM, process field allowlist, process cap/ranking, and partial source failure:

```python
def test_process_rows_expose_only_positive_allowlist(self):
    result = collect_processes(
        {"frontpage": (123,)}, FIXTURES / "proc", previous={}, now_ms=2000
    )
    row = asdict(result.value["frontpage"][0])
    self.assertEqual(
        set(row),
        {"pid", "comm", "uid", "cpu_percent", "rss_bytes", "state", "workload_id"},
    )
    self.assertNotIn("SECRET_TOKEN", json.dumps(row))

def test_missing_psi_is_a_capability_gap_not_sample_failure(self):
    result = collect_host(None, fixture_paths(psi=False), now_ms=1000)
    self.assertTrue(result.available)
    self.assertEqual(result.capabilities["psi"], "unavailable")
```

- [ ] **Step 2: Run tests and verify RED**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_v2_sources
```

- [ ] **Step 3: Implement `/proc` host collection**

Parse counters once per cycle and calculate rates from the prior sample using monotonic elapsed time. Return `None` for rates across boot ID changes, counter decreases, or non-positive elapsed time. Do not sleep inside a source collector.

Use `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`, `/proc/uptime`, `/proc/diskstats`, `/proc/net/dev`, `/proc/net/snmp`, and optional `/proc/pressure/*`.

- [ ] **Step 4: Implement cgroup v2 and runtime mapping collection**

Resolve configured workloads under a fixed cgroup root. Reject resolved paths outside that root. Read `cpu.stat`, `memory.current`, `memory.events`, `io.stat`, and optional pressure files. Runtime mapping JSON is strict and contains only workload ID, cgroup relative path, active image SHA, and generated timestamp.

- [ ] **Step 5: Implement sanitized process sampling**

Read only `/proc/<pid>/stat`, `/proc/<pid>/status`, and `/proc/<pid>/cgroup`. Use clock ticks and page size from `os.sysconf`. Keep the highest 20 rows by CPU then RSS. Never read `cmdline`, `environ`, `cwd`, `exe`, `fd`, or `net`.

- [ ] **Step 6: Extract service checking without regressions**

Move no-redirect HTTP checking and bounded JSON-field validation into `sources/services.py`. Keep v1 functions as imports/wrappers so all existing collector tests continue to pass.

- [ ] **Step 7: Run focused and compatibility tests**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_v2_sources
python3 -m unittest ops.tests.test_frontpage_metrics_collector
python3 -m compileall -q ops/frontpage_metrics_v2 ops/frontpage-metrics-collector.py
```

- [ ] **Step 8: Commit**

```bash
git add ops/frontpage_metrics_v2/sources ops/tests/fixtures/observability-v2 ops/tests/test_frontpage_metrics_v2_sources.py ops/frontpage-metrics-collector.py ops/tests/test_frontpage_metrics_collector.py
git commit -m "feat: collect bounded Linux workload evidence"
```

---

### Task 4: Add SQLite WAL Storage, Retention, and Integrity Boundaries

**Files:**
- Create: `ops/frontpage_metrics_v2/migrations.py`
- Create: `ops/frontpage_metrics_v2/store.py`
- Create: `ops/tests/test_frontpage_metrics_v2_store.py`

**Interfaces:**
- Produces `MetricsStore.open(path)`, `write_cycle(cycle)`, `read_projection_snapshot()`, `integrity_check()`, `compact(now_ms)`, and `prune(now_ms)`.
- All writes use one connection and explicit transactions. Projection reads use a separate read transaction after compaction commits.

- [ ] **Step 1: Add failing store and time-travel tests**

```python
def test_exact_tier_retention_boundaries(self):
    store = open_store()
    seed_points(store, now_ms=NOW)
    store.prune(NOW)
    self.assertEqual(store.count("15s"), 240)
    self.assertEqual(store.count("1m"), 10080)
    self.assertEqual(store.count("15m"), 2880)

def test_database_uses_wal_and_one_writer(self):
    store = open_store()
    self.assertEqual(store.scalar("PRAGMA journal_mode"), "wal")
    self.assertEqual(store.scalar("PRAGMA foreign_keys"), 1)
```

Also cover migration idempotence, rollback on partial write, incident retention, integrity failure, and write duration above 5 seconds.

- [ ] **Step 2: Run tests and verify RED**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_v2_store
```

- [ ] **Step 3: Implement the exact schema migration**

Create tables:

```sql
CREATE TABLE schema_meta(version INTEGER NOT NULL);
CREATE TABLE host_points(
  tier TEXT NOT NULL CHECK(tier IN ('15s','1m','15m')),
  ts_ms INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  coverage_percent REAL NOT NULL CHECK(coverage_percent BETWEEN 0 AND 100),
  PRIMARY KEY(tier, ts_ms)
);
CREATE TABLE workload_points(
  tier TEXT NOT NULL CHECK(tier IN ('15s','1m','15m')),
  ts_ms INTEGER NOT NULL,
  workload_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  coverage_percent REAL NOT NULL CHECK(coverage_percent BETWEEN 0 AND 100),
  PRIMARY KEY(tier, ts_ms, workload_id)
);
CREATE TABLE service_points(
  tier TEXT NOT NULL CHECK(tier IN ('15s','1m','15m')),
  ts_ms INTEGER NOT NULL,
  service_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(tier, ts_ms, service_id)
);
CREATE TABLE incidents(
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  opened_at_ms INTEGER NOT NULL,
  recovered_at_ms INTEGER,
  visibility TEXT NOT NULL CHECK(visibility IN ('public','owner')),
  summary_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK(length(evidence_json) <= 262144)
);
CREATE TABLE capabilities(
  key TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  detail TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL
);
```

Payload JSON is internal typed storage, not a public contract. Validate every payload before insertion.

- [ ] **Step 4: Implement transactions, integrity, and watchdog results**

Set `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=FULL`, and `wal_autocheckpoint=1000`. Return a cycle status that tells the daemon to skip one cadence when write/compact duration exceeds 5 seconds.

- [ ] **Step 5: Run focused tests**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_v2_store
```

- [ ] **Step 6: Commit**

```bash
git add ops/frontpage_metrics_v2/migrations.py ops/frontpage_metrics_v2/store.py ops/tests/test_frontpage_metrics_v2_store.py
git commit -m "feat: persist bounded observability history"
```

---

### Task 5: Implement Metric-Specific Rollups and Incident Evidence

**Files:**
- Create: `ops/frontpage_metrics_v2/rollups.py`
- Create: `ops/frontpage_metrics_v2/incidents.py`
- Create: `ops/tests/test_frontpage_metrics_v2_rollups.py`
- Create: `ops/tests/test_frontpage_metrics_v2_incidents.py`

**Interfaces:**
- Produces `rollup_host(points, bucket)`, `rollup_workload(points, bucket)`, and `rollup_service(points, bucket)`.
- Produces `IncidentEngine.evaluate(cycle, active_incidents) -> IncidentTransitionSet`.
- Incident evaluation must complete before compaction may consume raw rows.

- [ ] **Step 1: Add failing aggregation tests**

Test gauges, counters, PSI, service states, gaps, resets, and coverage:

```python
def test_counter_rollup_sums_positive_deltas_and_tracks_resets(self):
    result = rollup_counter([100, 140, 20, 50], expected_samples=4)
    self.assertEqual(result.sum_delta, 70)
    self.assertEqual(result.reset_count, 1)
    self.assertEqual(result.coverage_percent, 100.0)

def test_gauge_rollup_keeps_peak(self):
    result = rollup_gauge([10.0, 95.0, 20.0], expected_samples=4)
    self.assertEqual(result.maximum, 95.0)
    self.assertEqual(result.coverage_percent, 75.0)
```

- [ ] **Step 2: Add failing incident state-machine tests**

Cover collector freshness, two-failure/two-success services, disk 80/90 thresholds, OOM counter increase, hysteresis, PSI disabled, incident recovery, and evidence pinning:

```python
def test_compaction_cannot_orphan_incident_evidence(self):
    store = seeded_store_with_cpu_spike()
    transitions = engine.evaluate(store.latest_cycle(), [])
    store.persist_incidents(transitions)
    store.compact(NOW + 3600_000)
    incident = store.get_incident(transitions.opened[0].id)
    self.assertGreater(len(incident.evidence["points"]), 0)
    self.assertLessEqual(len(json.dumps(incident.evidence).encode()), 256 * 1024)
```

- [ ] **Step 3: Run tests and verify RED**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_v2_rollups ops.tests.test_frontpage_metrics_v2_incidents
```

- [ ] **Step 4: Implement metric-specific aggregation**

Use the design-spec aggregation table exactly. Bucket boundaries are UTC epoch multiples. Do not average rates across missing time; compute coverage from expected samples and elapsed covered duration.

- [ ] **Step 5: Implement incident rules and evidence envelopes**

Rules are config-backed. Persist rule ID, severity, visibility, state, values, coverage, capability state, and at most 5 minutes before plus 5 minutes after/recovery evidence. Throughput alone never triggers disk or network incidents.

- [ ] **Step 6: Run focused tests**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_v2_rollups ops.tests.test_frontpage_metrics_v2_incidents
```

- [ ] **Step 7: Commit**

```bash
git add ops/frontpage_metrics_v2/rollups.py ops/frontpage_metrics_v2/incidents.py ops/tests/test_frontpage_metrics_v2_rollups.py ops/tests/test_frontpage_metrics_v2_incidents.py
git commit -m "feat: roll up metrics and preserve incidents"
```

---

### Task 6: Publish Atomic Projections and Run Collector v2 as a Daemon

**Files:**
- Create: `ops/frontpage_metrics_v2/publisher.py`
- Create: `ops/frontpage_metrics_v2/daemon.py`
- Create: `ops/frontpage-metrics-collector-v2.py`
- Create: `ops/tests/test_frontpage_metrics_v2_publisher.py`
- Create: `ops/tests/test_frontpage_metrics_v2_daemon.py`

**Interfaces:**
- Produces `ProjectionPublisher.publish(snapshot) -> PublicationResult`.
- Produces `CollectorDaemon.run_forever(stop_event)` and `run_once()` for tests and deployment preflight.
- Publishes separate `public/` and `owner/` trees with mode `0640` and directories `0750`.

- [ ] **Step 1: Add failing publication tests**

Cover atomic replacement, cleanup, fsync, strict permissions, public forbidden-key scan, daily chunk naming, payload caps, top-16 truncation, manifest allowlist, and preservation of prior files on failure.

```python
def test_public_projection_rejects_private_keys_before_write(self):
    projection = valid_public_projection()
    projection["workloads"] = [{"id": "frontpage"}]
    with self.assertRaisesRegex(ValueError, "forbidden public key"):
        publisher.publish_public(projection)

def test_large_workload_projection_truncates_and_declares_it(self):
    projection = publisher.build_workload_series(seed_workloads(500))
    self.assertTrue(projection["truncated"])
    self.assertLessEqual(len(projection["series"]), 17)  # top 16 + system/untracked
```

- [ ] **Step 2: Add failing daemon lifecycle tests**

Use a fake monotonic clock to prove 15-second cadence, no overlapping cycles, one skipped cycle after a 5-second write, immediate boot cycle, clean SIGTERM, and source-partial success.

- [ ] **Step 3: Run tests and verify RED**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_v2_publisher ops.tests.test_frontpage_metrics_v2_daemon
```

- [ ] **Step 4: Implement atomic projection publication**

Reuse the proven unique-temp-file, flush, file fsync, `os.replace`, and directory fsync sequence. Generate current-hour and current-day chunks only; closed day chunks remain immutable. Validate the generated payload with the same bounds as Task 1 before writing.

- [ ] **Step 5: Implement daemon orchestration**

The daemon sequence is collect, validate, persist raw, evaluate incidents, freeze evidence, compact/prune transaction, commit, read snapshot, publish, and schedule next monotonic deadline. `--once` performs exactly one complete cycle for Ansible preflight.

CLI:

```python
parser.add_argument("--config", required=True)
parser.add_argument("--metrics-dir", required=True)
parser.add_argument("--database", required=True)
parser.add_argument("--runtime-map", required=True)
parser.add_argument("--once", action="store_true")
```

- [ ] **Step 6: Run focused and full Python tests**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_v2_publisher ops.tests.test_frontpage_metrics_v2_daemon
python3 -m unittest discover -s ops/tests
python3 -m compileall -q ops/frontpage_metrics_v2 ops/frontpage-metrics-collector.py ops/frontpage-metrics-collector-v2.py
```

- [ ] **Step 7: Commit**

```bash
git add ops/frontpage_metrics_v2/publisher.py ops/frontpage_metrics_v2/daemon.py ops/frontpage-metrics-collector-v2.py ops/tests/test_frontpage_metrics_v2_publisher.py ops/tests/test_frontpage_metrics_v2_daemon.py
git commit -m "feat: publish observability projections"
```

---

### Task 7: Deploy Collector v2 in Shadow Mode Without Docker Privilege

**Files:**
- Create: `ops/systemd/frontpage-metrics-collector-v2.service`
- Create: `ops/systemd/frontpage-metrics-collector-v2-shadow.service`
- Create: `ops/frontpage-metrics-runtime-map.py`
- Create: `ops/tests/test_frontpage_metrics_runtime_map.py`
- Modify: `ansible-playbook.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `DEPLOYMENT.md`

**Interfaces:**
- Shadow mode writes only `/var/lib/frontpage-metrics/v2-shadow/` and `/var/lib/frontpage-metrics/private/metrics-v2-shadow.sqlite3`.
- Promotion switches the production unit to `/var/lib/frontpage-metrics/v2/` and `/var/lib/frontpage-metrics/private/metrics-v2.sqlite3`; it does not reuse the shadow files.
- Production v1 timer remains active until promotion.
- Runtime-map generation accepts exact allowlisted container names from Ansible facts and writes workload ID, cgroup relative path, image SHA, and timestamp.

- [ ] **Step 1: Add failing runtime-map tests**

Test exact allowlist, cgroup path normalization, image SHA binding, duplicate workload rejection, and no arbitrary Docker discovery.

- [ ] **Step 2: Run tests and verify RED**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_runtime_map
```

- [ ] **Step 3: Implement runtime-map generation and hardened units**

Create a separate `frontpage-observer` system account with no supplementary groups. The shadow unit must include:

```ini
[Service]
Type=simple
User=frontpage-observer
Group=frontpage-observer
ExecStart=/usr/local/bin/frontpage-metrics-collector-v2 --config /etc/frontpage-metrics/config-v2.json --metrics-dir /var/lib/frontpage-metrics/v2-shadow --database /var/lib/frontpage-metrics/private/metrics-v2-shadow.sqlite3 --runtime-map /run/frontpage-metrics/runtime-map.json
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ReadOnlyPaths=/proc /sys/fs/cgroup
ReadWritePaths=/var/lib/frontpage-metrics /run/frontpage-metrics
RestrictSUIDSGID=true
LockPersonality=true
```

The production unit has the same hardening but changes only the output arguments to:

```ini
ExecStart=/usr/local/bin/frontpage-metrics-collector-v2 --config /etc/frontpage-metrics/config-v2.json --metrics-dir /var/lib/frontpage-metrics/v2 --database /var/lib/frontpage-metrics/private/metrics-v2.sqlite3 --runtime-map /run/frontpage-metrics/runtime-map.json
```

Do not add `frontpage-observer` to the Docker group. Projection directories are owned by `frontpage-observer:frontpage-metrics`; the private database directory remains `frontpage-observer:frontpage-observer`. Leave v1 and its Docker-group account unchanged for shadow and rollback.

- [ ] **Step 4: Extend Ansible for shadow installation and verification**

Create private/public/owner directories with `0750`, database directory owner-only `0700`, projection files `0640`, install the Python package, run `--once`, then start the shadow service. Verify v1 remains active, v2 is active, and `frontpage-observer` is not a Docker-group member. Shadow files are not mounted into the production app. Promotion later mounts only `public/` at `/metrics-public:ro` and `owner/` at `/metrics-owner:ro`, sets `PUBLIC_METRICS_DIR=/metrics-public` and `OWNER_METRICS_DIR=/metrics-owner`, and never mounts `private/` or the SQLite database.

- [ ] **Step 5: Update CI Python discovery and syntax gates**

Replace the single Python unittest invocation with:

```yaml
- run: python3 -m unittest discover -s ops/tests
- run: python3 -m compileall -q ops/frontpage_metrics_v2 ops/frontpage-metrics-collector.py ops/frontpage-metrics-collector-v2.py ops/frontpage-metrics-runtime-map.py
- run: ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file .vault_pass
```

- [ ] **Step 6: Run local deployment checks**

```bash
python3 -m unittest discover -s ops/tests
python3 -m compileall -q ops/frontpage_metrics_v2 ops/frontpage-metrics-collector.py ops/frontpage-metrics-collector-v2.py ops/frontpage-metrics-runtime-map.py
ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file .vault_pass
git diff --check
```

- [ ] **Step 7: Commit**

```bash
git add ops/systemd ops/frontpage-metrics-runtime-map.py ops/tests/test_frontpage_metrics_runtime_map.py ansible-playbook.yml .github/workflows/ci.yml DEPLOYMENT.md
git commit -m "feat: deploy observability collector shadow"
```

---

### Task 8: Read V2 Projections and Add Authenticated Owner APIs

**Files:**
- Create: `src/lib/metrics/v2/reader.ts`
- Create: `src/lib/metrics/v2/reader.test.ts`
- Create: `src/lib/metrics/v2/queries.ts`
- Create: `src/app/api/owner/metrics/route.ts`
- Create: `src/app/api/owner/metrics/route.test.ts`
- Create: `src/app/api/owner/incidents/route.ts`
- Create: `src/app/api/owner/incidents/route.test.ts`
- Modify: `src/app/status/page.tsx`

**Interfaces:**
- Produces `readPublicLatestV2(root)`, `readOwnerLatestV2(root)`, `readSeriesV2(root, query)`, and `readOwnerIncidentsV2(root)`.
- Produces strict `parseOwnerMetricsQuery(url) -> { range, view, resource }`.
- Resolves public files only from `PUBLIC_METRICS_DIR` and owner files only from `OWNER_METRICS_DIR`; neither variable falls back to the other root.
- Owner files are opened only after `auth()` and `isOwnerUser()` succeed.

- [ ] **Step 1: Add failing reader and forbidden-path tests**

Test missing/malformed/stale files, daily chunk merge order, de-duplication, exact bucket caps, future timestamps, manifest allowlisting, path traversal, and public-reader rejection of owner roots.

- [ ] **Step 2: Add failing route auth/query/ETag tests**

```ts
it("returns 401 before reading owner files", async () => {
  authMock.mockResolvedValue(null);
  const response = await GET(new Request("http://localhost/api/owner/metrics?range=1h&view=host"));
  expect(response.status).toBe(401);
  expect(readSeriesMock).not.toHaveBeenCalled();
});

it("returns 403 for a signed-in non-owner", async () => {
  authMock.mockResolvedValue({ user: { id: "not-owner" } });
  ownerMock.mockReturnValue(false);
  expect((await GET(request)).status).toBe(403);
  expect(readSeriesMock).not.toHaveBeenCalled();
});
```

Cover `400` for invalid range/view/resource, `413` for cap breach, `304` for matching ETag, and exact headers.

- [ ] **Step 3: Run tests and verify RED**

```bash
npm test -- src/lib/metrics/v2/reader.test.ts src/app/api/owner/metrics/route.test.ts src/app/api/owner/incidents/route.test.ts
```

- [ ] **Step 4: Implement auth-first readers and query parsing**

Start `auth()` immediately, await it before resolving `OWNER_METRICS_DIR`, and return `401`/`403` without touching owner I/O. Resolve `PUBLIC_METRICS_DIR` independently in the public reader; missing variables or roots yield explicit unavailable results and never cross-fallback. Use enum sets from Task 1 and a manifest-derived fixed file list. Series responses cap uncompressed JSON at 4 MiB; latest/incidents cap at 512 KiB.

Response headers:

```ts
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};
```

- [ ] **Step 5: Integrate server composition behind the feature flag**

In `/status`, read public v2 unconditionally when available. Read owner v2 only when the session is owner and `FRONTPAGE_OBSERVABILITY_V2=1`. Preserve the existing v1 `createStatusPageModel` and `OwnerMetricsPanel` fallback.

- [ ] **Step 6: Run focused and full TypeScript gates**

```bash
npm test -- src/lib/metrics/v2 src/app/api/owner
npm test
npm run lint
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/metrics/v2 src/app/api/owner src/app/status/page.tsx
git commit -m "feat: serve authenticated observability data"
```

---

### Task 9: Build Polling and Dense Accessible Chart Infrastructure

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/app/globals.css`
- Create: `src/components/dashboard/observability/useOwnerObservability.ts`
- Create: `src/components/dashboard/observability/polling.ts`
- Create: `src/components/dashboard/observability/polling.test.ts`
- Create: `src/components/dashboard/observability/RangeControl.tsx`
- Create: `src/components/dashboard/observability/ResourceChart.tsx`
- Create: `src/components/dashboard/observability/ResourceChart.test.tsx`
- Create: `src/components/dashboard/observability/chart-options.ts`
- Create: `src/components/dashboard/observability/chart-options.test.ts`

**Interfaces:**
- Adds exactly `uplot@1.6.32` as a production dependency.
- Produces a framework-independent `createOwnerPoller(...)` controller plus `useOwnerObservability({ initial, range, view, resource })` with serialized polling, ETag support, visibility debounce, wake refresh, and auth-stop behavior.
- Produces `ResourceChart` with explicit gaps, units, summaries, incident markers, pointer and keyboard inspection, and an accessible table.

- [ ] **Step 1: Add the dependency and failing hook tests**

```bash
npm install --save-exact uplot@1.6.32
```

Tests instantiate the pure polling controller with a fake scheduler, fake visibility source, and mocked fetch. Cover 15-second cadence, 500 ms visibility debounce, hidden stop, immediate wake refresh, no overlap, `304`, offline recovery, and `401` stop without adding React Testing Library or a DOM test environment.

```ts
it("never overlaps polling requests", async () => {
  const first = deferred<Response>();
  fetchMock.mockReturnValueOnce(first.promise);
  const poller = createOwnerPoller(deps);
  poller.start();
  await scheduler.advanceBy(30_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  first.resolve(jsonResponse(payload));
});
```

- [ ] **Step 2: Add failing chart tests**

Test the pure `chart-options.ts` transformer without a DOM: assert series gaps remain `null`, units and range labels are formatted, incident timestamps become marker coordinates, and keyboard point selection resolves the nearest non-null sample. Use `react-dom/server` in `ResourceChart.test.tsx` to assert that the server fallback contains the textual summary and accessible table rows. Exercise live uPlot construction, pointer inspection, keyboard inspection, resize, and teardown in the authenticated Playwright task rather than adding a second DOM test harness.

- [ ] **Step 3: Run tests and verify RED**

```bash
npm test -- src/components/dashboard/observability
```

- [ ] **Step 4: Implement the polling hook**

Implement scheduling, ETag, in-flight serialization, visibility debounce, and online recovery in `polling.ts`. The React hook owns one controller instance, subscribes to its snapshots, aborts on unmount, and uses a transition for non-urgent chart replacement. Do not subscribe components to transient timestamps they do not render.

- [ ] **Step 5: Implement `ResourceChart` with a dynamic uPlot boundary**

Create uPlot only on the client, destroy it on dependency change/unmount, import directly from `uplot`, and keep the chart module out of the server bundle. Preserve the accepted dark palette and thin-border container model. Add only the minimal uPlot CSS needed under `.observability-chart` in `globals.css`.

- [ ] **Step 6: Run focused gates and bundle/build checks**

```bash
npm test -- src/components/dashboard/observability
npm run lint
npx tsc --noEmit
AUTH_SECRET=dev-secret FRONTPAGE_OBSERVABILITY_V2=1 npm run build
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/app/globals.css src/components/dashboard/observability
git commit -m "feat: add dense owner metric charts"
```

---

### Task 10: Implement the Approved Owner Resource Rows and Workload Drilldown

**Files:**
- Create: `src/components/dashboard/observability/OwnerObservabilityPanel.tsx`
- Create: `src/components/dashboard/observability/OwnerObservabilityPanel.test.tsx`
- Create: `src/components/dashboard/observability/ResourceRow.tsx`
- Create: `src/components/dashboard/observability/ResourceSummary.tsx`
- Create: `src/components/dashboard/observability/WorkloadBreakdown.tsx`
- Create: `src/components/dashboard/observability/WorkloadTable.tsx`
- Create: `src/components/dashboard/observability/WorkloadTable.test.tsx`
- Create: `src/components/dashboard/observability/IncidentTimeline.tsx`
- Modify: `src/components/dashboard/OwnerAttentionSummary.tsx`
- Modify: `src/app/status/page.tsx`

**Interfaces:**
- Consumes Task 8 initial owner payload and Task 9 chart/polling primitives.
- Preserves the existing `Owner status`, attention band, services, containers, and owner destinations.
- Produces four full-width rows: CPU, RAM, disk, and network.

- [ ] **Step 1: Add failing approved-layout tests**

Assert exact visible structure and semantics:

```ts
it("renders total, chart, and reconciled workload values for every resource", () => {
  const markup = renderToStaticMarkup(<OwnerObservabilityPanel initial={fixture} />);
  expect(markup).toContain("CPU total");
  expect(markup).toContain("RAM total");
  expect(markup).toContain("Disk capacity");
  expect(markup).toContain("Disk I/O");
  expect(markup).toContain("Network total");
  expect(markup).toContain("system/untracked");
  expect(markup).toContain("Attribution coverage");
});
```

Cover stale copy, truncated attribution, disabled network workload mode, missing PSI, reset gaps, mobile source order, and no action controls.

- [ ] **Step 2: Add failing semantic workload-table tests**

Require `<table>`, workload `<th scope="row">`, sortable column headers with `aria-sort`, text equivalents for bars, expansion buttons with `aria-expanded`, and process fields limited to the positive allowlist.

- [ ] **Step 3: Run tests and verify RED**

```bash
npm test -- src/components/dashboard/observability/OwnerObservabilityPanel.test.tsx src/components/dashboard/observability/WorkloadTable.test.tsx
```

- [ ] **Step 4: Implement the approved resource-row composition**

Desktop grid is `145px minmax(0, 1fr) minmax(260px, 320px)`. Mobile source order is total, chart, workload breakdown. Use existing semantic tokens and border bands; do not add cards inside cards, gradients, pills, marketing copy, or a new navigation system.

Each row includes current total, unit, average, peak, coverage, freshness, chart, `Total / By workload`, attribution bar/list, reconciliation error, and `system/untracked`.

- [ ] **Step 5: Implement workload table and current process expansion**

Sort client-side from the bounded current payload. Expansion shows stable identity, capabilities, PSI, OOM/restart evidence, and current sanitized processes. No raw command or path fields are rendered.

- [ ] **Step 6: Integrate incidents and owner attention**

Active alerts precede recovered incidents. Selecting an incident updates chart marker state without navigation. Owner attention includes stale source, capability gap, truncation, and reconciliation diagnostics.

- [ ] **Step 7: Run focused and full component gates**

```bash
npm test -- src/components/dashboard/observability src/components/dashboard/OwnerAttentionSummary.test.tsx
npm test
npm run lint
npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add src/components/dashboard/observability src/components/dashboard/OwnerAttentionSummary.tsx src/app/status/page.tsx
git commit -m "feat: explain owner resource usage"
```

---

### Task 11: Add Public-Safe Incident History, Maintenance, and End-to-End Proof

**Files:**
- Create: `content/maintenance.json`
- Modify: `src/lib/content/schema.ts`
- Modify: `src/lib/content/index.ts`
- Create: `src/lib/metrics/v2/public-status.ts`
- Create: `src/lib/metrics/v2/public-status.test.ts`
- Create: `src/components/dashboard/PublicIncidentHistory.tsx`
- Create: `src/components/dashboard/PublicIncidentHistory.test.tsx`
- Modify: `src/app/status/page.tsx`
- Modify: `tests/e2e/prepare-runtime.mjs`
- Modify: `tests/e2e/public-ui.spec.ts`
- Modify: `tests/e2e/owner-ui.spec.ts`
- Modify: `tests/docker-runtime-smoke.mjs`
- Modify: `playwright.config.ts`
- Modify: `DEPLOYMENT.md`
- Modify: `ansible-playbook.yml`

**Interfaces:**
- Produces repository-owned `MaintenanceWindow` records with title, safe description, affected public service IDs, start, end, and status.
- Produces public incident cards containing no owner evidence.
- Completes shadow comparison, feature-flag rollback, exact projection permissions, and eBPF readiness evidence; does not implement eBPF.

- [ ] **Step 1: Add failing maintenance and public-redaction tests**

Test invalid ranges, unknown public service IDs, overlapping duplicate IDs, maintenance state precedence, recovered incidents, stale telemetry, and rejection of owner evidence in public models.

- [ ] **Step 2: Add failing E2E owner/public flows**

Public assertions:

- Current posture and five public services remain first.
- Public incident/maintenance history is visible.
- No exact values, workload names, process fields, owner incidents, internal services, or diagnostics appear in HTML or RSC responses.

Owner assertions:

- `1H`, `24H`, `7D`, and `30D` controls work.
- CPU/RAM/disk/network rows render totals and charts.
- Workload mode reconciles CPU/RAM/disk I/O.
- Network workload mode explains capability unavailability.
- Sorting, expansion, keyboard chart inspection, incident selection, hidden-tab polling, and mobile source order work.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm test -- src/lib/metrics/v2/public-status.test.ts src/components/dashboard/PublicIncidentHistory.test.tsx
```

- [ ] **Step 4: Implement maintenance and public incident composition**

Keep maintenance repository-owned. Apply `Maintenance` only to expected affected public services during the window; unexpected failures still surface. Render recent events as an unframed timeline band using the existing visual language.

- [ ] **Step 5: Extend synthetic v2 runtime fixtures**

Generate separate `public/` and `owner/` trees with fresh, stale, unavailable, reset, gap, truncated, maintenance, active-incident, recovered-incident, and network-capability-unavailable states. Keep v1 fixtures for feature-flag rollback.

- [ ] **Step 6: Update Docker and Ansible runtime assertions**

Smoke must prove public/owner projection readability, database absence from the container, read-only mounts, public redaction, owner API `401`, exact `VERSION`, and healthy status. Ansible must prove v1/v2 service states, file modes, database `0700` directory, no collector docker-group membership after promotion, feature flag, exact image, and rollback.

- [ ] **Step 7: Run the complete local matrix**

```bash
df -h /System/Volumes/Data
source ~/.nvm/nvm.sh && nvm use 22
npm test
npm run lint
npx tsc --noEmit
AUTH_SECRET=dev-secret FRONTPAGE_OBSERVABILITY_V2=1 npm run build
python3 -m unittest discover -s ops/tests
python3 -m compileall -q ops/frontpage_metrics_v2 ops/frontpage-metrics-collector.py ops/frontpage-metrics-collector-v2.py ops/frontpage-metrics-runtime-map.py
ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file .vault_pass
npm run test:e2e
docker build --tag frontpage:observability-v2 --build-arg VERSION=observability-v2 .
node tests/docker-runtime-smoke.mjs --image frontpage:observability-v2 --version observability-v2
git diff --check
```

Expected: all pass; disk preflight remains at or above 30 GiB.

- [ ] **Step 8: Run Browser-first fidelity QA against the accepted reference**

Target flow: `/status` as owner -> range change -> workload mode -> workload expansion -> incident selection -> mobile stack.

Use the Browser plugin for page identity, nonblank DOM, no framework overlay, console health, screenshots, and interactions. Capture desktop `1440x1000`, mobile `390x844`, and the supplied PDF/native long-page composition where practical. Use `view_image` on the PDF render and latest browser screenshots. Record a mismatch ledger for:

1. Existing public first viewport unchanged.
2. Owner transition and attention band unchanged.
3. Full-width row total/chart/attribution anatomy.
4. Typography and semantic palette fidelity.
5. Thin-border/open-layout container model.
6. Desktop and mobile source order.
7. Above-the-fold copy diff.

Fix all material mismatches before proceeding.

- [ ] **Step 9: Add shadow comparison and promotion evidence**

Write paired one-minute v1/v2 summaries and require 48 continuous hours with p99 relative divergence below 2% for CPU, RAM, disk capacity, and public service state, excluding declared resets/gaps. Record collection duration, write duration, database size, projection size, and missed cycles.

Promotion requires a separate deploy invocation after the evidence window. Rollback must cold-start v1 with a populated v2 database present and verify v1 health.

- [ ] **Step 10: Produce the eBPF readiness artifact**

Document kernel version, cgroup v2, BTF, `CAP_BPF`, `CAP_PERFMON`, lockdown mode, helper packaging, expected counter schema, and security review requirements in `docs/superpowers/specs/2026-07-12-frontpage-ebpf-network-attribution-gate.md`. Do not install a helper or grant capabilities in this plan.

- [ ] **Step 11: Commit**

```bash
git add content src tests playwright.config.ts DEPLOYMENT.md ansible-playbook.yml docs/superpowers/specs/2026-07-12-frontpage-ebpf-network-attribution-gate.md
git commit -m "feat: complete observability dashboard v2"
```

---

## Final Review and Shipping Gate

After Task 11:

1. Run a fresh whole-branch code review against the design spec and this plan.
2. Fix every Critical or Important finding and re-review the exact final head.
3. Run the full local matrix again at the final head.
4. Push the branch only after the user authorizes shipping.
5. Require CI test, browser, Docker, and published-image jobs to pass for the exact SHA.
6. Deploy Collector v2 shadow mode first; do not enable the owner feature flag during the first deploy.
7. Collect the 48-hour shadow evidence and verify the divergence gate.
8. Deploy the same exact app SHA with `FRONTPAGE_OBSERVABILITY_V2=1` only after the shadow gate passes.
9. Verify public routes, public redaction, owner ranges/charts/workloads/incidents, collector freshness, file permissions, database non-mount, image identity, and read-only access.
10. Roll back if public redaction, owner access, image identity, collector freshness, projection validity, or mount permissions fail.

## Explicit Non-Claims Until Proven

- A local green matrix is not CI proof.
- A pushed SHA is not a published image.
- A published image is not a deployment.
- Shadow Collector v2 is not promoted Collector v2.
- An enabled UI flag is not 48-hour divergence proof.
- Host network charts are not workload network attribution.
- An eBPF readiness artifact is not an installed or secure eBPF helper.
- Public readback does not prove owner readback.
- Owner readback does not prove public redaction unless both are checked independently.
