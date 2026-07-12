# Frontpage Observability Dashboard v2 Design

**Date:** 2026-07-12

**Status:** Approved design; implementation plan complete

## Summary

Extend the existing `reidar.tech/status` experience into a higher-resolution observability dashboard without replacing its current visual language or weakening its trust boundary.

The public page remains a restrained status surface with coarse aggregate health, service availability, incidents, and maintenance. The existing private owner section grows in place: CPU, RAM, disk, and network become full-width resource rows that combine an authoritative host total, a high-resolution chart, and an explainable workload breakdown. Workload and process attribution remains owner-only.

Collector v2 remains a host-side, read-only-to-the-app architecture. It samples every 15 seconds, stores private working state in SQLite, and atomically publishes separate public-safe and owner-only JSON projections. The web container receives no shell, SSH, Docker socket, host PID namespace, restart capability, or writable metrics path.

## Goals

- Preserve the current page structure, typography, spacing, border treatment, semantic colors, public service inventory, and owner transition.
- Provide 15-second host and workload telemetry for the last hour.
- Provide 1-minute rollups for 7 days.
- Provide 15-minute rollups for 30 days.
- Retain bounded incident records and evidence for 90 days.
- Show CPU, RAM, disk capacity, disk I/O, and network totals, with honest workload attribution only where the collector has a supported source.
- Group historical usage by stable workloads rather than unstable PIDs.
- Keep raw process drilldown private, current-only, sanitized, and bounded.
- Add sustained alert evaluation, recovered incidents, and repository-owned maintenance windows.
- Keep the dashboard operationally read-only.
- Preserve exact-SHA, CI, deploy, public-readback, and owner-readback proof as separate claims.

## Non-Goals

- Replacing the existing site with a generic monitoring console.
- Exposing exact host metrics, workload names, process data, internal services, containers, diagnostics, or incident evidence publicly.
- Adding Prometheus, Grafana, cAdvisor, or a general-purpose metrics query language in this run.
- Adding email, webhook, or push notifications.
- Adding incident acknowledgement, restart, deploy, prune, shell, SSH, or remediation controls.
- Retaining command lines, environment variables, working directories, executable arguments, or historical PID series.
- Requiring eBPF for the initial release.
- Attributing filesystem capacity to running processes.

## Approved Product Decisions

- Process and workload attribution is owner-only.
- Historical retention is `15s / 1h`, `1m / 7d`, and `15m / 30d`.
- Resource attribution is workload-first. Raw processes are one drilldown level deeper.
- Network attribution ships in phases: authoritative interface totals first, audited eBPF workload attribution later.
- Alerts and incidents appear in the dashboard; external notification delivery is out of scope.
- The owner UI uses full-width resource rows with total, chart, and workload reconciliation.
- Collector v2 uses private SQLite plus atomic public/owner JSON projections.

## Architecture

```text
Linux host sources
  /proc, cgroup v2, systemd, configured HTTP health checks
                  |
                  v
Hardened Collector v2 systemd service (15-second monotonic schedule)
  - validates and normalizes counters
  - evaluates incidents before compaction
  - stores private SQLite working state
  - creates bounded public and owner projections
                  |
                  v
Atomic read-only metrics tree
  public/   coarse status, safe history, public incidents
  owner/    exact host series, workload series, processes, diagnostics
                  |
                  v
Next.js server
  public route reads public files only
  owner route/API reads owner files only after ownership verification
                  |
                  v
Existing /status UI + private resource-row client charts
```

### Why Not Prometheus

A Prometheus/node-exporter/process-exporter/cAdvisor stack offers a mature ecosystem but adds multiple services, a TSDB, query semantics, deployment complexity, and potential Docker access. This project needs a bounded single-host dashboard with an established atomic-file trust boundary. Collector v2 provides the required fidelity without turning Frontpage into a general monitoring platform.

## Trust Boundary

### Public Projection

The public projection may contain only:

- Coarse resource states such as `healthy`, `watch`, `critical`, or `unknown`.
- Coarse timestamp-bounded pressure history.
- Public service state, latency, coverage, and availability.
- Public-safe incident summaries and maintenance windows.
- Freshness and collection coverage.

