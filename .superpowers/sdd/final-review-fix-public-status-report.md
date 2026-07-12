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
- Focused component, reader, status-page, and public-page regression tests.
