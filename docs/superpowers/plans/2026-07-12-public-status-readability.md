# Public Status Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each task must be reviewed before the next task begins.

**Goal:** Make `/status` easier to scan and more truthful about time windows, freshness, coverage, service reliability, and responsive priority without exposing exact host metrics or private checks.

**Architecture:** Normalize schema-valid metrics at the reader boundary into a real, timestamp-bounded 24-hour window. Derive a public-safe model containing explicit freshness, coverage, gap, pressure, and service-trend semantics. Keep rendering components presentational: the public page consumes only the derived model, while the owner page continues to receive exact metrics separately.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components, TypeScript, Zod, Tailwind CSS 4, Vitest, Playwright, Python `urllib` collector tests.

## Global Constraints

- Preserve the existing public/owner boundary: public pages expose only coarse derived health, pressure, latency, coverage, and freshness; exact host metrics, load, uptime, container identifiers, internal services, and diagnostics remain owner-only.
- Do not change the metrics schema version or require a migration; history normalization is a read-model concern.
- A “24-hour window” is timestamp-bounded to the preceding 24 hours, not inferred from the number of samples.
- Missing samples, malformed history, stale telemetry, and unavailable telemetry must never render as current healthy state.
- Preserve lifecycle, maturity, runtime health, evidence, and limitations as separate dimensions.
- Use existing semantic CSS roles and accessible text; no new gradients, decorative blobs, or color-only status communication.
- Keep the public status page server-rendered and do not add a client-side polling loop in this slice.
- Do not perform a production deployment, GitHub mutation, or real OAuth flow as part of implementation.

---

### Task 1: Normalize timestamp-bounded telemetry history

**Files:**
- Modify: `src/lib/metrics/types.ts`
- Modify: `src/lib/metrics/reader.ts`
- Test: `src/lib/metrics/reader.test.ts`

**Interfaces:**
- Preserve `MetricsReadResult` and `deriveOwnerMetrics` callers.
- Add these exact read-model types, keeping raw `MetricsSnapshot` exact data owner-only:

```ts
export type HistoryAvailability = "available" | "empty" | "unavailable";

export interface HistoryCoverage {
  availability: HistoryAvailability;
  windowStartAt: string;
  windowEndAt: string;
  sampleCount: number;
  gapCount: number;
}

export interface PublicServiceTrend {
  knownChecks: number;
  totalSamples: number;
  availabilityPercent: number | null;
  coveragePercent: number | null;
  p95LatencyMs: number | null;
  lastTransitionAt: string | null;
}
```

- `PublicMetricsModel.history` entries add `gapBefore: boolean` and the model adds `historyCoverage` and `serviceTrends: Record<string, PublicServiceTrend>`.
- `MetricsReadResult` adds `historyAvailability`; `OwnerMetricsModel` adds `historyCoverage`.
- Use a 24-hour duration constant in the reader; do not change `MAX_HISTORY_SAMPLES` or schema version.

- [ ] **Step 1: Add failing reader tests**

Cover these exact behaviors in `src/lib/metrics/reader.test.ts`:

```ts
it("keeps only samples from the preceding 24 hours", () => {
  // Include samples at 25h, 24h, 12h, and now; expect only the in-window samples.
});

it("sorts and de-duplicates history by collected_at", () => {
  // Provide reverse-order duplicate timestamps; expect chronological unique output.
});

it("reports collection gaps instead of presenting them as continuous history", () => {
  // Provide samples separated by more than the expected 60-second cadence.
  // Expect a public coverage model with a gap marker/unknown bucket.
});

it("does not call a missing latest sample a configured-check absence", () => {
  // Read with no latest.json but a valid older history sample.
  // Expect unavailable freshness and an explicit current-sample state.
});
```

- [ ] **Step 2: Run the focused reader tests and confirm they fail**

Run:

```bash
npm test -- src/lib/metrics/reader.test.ts
```

Expected: the new tests fail because the current reader uses all retained samples and has no normalized coverage model.

- [ ] **Step 3: Implement normalization at the reader boundary**

Implement these rules in `src/lib/metrics/reader.ts`:

- Parse timestamps once and discard samples outside `[now - 24h, now]`.
- Sort by `collected_at` ascending and de-duplicate equal timestamps, keeping the last occurrence.
- Treat future-dated samples as unavailable for the current window.
- Compare adjacent samples against the collector’s 60-second cadence with a `> 120_000ms` gap threshold; represent missing intervals as coverage gaps rather than fabricating measurements.
- Reconcile a valid `latest` sample that is absent from history by including it once in the normalized display window, while exposing that history was incomplete through coverage metadata.
- Keep raw `result.history` available to the owner model only as needed, but make owner/public trend components consume the normalized window.
- Derive public service trend data from public service entries only. Availability must use known `up`/`down` checks, exclude `unknown` from the uptime denominator, and expose sample coverage so low-coverage results cannot read as strong uptime. Use `availabilityPercent = up / (up + down) * 100` rounded to one decimal, `coveragePercent = (up + down + unknown) / totalSamples * 100` rounded to one decimal, and the nearest-rank p95 of non-null latency values.