It must never contain:

- Exact CPU, RAM, disk, load, uptime, I/O, network, PSI, or process values.
- Workload IDs, cgroup paths, systemd unit names, container identifiers, PIDs, UIDs, process names, or executable names.
- Internal services, collector diagnostics, thresholds with sensitive context, or exact incident evidence.

### Owner Projection

The owner projection may contain exact host metrics, configured workload identities, current sanitized process drilldowns, private services, allowlisted container posture, diagnostics, PSI capability state, and full incident evidence.

Next.js must authenticate and call `isOwnerUser` before opening any owner file. Public route handlers and public Server Components never open owner paths and never derive public data from an owner payload.

### Web Application Privileges

The web container receives:

- Read-only mounts for the public and owner projection directories.
- No collector database.
- No Docker socket.
- No host `/proc` or `/sys/fs/cgroup` mount.
- No host PID namespace.
- No shell, SSH credentials, restart controls, deployment controls, or writable metrics path.

## Collector Runtime

Collector v2 is a long-running Python systemd service with a monotonic 15-second scheduler. A long-running process is required for reliable counter deltas, bounded process sampling, sleep/wake detection, and the later eBPF lifecycle.

The unit runs as a dedicated `frontpage-observer` user with systemd hardening. This is intentionally separate from the existing v1 `frontpage-metrics` account, which belongs to the Docker group during shadow and rollback support. Projection files are owned by `frontpage-observer` and grouped under the read-only `frontpage-metrics` group so the web container can read them without granting the v2 collector or web app Docker access.

Collector v2 is the sole SQLite writer. SQLite uses WAL mode, foreign keys, a busy timeout, bounded transactions, and an explicit schema version. If a write or compaction transaction takes more than 5 seconds, the collector skips the next scheduled cycle instead of building a backlog.

### Collection Order

Each cycle performs these operations in order:

1. Read monotonic and wall-clock timestamps.
2. Collect independent host, workload, process, service, and capability sources.
3. Validate counters and calculate deltas.
4. Persist the raw 15-second sample.
5. Evaluate incident rules against raw evidence.
6. Freeze incident evidence needed beyond normal metric retention.
7. Compact and prune inside one SQLite transaction.
8. Commit the transaction.
9. Generate public and owner projections from a consistent post-commit read snapshot.
10. Write unique temporary files, flush, fsync, atomically replace, and fsync directories.

JSON generation never runs during compaction. Previously published projections remain readable when a collection source or publication attempt fails.

## Metric Sources

### Host Sources

- CPU counters and core count: `/proc/stat`.
- Load: `/proc/loadavg`.
- Memory totals and available memory: `/proc/meminfo`.
- Filesystem capacity: `statvfs` on configured mountpoints.
- Disk bytes, operations, and queue counters: `/proc/diskstats` for configured block devices.
- Network bytes, packets, errors, and drops: `/proc/net/dev` for configured interfaces.
- TCP retransmits where available: `/proc/net/snmp`.
- Uptime: `/proc/uptime`.
- Host pressure: `/proc/pressure/{cpu,memory,io}` when PSI is available.

### Workload Sources

Configured cgroup v2 paths provide:

- CPU: `cpu.stat` cumulative usage.
- Memory: `memory.current`, `memory.events`, and optional `memory.stat` summaries.
- Disk I/O: `io.stat` cumulative bytes and operations.
- Pressure: `cpu.pressure`, `memory.pressure`, and `io.pressure` when available.

Workload identity is repository/Ansible allowlisted. Supported match types are:

- Exact systemd unit.
- Exact cgroup v2 relative path.
- Anchored, schema-validated cgroup path pattern with bounded length.
- Deployment-generated runtime mapping for allowlisted containers.

Ansible writes the runtime mapping after starting the active container and rewrites it during rollback. The collector never discovers arbitrary containers through a Docker socket.

### Process Drilldown

Current process drilldown is collected from `/proc` only for PIDs that belong to an allowlisted workload. The positive field allowlist is:

