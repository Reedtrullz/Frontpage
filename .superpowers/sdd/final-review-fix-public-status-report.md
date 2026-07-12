# Final Review Fix Report: Frontpage Public Status Readability

Date: 2026-07-12
Branch: `codex/public-status-readability`
Base HEAD: `3660f68103946a3071369fe77f57b38ca7fa32f2`

## Status

Implemented all four final-review fix groups without resetting or reverting prior branch work.

## Findings Fixed

### 1. Current telemetry inventory truth

- `StatusInventory` now distinguishes a fresh valid zero-check sample from unavailable current telemetry.
- When current telemetry is unavailable, the inventory renders explicit current-sample-unavailable copy and last-known configured count when history supports it.
- It no longer renders `0 configured` or `No public checks configured` from an empty current projection when a last-known history count exists.
- Added component coverage for unavailable current telemetry with last-known configuration.
- Kept `No public checks configured` reserved for the fresh valid zero-check path.

### 2. Timestamp and coverage truth

- Extended `HistoryCoverage` with `leadingGap` and `trailingGap`.
- Reader normalization now counts boundary gaps together with internal gaps and preserves the existing 24-hour timestamp-bounded window.
- `CoarseHistoryStrip` now lays out coverage intervals using actual timestamps and renders unknown spans for leading, internal, and trailing gaps. It no longer treats samples as equally spaced by array position.
- `MetricsSparkline` now consumes timestamped normalized samples from `OwnerMetricsPanel`, positions points against the coverage interval, and starts a new polyline across missing time.
- Owner exact metrics remain owner-only; only gap alignment metadata is added to the owner model.
- Removed duplicate unavailable/empty history fallback copy.
- Added irregular, sparse, leading-gap, trailing-gap, and missing-time chart coverage tests.

### 3. Configured project health subset

- `deriveProjectHealth` now returns `unavailable` when any configured health service ID is absent from the current public service set.
- Added regression coverage for one configured service present/up plus one configured service missing.

### 4. Focused fixture and semantics coverage

Covered fresh, stale, unavailable, sparse, malformed-history, gap, and service-failure behavior through existing and new focused tests. No production polling, network calls, or external runtime dependencies were added.

## Verification

All commands below passed on the final working tree:

- `npm test` -> 23 test files, 132 tests passed.
- Focused final-review slice -> 7 test files, 50 tests passed.
- `npm run lint` -> passed.
- `npx tsc --noEmit` -> passed.
- `npm run build` -> production build passed; 29 routes generated.
- `python3 -m unittest ops.tests.test_frontpage_metrics_collector` -> 14 tests passed.
- `python3 -m py_compile ops/frontpage-metrics-collector.py` -> passed.
- `ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file .vault_pass` -> passed.
- `git diff --check` -> passed.
- Disk guardrail: `/System/Volumes/Data` had approximately 73 GiB available before build/test work.

## Explicit Non-Claims

- Browser screenshots and the complete browser/E2E matrix were not run by this worker; the controller is responsible for those checks after the commit.
- No production deployment, live endpoint readback, CI run, GitHub mutation, or OAuth flow was performed.

## Changed Surface

- Metrics read-model types, timestamp normalization, and owner gap alignment.
- Public status inventory, coarse history strip, owner sparklines, and owner panel wiring.
- Project health derivation.

## Final Corrective Fix

Date: 2026-07-12
Base HEAD: `1a7e602`

### Fixes Applied

- `CoarseHistoryStrip` now bounds the known interval before a `gapBefore` sample to the collector's 60-second cadence. Large missing spans remain unknown from the end of that bounded interval through the next sample while timestamp-proportional positioning is preserved.
- Dense coarse history is aggregated into at most 96 fixed time buckets per strip. Bucket values use overlap duration, and any bucket intersecting unknown coverage remains unknown.
- `MetricsSparkline` now renders a visible SVG marker for isolated one-point segments while continuing to break polylines at missing-time boundaries.
- The metrics reader rejects future-dated `latest.json` samples, records only a safe owner diagnostic, and returns unavailable freshness. Both `derivePublicMetrics` and `deriveOwnerMetrics` repeat the future-date boundary check for in-memory/legacy callers, so public disk/services/timestamps and owner latest/attention cannot use future evidence.

### Covering Regressions

- Long internal gap strip geometry verifies the preceding known segment is limited to one minute rather than the large-gap midpoint.
- A 1,440-sample strip verifies no more than 96 visual buckets render.
- Sparse sparkline coverage verifies one isolated sample renders as a visible `circle` and missing-time polyline splitting remains intact.
- Reader and read-model tests verify future latest sanitization, unavailable public state, null owner latest, safe diagnostics, and no owner alert based on future host values.

### Final Verification

- Focused chart/reader/status slice: 4 files, 47 tests passed.
- `npm test` -> 23 test files, 137 tests passed.
- `npm run lint` -> passed.
- `npx tsc --noEmit` -> passed.
- `AUTH_SECRET=dev-secret npm run build` -> passed; 29 routes generated.
- `python3 -m unittest ops.tests.test_frontpage_metrics_collector` -> 14 tests passed.
- `python3 -m py_compile ops/frontpage-metrics-collector.py` -> passed.
- `ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file .vault_pass` -> passed.
- `git diff --check` -> passed.

### Scope and Non-Claims

- No client polling, external dependency, public exact host metric, production deployment, CI run, GitHub mutation, OAuth flow, or browser/E2E run was added or performed by this worker.
- Focused component, reader, status-page, and public-page regression tests.