The public model must not contain `cpu_percent`, `ram_used_bytes`, `disk_used_bytes`, load fields, uptime, container ids, owner service ids, or diagnostics.

- [ ] **Step 4: Run focused and full unit tests**

Run:

```bash
npm test -- src/lib/metrics/reader.test.ts
npm test
```

Expected: focused tests and the complete suite pass with no warnings.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metrics/types.ts src/lib/metrics/reader.ts src/lib/metrics/reader.test.ts
git commit -m "feat: normalize public telemetry history"
```

---

### Task 2: Define public status, stale, and unavailable semantics

**Files:**
- Modify: `src/lib/metrics/status-page.ts`
- Modify: `src/components/dashboard/VpsStatusSummary.tsx`
- Test: `src/lib/metrics/status-page.test.ts`
- Test: create `src/components/dashboard/VpsStatusSummary.test.ts`

**Interfaces:**
- Consume the normalized public model from Task 1.
- Preserve `OverallPublicStatus` and `OverallPublicStatusKind` names unless a type-safe extension is required.
- Keep `VpsStatusSummary` presentational and server-compatible.
- Policy: `Operational` means fresh telemetry, at least one configured public check, every current public check up, and no critical disk pressure. CPU/RAM pressure remains a separate coarse host signal and does not change the overall badge; disk `watch` is visible but is not a service outage.

- [ ] **Step 1: Add failing semantic tests**

Cover:

```ts
it("reports delayed status without counting stale checks as up", () => {
  // A stale latest sample must produce delayed status and unknown current checks.
});

it("reports unavailable current telemetry separately from no configured checks", () => {
  // Missing latest data must not render the summary value "No checks".
});

it("does not claim operational when the selected host-pressure policy is degraded", () => {
  // Exercise the chosen sustained/coarse CPU, RAM, and disk policy.
});
```

Add component rendering assertions for `Last known`, `No current sample`, and the selected host-pressure wording.

- [ ] **Step 2: Encode the host-pressure policy**

Keep the exact policy above in `deriveOverallPublicStatus` tests: CPU/RAM pressure is informational, disk `watch` remains visible but operational, and critical disk produces degraded status. Do not invent a sustained CPU/RAM incident threshold in this slice.

- [ ] **Step 3: Implement stale/unavailable display semantics**

Update `VpsStatusSummary` so:

- Fresh values read as current.
- Stale disk pressure reads as `Last known: ...`.
- Stale service counts read as unknown/pending rather than `0/N up`.
- Missing latest telemetry reads as `No current sample` or `Unavailable`, never `No checks` unless configuration is genuinely empty. When a valid older history sample exists, retain its coarse configured public-check count as `last known` context.
- Relative timestamps retain exact accessible `time` labels.

Keep public services coarse and preserve owner-only exact diagnostics.

- [ ] **Step 4: Run focused and full unit tests**

```bash
npm test -- src/lib/metrics/status-page.test.ts src/components/dashboard/VpsStatusSummary.test.ts
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/metrics/status-page.ts src/lib/metrics/status-page.test.ts src/components/dashboard/VpsStatusSummary.tsx src/components/dashboard/VpsStatusSummary.test.ts
git commit -m "fix: make public status freshness explicit"
```

---

### Task 3: Make history and service inventory readable

**Files:**
- Modify: `src/components/dashboard/CoarseHistoryStrip.tsx`
- Modify: `src/components/dashboard/MetricsSparkline.tsx`
- Modify: `src/components/dashboard/StatusInventory.tsx`
- Test: create `src/components/dashboard/CoarseHistoryStrip.test.ts`
- Test: create `src/components/dashboard/MetricsSparkline.test.ts`
- Test: create `src/components/dashboard/StatusInventory.test.ts`

**Interfaces:**
- Consume normalized timestamped history and public service trends from Task 1.
- Do not recompute time windows or availability in components.

- [ ] **Step 1: Add failing component tests**

Assert that:

- History renders `24h ago`, an intermediate time label, and `now`.
- A gap is announced as unknown/coverage missing.
- Service rows show availability coverage and last transition only when supported by evidence.
- Stale service latency is labeled last-known and never presented as current.
- The public markup does not contain exact host field names or private identifiers.

- [ ] **Step 2: Implement accessible coarse history rendering**

Update `CoarseHistoryStrip` to render normalized buckets with:

- Stable time direction and labels.
- Grouped bucket start/end context in `title` and accessible text.
- Focusable or otherwise screen-reader-readable bucket summaries without pretending the chart is an interactive control.
- An explicit `History unavailable` or `No recent samples` state based on coverage metadata.

Update `MetricsSparkline` to consume the same normalized window and stop calling count-bounded data a 24-hour trend.

- [ ] **Step 3: Implement service reliability context**

Update `StatusInventory` to show a compact evidence row for each service: current state, latest check age, known-check availability or coverage, and last transition where available. Make the service/project destination discoverable while keeping the public row uncluttered.

- [ ] **Step 4: Run focused and full unit tests**

```bash
npm test
npm run lint
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/CoarseHistoryStrip.tsx src/components/dashboard/MetricsSparkline.tsx src/components/dashboard/StatusInventory.tsx src/components/dashboard/CoarseHistoryStrip.test.ts src/components/dashboard/MetricsSparkline.test.ts src/components/dashboard/StatusInventory.test.ts
git commit -m "feat: clarify public history and service trends"
```

---

### Task 4: Recompose the status page for responsive scanning

**Files:**
- Modify: `src/app/status/page.tsx`
- Modify: `tests/e2e/public-ui.spec.ts`

**Interfaces:**
- Consume the completed public model and components from Tasks 1-3.
- Preserve public route `/status`, metadata, anonymous rendering, and owner section behavior.

- [ ] **Step 1: Add failing browser assertions**

Extend the public status suite to assert:

- At 390px, the public service inventory appears before history in document layout.
- Time labels and coverage wording are visible.
- Fresh synthetic metrics retain the current `Operational` and `5/5 up` behavior.
- Public HTML still excludes exact host fields, internal service ids, containers, diagnostics, and owner status.
- The route has no horizontal overflow and passes axe at desktop/mobile representative widths.

- [ ] **Step 2: Tighten hero and responsive ordering**

Reduce the status hero’s unused vertical space while preserving hierarchy. On mobile, render current status and public checks before history; on desktop retain the history/inventory two-column composition. Do not introduce a client polling loop or card nesting.

- [ ] **Step 3: Run browser verification**

```bash
npm run test:e2e
```

Expected: all public and authenticated existing tests pass, including redaction, axe, overflow, media, owner denial, and owner navigation.

- [ ] **Step 4: Commit**

```bash
git add src/app/status/page.tsx src/app/globals.css tests/e2e/public-ui.spec.ts
git commit -m "feat: prioritize status scanning on small screens"
```

---

### Task 5: Harden optional service check contracts

**Files:**
- Modify: `ops/frontpage-metrics-collector.py`
- Modify: `ops/frontpage-metrics.config.json`
- Test: `ops/tests/test_frontpage_metrics_collector.py`
- Modify: `DEPLOYMENT.md` to document the optional check contract and redaction behavior.

**Interfaces:**
- Preserve existing status-code checks as the default and keep current production configuration behavior unchanged unless an explicit bounded assertion is configured.
- Do not expose target URLs, response bodies, exception text, or internal diagnostics in public metrics.

- [ ] **Step 1: Add failing collector tests**

Cover:

```py
def test_status_check_can_require_a_bounded_health_marker():
    # A 200 response with the wrong bounded marker is down.