- `pid`
- `comm`
- `uid`
- `cpu_percent`
- `rss_bytes`
- `state`
- normalized workload ID

The collector stores at most 20 current processes per workload, ranked by the selected resource. It does not retain command lines, arguments, environment variables, executable paths, working directories, open files, sockets, or historical PID series.

### OOM and Restart Evidence

- OOM evidence comes from cgroup v2 `memory.events` counter deltas, especially `oom` and `oom_kill`.
- Workload disappearance/reappearance and systemd unit state changes provide restart evidence.
- Service check state transitions remain an independent signal.
- The first release does not read `dmesg` and does not require `CAP_SYSLOG`.

## Capability Detection

Collector startup records capability state for cgroup v2, PSI, configured disks, configured interfaces, systemd metadata, and process visibility.

PSI is optional. If `/proc/pressure` or per-cgroup pressure files are absent, PSI fields are omitted, PSI-based rules are disabled, and the owner diagnostic view explains the capability gap. Missing PSI never makes an otherwise valid sample unavailable.

## Workload Attribution Semantics

Host totals are authoritative in the owner view. Workload attribution explains those totals but does not silently force equality.

- CPU uses deltas of host CPU counters and cgroup `usage_usec`.
- RAM uses host used memory and cgroup `memory.current`.
- Disk I/O uses host block-device deltas and cgroup `io.stat` deltas.
- Network phase one uses host interface totals only. Workload attribution coverage is `0` and the `By workload` mode is unavailable unless a supported attribution source is active.
- The separately gated eBPF phase adds workload network counters and declares measured coverage; cgroup v2 alone is never treated as a network-accounting source.

The residual is labeled `system/untracked`, not `other processes`. It may include kernel work, short-lived processes, accounting lag, and sources outside configured workloads.

Negative residuals caused by timing or accounting disagreement are clamped to zero in published projections. The projection includes `attribution_coverage_percent` and `reconciliation_error_percent`. Absolute reconciliation error above 10% creates an owner diagnostic but not a public incident.

Disk capacity is never attributed to workloads. The disk row displays capacity as a host gauge and disk I/O attribution as a separate measurement.

## Retention and Aggregation

| Tier | Source cadence | Retention | Maximum buckets | Purpose |
|---|---:|---:|---:|---|
| Raw | 15 seconds | 1 hour | 240 | Live investigation and incident detection |
| Minute | 1 minute | 7 days | 10,080 | Operational trends |
| Quarter-hour | 15 minutes | 30 days | 2,880 | Medium-term trends |
| Incidents | Event-based | 90 days | Bounded by policy | Status history and evidence |

Rollups are metric-specific:

| Metric kind | Examples | Rollup fields |
|---|---|---|
| Gauge | CPU percent, memory bytes, disk capacity, load | minimum, maximum, mean, last, sample count, coverage |
| Cumulative counter | CPU usec, disk bytes/ops, network bytes/packets/errors/drops | summed positive delta, mean rate, maximum rate, last counter, reset count, coverage |
| PSI average | PSI avg10/avg60/avg300 | maximum, mean, last, coverage |
| PSI total | PSI cumulative stall usec | summed positive delta, maximum rate, reset count |
| Service state | up/down/unknown | counts, availability, coverage, last state, transitions |
| Workload memory | cgroup `memory.current` | minimum, maximum, mean, last, coverage |

Alert evaluation always uses raw 15-second evidence. Compaction cannot delete raw rows until incident evaluation has completed for them.

### Incident Evidence Envelope

Each incident stores a bounded evidence envelope containing:

- The triggering metric and workload ID when owner-only.
- Up to 5 minutes of 15-second evidence before opening.
- Up to 5 minutes after opening or recovery evidence for longer incidents.
- Trigger threshold, peak value, coverage, capability state, and source freshness.
- A maximum serialized evidence size of 256 KiB per incident.

The envelope is copied into incident storage before raw rows are pruned. Incident summaries and evidence remain useful from day 31 through day 90 even though general chart retention ends at day 30.

## Projection Files

The projection tree is physically separated:

