# SDD ledger — plan: docs/superpowers/plans/2026-10-03-all-open-issues.md

Base: `998e45a45348ab6dc5b24640941edd839bec5ca0` (plan commit; parent/main is `c45bc2a5517eb2435bea89fd4194b638fd48a96c`). Branch: `codex/frontpage-telemetry-issues`. Worktree is the user-designated isolated managed checkout.

## Scope and pre-flight

- Ruling: the request says “eight scoped tasks” but explicitly lists seven task/issue pairs (T14/#35, T15/#37, T16/#38, T17/#39, T18/#47, T26/#36, T27/#51). Execute and verify all seven enumerated pairs; the explicit list defines scope. Cost if wrong: one omitted task if “eight” intended an unlisted workstream.
- Ruling: the plan's “Planning only is authorized” condition is superseded by the user's explicit current authorization to execute this telemetry workstream. Remain within the user's listed files and side-effect boundaries. Cost if wrong: implementation exceeds the earlier plan-session authorization, but follows the later direct user instruction.
- Ruling: #35's owner disclosure decision is unavailable while the owner is AFK. Preserve the existing public fields and behavior via a tested explicit allowlist, keep newly sensitive details private, and record the proposed coarse projection as pending owner decision. Cost if wrong: the existing disclosure may be broader than the owner ultimately wants; no additional sensitive fields become public.
- Ruling: the actual Cloudflare runtime harness/integration is assigned to parent T1. Add local unit/route/UI regression coverage here and report the precise T1 integration checks still needed; do not claim runtime acceptance from local tests. Cost if wrong: an interaction only exposed by the real Worker/DO runtime remains undetected until T1 integrates it.
- Ruling: T18 is development and synthetic testing only during the live acceptance epoch. Do not install/restart collector services or alter the real evidence epoch. Cost if wrong: process ownership remains unproven on the deployed host until a separately reviewed maintenance step.
- Ruling: retain this `.superpowers/sdd` workspace and its evidence as explicitly requested, despite the generic executing-plans cleanup step. Cost if wrong: one ignored planning artifact remains in the checkout.
- Ruling: the installed SDD scripts provide `task-brief` but not the documented `task-start`; generate/read its per-task brief and capture the current BASE SHA directly before each task. Cost if wrong: none beyond equivalent bookkeeping.
- Ruling: the installed SDD scripts also lack `task-done`; run the brief's focused verification directly, inspect exit/output, and append the same completion evidence only after a green result. Cost if wrong: no automated ledger guard.
- Ruling: the enumerated tasks have these shared interfaces: T15 defines the requested-window/coverage metadata consumed by T16 chunk selection and T17 range presentation; T17 also depends on parent T1 runtime tests. Implement T15 before T16 and T17, preserve one metadata contract, and mark T1 checks pending integration.
- Pre-flight: T14 mining/public projection, T18 process lock, T26 GitHub parsing/stats coalescing, and T27 public feed have no shared write interface with the T15 reader contract. Keep changes in their named ownership files.
- Pre-flight: no implementation has started. No issue/PR writes, merge, deployment, collector install, provider load, or production mutation is authorized.

## Task checklist

- [x] T14 / #35 — mining validation, deadlines, honest freshness, public allowlist.
- [x] T15 / #37 — requested-current-window history and coverage.
- [x] T16 / #38 — bounded relevant chunk selection and cost evidence.
- [x] T17 / #39 — complete owner dashboard refresh and authenticated latest route.
- [x] T18 / #47 — cross-process Python writer exclusion.
- [x] T26 / #36 — GitHub repository normalization and in-flight coalescing.
- [x] T27 / #51 — bounded approved public status feed.

## Evidence

Task-level RED→GREEN commands, focused commits, final self-review, and parent T1 integration requirements will be appended below.

### T14 / #35 — mining validation and freshness

- RED: new parser/freshness/projection cases failed because the exports did not exist (11/11); new public-page regressions failed on missing source-time copy and stale-data labeling (2/2). Added a missing-required-hashrate case; it failed because the parser treated absence as zero activity.
- GREEN: `PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH npm test -- src/lib/metrics/v2/mining.test.ts src/app/status/page.test.tsx src/app/status/page-v2.test.tsx` → 3 files, 18 tests passed.
- Decision: allowlist retains only fields currently rendered publicly (including the existing worker display name, hashrate, 1h average, accepted shares, uptime, and last-share time). Agent, rejected shares, payment, balances, and worker login remain outside the public projection. No source sample timestamp is documented in the inspected response mapping, so source sample time is `unknown`; fetch observation time is tracked separately. Coarse activity-only projection remains pending owner review.
- T1 integration still required: built Worker/DO anonymous HTML and serialized-output check for mining allowlist, owner denial/private-data absence, timeout/cache freshness path under the actual Worker runtime, and source timestamps in deployed response headers/body if the provider contract documents any.
- Commit: `bfa512e5cc3e75449821ab4ef4d5650aeb7ac7e1` — `Validate mining response freshness and public projection`.
- Task completion: T14 / #35 complete on this source checkout. Focused tests → 3 files/18 passed; full `npm test` → 41 files/228 passed; `npx tsc --noEmit` passed; focused ESLint passed. Actual Worker/runtime and owner disclosure acceptance remain pending as listed above.

### T15 / #37 — requested-current-window history

- RED: 5 focused failures showed old timestamp anchoring, missing expected slots, refusal of an empty source series, and ambiguous chart coverage wording.
- GREEN: `PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH npm test -- src/lib/metrics/v2/reader.test.ts src/lib/metrics/v2/schema.test.ts src/lib/metrics/v2/python-projections.test.ts src/components/dashboard/observability/ResourceChart.test.tsx` → 4 files, 23 tests passed; `npx tsc --noEmit` and focused ESLint passed.
- Ruling: retain schema v2 and the existing `coverage_percent` field. Returned timestamps enumerate every aligned closed slot, so existing non-null-cells / timestamp-cells arithmetic now measures the requested window; missing points remain explicit nulls. Cost if wrong: an older chart can display more null gap rows, while the numeric coverage remains window-based.
- T1 integration still required: run range/boundary/empty/stale fixtures through filesystem and actual Cloudflare DO-backed readers, including API/chart payload and 1h/24h/7d/30d slot caps.
- Commit: `d769e356708cc45199d6da4a21299eb44568bbff` — `Anchor owner history to the requested window`.
- Task completion: T15 / #37 complete for source/unit/schema/chart/Python compatibility; Worker/DO runtime check remains assigned to T1.

### T16 / #38 — bounded relevant chunk selection

- RED: the new UTC-boundary and 30-day selection tests failed by reading unrelated invalid-retention files; aggregate-budget coverage failed because the reader had no total query byte limit.
- GREEN: `PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH npx vitest run src/lib/metrics/v2/reader.test.ts src/lib/metrics/cloudflare-store.test.ts` → 2 files, 20 tests passed; `npx tsc --noEmit`, focused ESLint, and `git diff --check` passed.
- Implementation: daily history reads only calendar chunks intersecting `(now-range, now]`; 30d reads only quarter-hour chunks. Queries cap at 32 selected files and 32 MiB decoded. Filesystem sizes are checked before reading. Cloudflare gzip output is capped to the smaller of the per-file and remaining query budgets, then charged by decoded byte count.
- T1 integration still required: exercise 1h/24h/7d/30d selection, UTC boundary, over-budget behavior, and the decoded-byte cap through actual Worker/DO-backed routes; record selected-file count, decoded bytes, and route latency without provider load testing.
- Commit: `b58852fdf21fcbd604d5be349114bb7435dd4c9c` — `Bound telemetry history query reads`.
- Task completion: T16 / #38 complete on local reader/helper tests; real Worker/DO performance and query evidence remain pending T1.

### T17 / #39 — owner telemetry refresh and latest route

- RED: new latest-route suite failed because the endpoint did not exist; coordinated-poller regressions failed because no poller refreshed latest/incidents/history, shared auth expiry, enforced deadlines, or guarded query generations. Root-cause investigation found the host fixture labeled a host query with `resource: "cpu"`; the test now matches the route contract (`resource: null`) and the client rejects mismatched query responses.
- GREEN: `PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH npx vitest run src/app/api/owner/latest/route.test.ts src/components/dashboard/observability/polling.test.ts src/components/dashboard/observability/owner-session.test.ts src/components/dashboard/observability/OwnerObservabilityPanel.test.tsx src/app/status/page.test.tsx src/app/status/page-v2.test.tsx` → 6 files, 20 tests passed; `npx tsc --noEmit`, scoped ESLint, and `git diff --check` passed.
- Implementation: `/api/owner/latest` enforces independent 401/403 owner checks and `private, no-store`/ETag responses. A coordinated 15s poll cycle refreshes latest, incidents, and selected series with 10s deadlines, per-resource ETags, visibility/offline pauses, shared auth expiry that clears the poll snapshot and hides the owner section, explicit separate source timestamps, and range-query matching/generation guards. A vanished selected incident safely falls back to all current markers.
- Final-review fix: the initial incident generation time now comes from `readOwnerIncidentsV2`, not the latest snapshot; each source time is shown separately or marked unavailable. A range change clears the history timestamp until the selected range responds.
- T1 actual Worker checks: after cherry-pick, restore the endpoint in the harness; assert anonymous 401, authenticated non-owner 403, owner 200/304 and `Cache-Control: private, no-store` on every path; run latest/incidents/series refresh together with divergent sample timestamps; range A resolving after B; timeout/recovery; hidden/offline pause; and unauthorized response clears all owner telemetry from rendered DOM. Parent reports the current pre-cherry-pick Worker result as 401/403 passing with expected `/api/owner/latest` 404.
- Commits: `fcc4c2114e302b881ecafe74736497dee1d203a9` — `Refresh and clear owner telemetry as one session`; `b3527d19b3fa8cd95771fb8acbabafc4fcce9732` — `Keep owner telemetry source timestamps distinct`.
- Task completion: T17 / #39 complete for route, component, poller, and unit/browser-render regressions; actual Worker integration remains assigned to T1.

### T18 / #47 — cross-process writer ownership

- RED: five new process/systemd cases failed before implementation: lock descriptor absent, symlink alias admitted concurrently, SIGKILL release had no persistent lock inode, and neither unit declared mutual exclusion. Resource warnings also revealed subprocess pipes needed explicit closure.
- GREEN: `python3 -m unittest ops.tests.test_frontpage_metrics_v2_store ops.tests.test_frontpage_metrics_runtime_map` → 30 passed; `python3 -m unittest discover -s ops/tests -p 'test_*.py'` → 144 passed in 58.978s; `python3 -m compileall -q ...` and `git diff --check` passed.
- Implementation: canonical resolved database path; nonblocking `fcntl.flock(LOCK_EX|LOCK_NB)` on persistent sibling `<database>.writer.lock`; non-inheritable descriptor held across the SQLite connection lifetime and released on close/init failure/process death. Cross-process tests verify symlink alias rejection, clean and SIGKILL release, preserved rows, readonly snapshot and SQLite backup while a separate writer runs, and lock inode stability. Active/shadow systemd units now declare `Conflicts=` both ways while retaining their shared database path. Added `ops/frontpage_metrics_v2/writer-lock.md` with safe ownership/recovery guidance.
- Production boundary: only synthetic temporary databases/processes and repository unit files were used. No collector install/restart or current acceptance-epoch change occurred. A reviewed maintenance install is still required before production claims.
- Commit: `3be33de3cb9945aaabfad73ea879134770b4a444` — `Lock metrics store ownership across processes`.
- Task completion: T18 / #47 complete in source and subprocess tests; deployed exclusion/runtime acceptance remains pending.

### T26 / #36 — repository normalization and stats coalescing

- RED: 20 regressions failed on exact repo parsing, case-insensitive in-flight coalescing, bounded error categories, API normalized-key matching, and content-posture preservation. Existing coverage parsing accepted insecure `http`, URL credentials, query, and fragment components.
- GREEN: `PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH npx vitest run src/lib/github-stats.test.ts src/lib/repository-coverage.test.ts src/app/api/github/stats/route.test.ts` → 3 files, 30 passed; `npx tsc --noEmit`, scoped ESLint, and `git diff --check` passed.
- Implementation: shared JS-compatible strict parser accepts exact HTTPS `github.com/owner/repo` URLs (optional `.git` and terminal slash) and deliberate two-part refs; rejects credentials, query/hash, ports, non-HTTPS, lookalikes, and extra routes. Canonical lower-case keys align extraction, API map, cache, and in-flight promises. Concurrent cache misses share the repo+commit pair; successful results retain the five-minute cache, while unavailable results clear in-flight state without caching so the next request can retry. Provider failures become bounded categories, not raw response text.
- Final-review fix: a new immediate-retry regression failed against the settled unavailable cache and passed after failures stopped entering the five-minute cache.
- Optional posture check: mocked stats API returns unavailable stats while canonical lifecycle/maturity values remain unchanged; no public-provider call was made.
- Commits: `dc0a6a6f647016d349219ca7e6161564efc10c20` — `Normalize and coalesce GitHub repository stats`; `e1074c70d4370fb6aa4f1459f5343373d8129336` — `Retry unavailable GitHub stats without stale cache`.
- Task completion: T26 / #36 complete for stats, route, shared Node coverage parser, and optional-context regression tests.

### T27 / #51 — bounded public status feed

- RED: feed/helper and route tests initially failed because neither existed. They cover stable IDs/deduplication, true source timestamps, maintenance timestamp handling, the 256-item cap, hostile summary escaping, privacy projection, actual empty versus unavailable, and projection/runtime exceptions.
- GREEN: `PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH npx vitest run src/lib/metrics/v2/status-feed.test.ts src/app/status/feed.json/route.test.ts src/lib/metrics/v2/public-status.test.ts src/app/status/page.test.tsx src/app/status/page-v2.test.tsx` → 5 files, 19 passed; `npx tsc --noEmit`, scoped ESLint, and `git diff --check` passed.
- Implementation: anonymous `/status/feed.json` emits JSON Feed 1.1 with at most 256 stable-ID incident/maintenance summaries, plain `content_text`, escaped JSON, event de-duplication, collected/incident source times, and freshness/overall state. Invalid, missing, disabled, or throwing public projections return feed-shaped HTTP 503, unknown state, `no-store`; a valid zero-event source returns HTTP 200 with `availability: available`. Maintenance has no canonical update timestamp, so the feed uses startsAt as publication time and omits `date_modified`.
- Documentation: `docs/status-feed.md` records the feed contract and v2-disabled/unavailable distinction.
- T1 actual Worker checks: anonymous GET to `/status/feed.json` when v2 enabled and disabled; confirm 200 valid JSON Feed and 503 feed-shaped unavailable response respectively; inspect no owner identifiers/evidence/exact host numbers and confirm 256 cap/source times in the built Worker.
- Commit: `1e4439489abe8679a18b889a50aed64c42407bdf` — `Publish bounded public status feed`.
- Task completion: T27 / #51 complete in source/projection tests; actual Worker response/runtime behavior remains assigned to T1.

## Final branch review

- Review package: `.superpowers/sdd/2026-10-03-all-open-issues/review-998e45a..e1074c7.diff` covers the complete nine-commit branch range. Final review: self-review (no subagent tool); a fresh independent reviewer would be stronger. No Critical findings remain.
- Final: fixed Important finding — owner incident/history source timestamps could be falsely attributed to another projection/range — `shows the actual incident source timestamp separately from latest and history` and `does not attribute the prior range timestamp to a newly requested empty history` RED→GREEN; suite `47/270`.
- Final: fixed Important finding — an unavailable GitHub response was cached for five minutes and prevented prompt recovery — `clears failed in-flight work and retries an unavailable result immediately` RED→GREEN; suite `47/270`.
- Strengths: focused ownership boundaries; real process exclusion tests; bounded streaming/decompression paths; route and projection regressions; no provider calls or production mutations.
- Declined to judge: none. Actual Worker/DO/browser integration is explicitly assigned to parent T1 and remains a separate acceptance gate.
- Deferred minors: none.
- Final tree: source/unit implementation is complete for all seven enumerated tasks. Parent T1 still owns real Worker, browser, and decoded-byte/runtime evidence; T18 production installation remains outside this execution.

## Final checkpoint — 3 October 2026

- Exact checkout: `/Users/reidar/.codex/worktrees/frontpage-metrics-issues/Frontpage`, branch `codex/frontpage-telemetry-issues`, base `998e45a45348ab6dc5b24640941edd839bec5ca0`; final HEAD `e1074c70d4370fb6aa4f1459f5343373d8129336`. Tracked worktree is clean; `git diff --check 998e45a45348ab6dc5b24640941edd839bec5ca0..HEAD` passes.
- All seven explicitly enumerated tasks are checked above. Nine focused commits cover the seven task implementations and the T17/T26 review fixes.
- Final local evidence: `npm test` 47 files / 270 tests passed; `npx tsc --noEmit` passed; changed-source ESLint passed; Python telemetry suite 144 tests passed. No full build or browser/Worker harness was run in this child; parent owns combined build/browser/runtime validation.
- Integration boundary: parent T1 must restore and exercise `/api/owner/latest` in the actual Worker harness; verify anonymous 401, non-owner 403, owner 200/304 and `private, no-store`, plus owner DOM clearing and coordinated latest/incidents/history polling. Run feed/mining privacy and freshness checks, requested-window and bounded decoded-byte route checks in the built Worker/DO. The parent's `readCloudflareMetric` legacy consistency-guard changes remain outside this branch; this branch only changes the v2 projection query helper in `cloudflare-store.ts`.
- Policy rulings retained: current mining disclosure stays as-is while the owner is AFK; the explicit public allowlist adds no sensitive fields, and the proposed coarse projection remains pending owner decision. T18 stays synthetic/development-only until separately reviewed maintenance; no live collector install/restart. No provider calls, production mutation, issue write, PR, push, merge, deploy, or full build/browser run.

## Runtime follow-up checkpoint — fixture alignment

- Foundation merge: `947ab57315b1f16c4ee578bc6374420a48ca4001` (`6f593f8` ancestry included); signing was disabled per command only, with no global Git configuration change.
- Diagnosis: collector CPU samples are admitted only within the first 1,000 ms of a 15-second UTC interval. Projection timestamps serialize to whole seconds; SQL minute/quarter-hour rollups use floor-bucket timestamps. Thus the actual exported series uses aligned UTC slots. The e2e fixture incorrectly retained `Date.now()` milliseconds at every resolution, creating timestamps the projection does not emit and causing all chart values to miss the reader's closed slots.
- RED: `node --test tests/e2e/metric-fixture-times.test.mjs` failed before the helper existed. GREEN: the focused Node 22 test passes for 15-second, minute, and quarter-hour UTC buckets.
- Change: fixture timestamps now end at the latest closed bucket; the owner chart regression requires the keyboard readout to include the selected CPU value and exclude “No measured samples in this range.”
- Runtime v2 Worker route harness and owner/latest/feed/restart/privacy checks remain the next follow-up commit; no build or Worker harness was run while parent build is in progress.

## Runtime follow-up checkpoint — local Worker harness

- Commit: `216ef822048961b2d5dd9cd1db6db64ce40ba149` — `Exercise v2 owner telemetry in Worker runtime`.
- The Worker harness now ingests existing v2 fixtures through real local hashed uploads, prepare, commit, and activation with a synthetic 48-hour gate. A test-only entry replaces network access with one fixture response for the mining endpoint and throws for every other outbound fetch.
- Added runtime assertions for owner/latest 401 and 403 with `private, no-store`, owner 200/304 ETag behavior, 1h window bounds/closed timestamps/coverage, public feed source timestamps and owner-field redaction, public status HTML redaction, owner SSR latest/incidents/history timestamps, streamed compressed-body and decoded-size limits, and v2 reads after Worker restart.
- Added browser regression for 401-clearing private telemetry and no further 15-second poll. Targeted syntax checks, fixture-time Node test, changed-file ESLint and `git diff --check` pass. The built Worker runtime and Playwright suite were not run in this worktree; parent owns those runs.
- Local SDD bookkeeping was removed from the Git index with `git rm --cached` and remains on disk, as requested; it is excluded from the source PR diff.