def test_check_failure_redacts_response_body_and_target_details():
    # Stored result contains only safe status/latency fields.

def test_default_status_check_remains_backward_compatible():
    # Existing configured services still use expected_status only.
```

- [ ] **Step 2: Implement explicit optional check modes**

Add this exact optional configuration shape, defaulting to the existing status-only behavior:

```json
"check": {
  "type": "json-field",
  "path": ["status"],
  "expected": "healthy"
}
```

Allow only `type: "http-status"` or `type: "json-field"`; `path` must contain 1-3 simple field names and `expected` must be a string of at most 80 characters. For `json-field`, read at most 64 KiB, parse JSON, walk the path, and mark the check down when the value does not equal `expected`. Store no body, URL, exception, or parser details. Reject malformed check configuration at load time and preserve status-only behavior when `check` is omitted.

- [ ] **Step 3: Keep current production config conservative**

Configure the existing Frontpage `/api/health` check with `{"type":"json-field","path":["status"],"expected":"healthy"}`. Leave external services status-only because their response contracts are not owned here. Preserve the current public/owner visibility settings.

- [ ] **Step 4: Run Python verification**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_collector
python3 -m py_compile ops/frontpage-metrics-collector.py
ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file .vault_pass
```

- [ ] **Step 5: Commit**

```bash
git add ops/frontpage-metrics-collector.py ops/frontpage-metrics.config.json ops/tests/test_frontpage_metrics_collector.py DEPLOYMENT.md
git commit -m "feat: support bounded service health checks"
```

---

### Final verification and whole-branch review

- [ ] Run `npm test`, lint, TypeScript, Python tests/compile, Ansible syntax, `git diff --check`, production build, full Playwright, and Docker runtime smoke.
- [ ] Verify public status at desktop and 390px mobile with screenshots, including fresh, stale, unavailable, sparse-history, malformed-history, and service-failure fixtures.
- [ ] Generate a final whole-branch review package from the merge base and dispatch the most capable reviewer.
- [ ] Fix all Critical/Important findings, rerun the covering tests, and re-review.
- [ ] Do not deploy until the branch is locally green and the final reviewer approves.