```text
metrics/
  public/
    latest.v2.json
    series-1h.v2.json
    series-7d.v2.json
    series-30d.v2.json
    incidents.v2.json
  owner/
    latest.v2.json
    incidents.v2.json
    manifest.v2.json
    host/
      1h.v2.json
      minute/YYYY-MM-DD.v2.json
      quarter-hour/YYYY-MM-DD.v2.json
    workloads/
      1h.v2.json
      minute/YYYY-MM-DD.v2.json
      quarter-hour/YYYY-MM-DD.v2.json
```

Daily chunks prevent rewriting the complete 7-day and 30-day windows every cycle. The current raw/hour file updates every 15 seconds, the current minute chunk updates once per minute, and the current quarter-hour chunk updates when a bucket closes. Closed daily chunks are immutable.

Series JSON uses a columnar representation with timestamp arrays and numeric arrays rather than repeated objects. Values use base units: seconds, bytes, operations, packets, and ratios. Display units are a UI concern.

Exact file schemas will be versioned separately from schema v1. Collector v2 dual-writes v1 and v2 during shadow rollout.

## Owner API

Owner chart data is exposed through authenticated Next.js route handlers. Every handler independently verifies ownership before resolving an owner path.

Allowed query values are closed enums:

- Range: `1h`, `24h`, `7d`, `30d`.
- View: `host`, `workloads`.
- Resource for workload history: `cpu`, `ram`, `disk_io`, `network`. The `network` workload view returns a capability-unavailable response until eBPF attribution is active.

Paths are selected from a server-side manifest; query text is never interpolated into a filesystem path.

Responses use:

- `Cache-Control: private, no-store`.
- ETags and `If-None-Match` for unchanged projections.
- `X-Content-Type-Options: nosniff`.
- Validated maximum bucket counts.
- A 512 KiB uncompressed cap for latest/process/incident-list responses.
- A 4 MiB uncompressed cap for a requested series response.
- `truncated: true` plus attribution coverage when the workload set must be reduced to the highest-ranked 16 workloads and `system/untracked`.

The initial owner page receives `latest + 1h host totals`. Longer ranges and workload history load only when selected.

## UI Design

The existing public page, owner transition, typography, semantic colors, borders, and section hierarchy remain intact.

### Public Area

The public area retains current posture, coarse pressure history, and service inventory. It adds:

- Public-safe 30-day service availability and coverage.
- Recent public incident summaries.
- Current and upcoming repository-owned maintenance windows.
- Clear fresh, stale, unavailable, maintenance, disruption, and recovered semantics.

It does not add exact resource totals or process/workload information.

### Owner Attention

Owner attention appears immediately below the existing `Owner status` transition and summarizes:

- Active alerts.
- Recovered incidents.
- Stale or missing sources.
- PSI capability gaps.
- Attribution truncation or reconciliation gaps.

### Host Resource Rows

CPU, RAM, disk, and network each use a full-width row:

- Exact authoritative host total.
- High-resolution chart.
- `1H`, `24H`, `7D`, and `30D` range control.
- Average, peak, coverage, and source freshness.
- Threshold and incident markers.
- Current workload reconciliation with `system/untracked`.
- `Total` and `By workload` chart modes.

Disk capacity and disk I/O are visually and semantically separate within the disk row. Network shows receive and transmit separately and always displays attribution capability and coverage. Its workload mode is disabled with explanatory copy before eBPF is active.

### Workload Table

The workload table is a semantic HTML table, not a custom ARIA grid. It supports sorting by CPU, RAM, disk I/O, and network with `aria-sort`. Workload names are row headers. Bars and status colors have text equivalents.

Rows show current value, peak, one-hour change, attribution coverage, and health evidence. Expanding a row reveals systemd/cgroup/container identity, PSI, restart/OOM context, and the sanitized current process table.

The dashboard remains read-only.

### Incident Timeline

Active incidents appear first, followed by recovered incidents and maintenance annotations. Selecting an incident highlights its interval on relevant charts. Public incidents use safe aggregate language; owner incidents show exact evidence.

### Charts

Dense owner charts use `uPlot` in a focused client component. The remainder of the page stays server-rendered.

Charts provide:

- Stable time axes and explicit units.
- Visible missing-data gaps.
- Current, minimum, maximum, and mean summaries.
- Threshold and incident markers.
- Pointer crosshair and keyboard point inspection.
- A compact accessible data table/summary.
- No color-only distinctions.
- Responsive desktop and mobile layouts.

Desktop rows use total, chart, and attribution columns. Mobile order is total, chart, then workload breakdown.

### Polling Lifecycle

The owner client polls every 15 seconds only while visible.

- Visibility activation is debounced by at least 500 ms.
- Hidden tabs stop polling within one cadence tick.
- Sleep/wake or online recovery triggers one immediate refresh, then resumes cadence.
- Requests are serialized; a second poll never starts while one is in flight.
- `304 Not Modified` updates freshness without replacing chart data.
- Authentication failure stops polling and returns the user to the signed-out state.

## Alerts and Incidents

Alerts use sustained evidence and hysteresis. Exact defaults are configuration-backed and schema-validated.

- Collector freshness: warning after 45 seconds, unavailable after 2 minutes.
- Services: open after two consecutive failed checks; recover after two consecutive successful checks.
- CPU: sustained utilization combined with CPU PSI when available.
- Memory: available-memory ratio, memory PSI, cgroup pressure, and OOM counters; percentage alone is not critical evidence.
- Disk capacity: warning at 80%, critical at 90%.
- Disk I/O: pressure, errors, and sustained queue evidence; throughput alone is not unhealthy.
- Network: errors, drops, and retransmits; throughput alone is not unhealthy.
- Workloads: OOM kills, restart loops, resource pressure, and sustained dominance.

Incident records contain rule ID, severity, visibility, open/update/recovery timestamps, affected resource, optional owner-only workload ID, supporting values, peak evidence, source freshness, coverage, and the bounded evidence envelope.

There is no in-app acknowledgement state.

## Maintenance Windows

Maintenance windows are repository-owned and schema-validated. Each window contains a public title, safe description, affected public service IDs, start, end, and status.

During a maintenance window, expected service impact appears as `Maintenance` rather than `Disruption`. Metrics and unexpected failures remain visible. The dashboard does not create or edit maintenance windows at runtime in this release.

## Failure Semantics

- A failed workload scan does not discard a valid host sample.
- A failed service check does not discard resource telemetry.
- Missing process access marks process drilldown unavailable without erasing workload history.
- Counter resets and reboots create explicit reset boundaries; negative deltas are never emitted as rates.
- Clock jumps and future timestamps create gaps and diagnostics.
- Missing PSI disables PSI rules and surfaces owner capability state.
- Publication failure preserves the previous complete projection.
- SQLite integrity failure preserves the last projections, marks collector state degraded, and requires operator review; it does not silently recreate history.
- Oversized responses truncate low-ranked workloads into `system/untracked` and declare truncation.
- Stale owner data remains visible only as `Last known sample`.

## Shadow Rollout and Rollback

### Stage 1: Collector v2 Shadow Mode

- Keep schema v1 production output active.
- Run Collector v2 and dual-write schema v2.
- Compare paired one-minute host summaries.
- Require 48 continuous hours with p99 relative divergence below 2% for CPU, RAM, disk capacity, and service state, excluding declared reset/gap intervals.
- Record collection duration, write duration, database size, projection size, and missed cycles.

### Stage 2: Owner UI Feature Flag

- Enable the new owner resource rows behind `FRONTPAGE_OBSERVABILITY_V2=1`.
- Load current data and the one-hour range first.
- Keep the existing owner panel as rollback UI.

### Stage 3: Tiered History and Public Incidents

- Enable 24-hour, 7-day, and 30-day ranges after real retention exists.
- Enable public incident and maintenance history only after redaction proof.

### Stage 4: eBPF Network Attribution

- Treat eBPF as a separate implementation and security gate.
- Require host kernel compatibility and a dedicated helper design.
- Prefer `CAP_BPF` and `CAP_PERFMON`; do not grant `CAP_SYS_ADMIN` by default.
- Export only bounded counters into Collector v2.

### Rollback

Collector v1 must cold-start and serve schema v1 with no dependency on the v2 database. Losing v2 history during rollback is acceptable and must be reported explicitly. CI and deployment verification exercise v2-to-v1 rollback with a populated v2 database.

## Testing Strategy

### Python Collector

- `/proc` and cgroup parser fixtures.
- Counter delta, reset, reboot, and clock-jump tests.
- Metric-specific rollup tests.
- Exact retention-boundary time-travel tests.
- Incident state-machine and hysteresis tests.
- Incident evidence pinning across compaction.
- SQLite migration, WAL, integrity, pruning, and write-watchdog tests.
- Atomic projection and cleanup tests.
- Workload allowlist and process-field redaction tests.
- Payload truncation with 500 synthetic workloads.
- PSI unavailable capability tests.
- Network capability-unavailable and eBPF partial-coverage tests.

### TypeScript and React

- Public and owner schema bounds.
- Public redaction fixtures containing forbidden owner fields.
- Owner route `401` and non-owner `403` tests.
- Fixed range/view/resource query allowlists.
- Manifest path traversal rejection.
- ETag and `304` behavior.
- Resource-row total, chart, and reconciliation rendering.
- Stale, unavailable, reset, gap, and truncated states.
- Semantic workload table and `aria-sort` tests.
- Poll visibility, debounce, sleep/wake, and request-serialization tests.

### Browser and Runtime

- Public and owner Playwright flows.
- Desktop and mobile resource-row screenshots.
- Axe checks with zero critical violations.
- Keyboard chart inspection and workload expansion.
- Public leakage assertions for exact metrics and identities.
- Docker runtime smoke with read-only projections.
- Ansible image/version, collector, permissions, capability, and rollback verification.

## Acceptance Criteria

- Public routes expose no exact host, workload, process, cgroup, systemd, container, internal-service, diagnostic, or owner-incident evidence.
- Owner CPU, RAM, disk, and network rows show current total, chart, and coverage. CPU, RAM, and disk I/O show workload attribution in phase one; network workload attribution appears only when the eBPF capability is active.
- Host totals remain authoritative and residual/error semantics are explicit.
- All selected ranges use the approved resolution and retention.
- Missing samples render as gaps.
- CPU, RAM, disk I/O, and network rates survive counter resets without negative values.
- Disk capacity and disk I/O are separate.
- Process drilldown contains only the positive field allowlist and respects the 20-process bound.
- Public and owner projection files are separate, schema-valid, atomically published, size-bounded, and mounted read-only.
- Incident evaluation precedes compaction and preserves bounded evidence for 90 days.
- Owner polling pauses while hidden, resumes safely, and never overlaps requests.
- Shadow comparison passes the defined 48-hour divergence gate before promotion.
- v2-to-v1 rollback proof succeeds.
- Full unit, lint, TypeScript, build, Python, Playwright, accessibility, Docker, Ansible, exact-SHA deployment, public readback, and owner readback gates pass before any live-complete claim.

## Antigravity Review Integration

The initial Sonnet/Opus panel could not run because all configured Google accounts were cooling down; a Gemini/local-Qwen fallback also failed because Gemini accounts were cooling down and Ollama was unavailable.

A later focused `claude-opus-4-6` consult succeeded through Anti. This spec incorporates its verified recommendations:

- Metric-specific aggregation functions.
- Strict separation between public coarse state and owner exact totals.
- Honest `system/untracked` residual and reconciliation error.
- Explicit OOM/restart sources and process field allowlist.
- SQLite WAL, one-writer policy, compaction ordering, and write-latency watchdog.
- PSI capability detection.
- Incident evidence pinning and bounded 90-day evidence envelopes.
- Payload caps and truncation semantics.
- Visible-tab polling lifecycle.
- Shadow divergence and rollback criteria.
- Semantic table accessibility and corresponding acceptance tests.

Anti remains advisory; local source inspection, tests, runtime proof, CI, and exact-SHA deployment evidence own the final implementation decision.
