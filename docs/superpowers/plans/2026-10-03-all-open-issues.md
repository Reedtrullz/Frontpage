# Frontpage Open Issues Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task by task. Checkboxes track execution; they do not indicate completion in this planning session.

**Goal:** Resolve all 30 issues open on 3 October 2026, preserving owner drafts, public privacy, deployment identity and genuine metrics acceptance evidence.

**Architecture:** Keep repository-owned public content, owner-only filesystem/SQL state, the current OpenNext Worker/SQLite Durable Object, and the VPS collectors. Strengthen the existing boundaries before adding catalogue features. Use focused PRs with explicit interfaces and failure tests; share helpers only when multiple callers need the same contract.

**Tech stack:** Next.js 16.3.8, React 19.2.7, TypeScript, Zod, Auth.js, OpenNext Cloudflare, SQLite Durable Objects, Python/systemd collectors, Vitest, Playwright, Wrangler and Ansible.

**Spec:** [Dated issue snapshot](../specs/2026-10-03-frontpage-open-issues.json), containing the exact bodies, priorities and dependencies of [issues #26–#55](https://github.com/Reedtrullz/Frontpage/issues). The choices below supplement the issues; they are proposed implementation decisions, not existing behavior.

## Verified starting point

- Remote `main`: `c45bc2a5517eb2435bea89fd4194b638fd48a96c`. All 30 open issues are proposals; none has comments. No open PRs at inventory time.
- [Main CI 37037653299](https://github.com/Reedtrullz/Frontpage/actions/runs/37037653299) succeeded. A fresh read of `https://reidar.tech/api/health` returned healthy and the same full SHA. This is identity evidence, not proof that these issues are resolved.
- The primary checkout is still at `948b3e7567ba1d53bb1ecab1f2ad604d1605a222`, with existing edits to `AGENTS.md` and `README.md`, plus untracked `.playwright-cli/`, `CURRENT_STATE.md`, `docs/proposals/` and `src/lib/content/AGENTS.md`. Source analysis used fetched remote main; do not execute against the older checkout.
- Current source still contains unconditional draft replacement/deletion and prefix-based `versionsMatch`; v1 ingestion still buffers before checking its cap, accepts JSON without metrics schema validation, and replaces latest/history separately. CI builds the Worker but the browser suite runs the Next standalone runtime. These make #26–#28, #40–#42 immediate foundations.
- PRs #56–#60 already repaired collector alignment/projection work and introduced gated Cloudflare v2 transport. [Activation runbook](../../cloudflare-v2-activation.md) and `src/lib/metrics/v2/cloudflare-upload.ts` exist. **Do not implement #45 or #46 from their obsolete problem descriptions.** Reconcile those issues against shipped code and finish remaining acceptance.
- A read-only VPS read retrieved a stored schema-3 gate generated at `2026-10-03T11:50:53Z`: `approved=false`, 1,125 pairs / 18.733 hours, no missing/incomplete minutes, maximum gap 60 s, and one mismatch in 6,750 comparisons. That receipt is an earlier snapshot, not a freshly regenerated acceptance decision. The existing project note identifies the mismatch at 3 October 04:36 UTC and gives a conditional earliest clean rolling window around **5 October 06:38 Europe/Oslo**. Neither that date nor elapsed time authorizes activation.

## Global constraints

- Planning only is authorized in this session. Implementation, issue comments/closure, merge, publication, deployment and activation are subsequent work.
- Execute from an isolated checkout based on freshly fetched main; inspect existing worktrees before creating one. Preserve primary WIP, runtime state, rollback images and collector evidence.
- Public routes continue reading canonical `content/*.json`; private drafts never become runtime public overrides. Independent route, page and handler owner checks remain.
- No web-app shell, SSH, Docker socket, restart, deploy or prune capability. Operator backup and release commands stay outside the app.
- No force Git ref updates, weak SHA write preconditions, invented media or automatic verification upgrades from repository activity.
- Keep lifecycle, maturity, evidence scope, review age and runtime health independent; use semantic styles and accessible text.
- Preserve existing schema and retention limits unless a task explicitly versions its contract. Unknown versions fail closed. Rollout must retain backward readers before new writers are enabled.
- Collector gate remains schema 3: at least 48 hours, no missed/incomplete required samples, maximum gap 120 s, maximum evidence age 120 s, CPU/RAM/disk p99 relative divergence at most 2%, public-service mismatch exactly 0%. Never reset an epoch or weaken a threshold to obtain approval.
- Current v2 transport budgets remain: 1 MiB compressed per file; 512 KiB/4 MiB expanded per applicable projection; staging 520 files/64 MiB; complete snapshot 32 MiB; latest freshness 45 s. Changes require measured evidence and review.
- Before long builds/tests, require at least 30 GiB free on `/System/Volumes/Data`. Use bounded scratch paths. No subagents are necessary for planning; execution delegation must obey current user model policy and live availability.

## Review focus

1. Save or discard from a stale tab, including a save during pending publication: retain the newer draft and return an actionable conflict (Tasks 3–5).
2. GitHub accepts a commit but local storage or the HTTP response fails: reconcile the exact original commit without duplicate publication (Task 4).
3. Truncated uploads, replay, decompression bombs and a crash between pair members: keep the last-good generation, bounded memory and public redaction (Tasks 1, 7–8).
4. Old dense history, a midnight boundary and a delayed response after range/auth changes: display current-window gaps and prevent stale/private data reuse (Tasks 15–17).
5. Correct preview SHA with stale custom-domain routing, or a database surviving code rollback: fail release acceptance and distinguish code rollback from state restore (Tasks 9–10).

## Execution waves

The table is an ordering recommendation, not a calendar estimate. Run at most two independent workstreams initially; avoid simultaneous changes to the same contract or CI file.

| Wave | Deliverable | Tasks / issues |
|---|---|---|
| 1 | Production-runtime test harness, exact identities, trusted SSH and reproducible setup | T1 #42; T2 #28; T11 #49; T12 #48; T13 #53 |
| 2 | Safe owner save, review, publish and recovery | T3 #26 → T4 #27 and T5 #30; T6 #50; T9 #43 |
| 3 | Validated coherent metrics and release acceptance | T7 #40 → T8 #41; T10 #44; T14 #35 |
| 4 | Honest and bounded owner observability | T15 #37 → T16 #38; T17 #39; T18 #47 |
| 5 | Editor and public project presentation | T20 #29; T21 #54; T22 #32; T23 #31; T24 #33; T25 #34; T26 #36 |
| 6 | Public feed, one timeline pilot and measured runtime headroom | T27 #51; T28 #52; T29 #55 |
| Acceptance lane | Existing collector proof and prepared v2 activation | T19 #46 and #45, coordinated with the existing acceptance work |

The acceptance lane runs alongside development. Avoid installing T18 or other collector changes during its current evidence window; if a necessary collector change requires a restart/new epoch, record why and collect the newly required evidence. Do not create a second monitor or race the existing operator task.

## File and interface ownership

| Boundary | Existing files | New focused files proposed |
|---|---|---|
| Owner state/publication | `src/lib/content/drafts.ts`, `publication.ts`, `admin-view.ts`, `src/lib/github.ts`, `src/app/api/data/`, admin editors | `src/lib/content/identity.ts`, `publication-intents.ts`, `src/lib/owner-request.ts` |
| Worker ingestion/storage | `cloudflare/do-entry.mjs`, `src/lib/metrics/cloudflare-store.ts`, `v2/cloudflare-upload.ts`, uploader | `src/lib/metrics/cloudflare-v1-upload.ts` |
| Worker runtime verification | `.github/workflows/ci.yml`, `playwright.config.ts`, existing browser tests | `tests/cloudflare/runtime.mjs`, `tests/cloudflare/runtime.test.mjs`, `playwright.cloudflare.config.ts` |
| Owner observability | v2 reader/types/schema, owner routes, observability components | `src/app/api/owner/latest/route.ts`, `src/lib/metrics/v2/mining.test.ts` |
| Project display | content schema/presentation, detail route, `ProjectEditor.tsx`, `ProjectMedia.tsx` | `src/components/projects/ProjectDetailContent.tsx` |
| Operations | workflows, Dockerfile, Ansible, Python stores/units and tests | `scripts/verify-release.mjs`, `scripts/check-environment.mjs`, `scripts/current-state.mjs`, `ops/frontpage-owner-state.mjs` |
| Optional public additions | approved public projection and canonical project schema | `src/app/status/feed.json/route.ts`, `scripts/measure-cloudflare-headroom.mjs` |

New names are decisions for execution; reuse an existing equivalent discovered during implementation rather than adding duplicate infrastructure.

## Tasks

### Task 1 — Exercise the real Cloudflare runtime (#42, P1)

**Dependencies:** None. Provides the integration boundary for Tasks 3, 6–10, 14–17 and 29.

**Files:** Create the runtime harness and Cloudflare Playwright configuration listed above; modify `package.json` and `.github/workflows/ci.yml`; retain the standalone and Docker suites.

**Interface:** Add `npm run test:cloudflare` for a built OpenNext bundle served by Wrangler local with persisted SQLite DO state and isolated synthetic secrets. CI job `cloudflare-runtime` must be a dependency of deployment. Reuse authenticated/non-owner fixtures without a production auth bypass or real external writes.

- [ ] Add checks that fail when requests use filesystem fallback: owner save/read via `FRONTPAGE_SQL`, app/DO restart preserving drafts/receipts, missing binding failure, anonymous/non-owner denial for drafts/latest/series/incidents, collector token rejection, and proxy forwarding with exact path/query/method/body plus origin-token behavior.
- [ ] Launch the actual bundle/entry point through Wrangler local; exercise both v1 and disabled v2 ingress/read pointers. Mock external GitHub/pool/proposals providers at their network boundary. Record synthetic-runtime limits explicitly.
- [ ] Run the new suite plus existing auth/routes/browser regressions; require no auth bypass in the production bundle. Commit one harness PR.

### Task 2 — Separate write SHA identity from display versions (#28, P1)

**Dependencies:** None; land before Tasks 3–5 and 10.

**Files:** Create `src/lib/content/identity.ts`; modify `drafts.ts`, `publication.ts` and their tests; update caller tests.

**Interface:** `parseFullCommitSha(value: string): string | null` accepts only anchored 40-hex Git identities. `parseDeploymentVersion(value: string): { sha: string; scope: 'main' | 'ci' | 'pr' } | null` accepts only documented bare/`sha-`/`ci-`/`pr-` forms. Short legacy labels can be displayed as unverified compatibility labels; they cannot prove a write precondition or a production deployment. Replace the shared `versionsMatch` use with caller-specific comparisons.

- [ ] Prove embedded hex, `dev`, `unknown`, equal arbitrary text, different full SHAs sharing seven digits and `pr-` identity cannot authorize publication or a production deployed badge.
- [ ] Require exact full base/head equality for publication. For existing shortened draft bases, refresh/rebase with explicit review rather than guessing a full SHA.
- [ ] Run `npm test -- src/lib/content/drafts.test.ts src/lib/content/publication.test.ts`; update deployed-state and route fixtures; commit.

### Task 3 — Add draft revisions and conditional cleanup (#26, P1)

**Dependencies:** T1, T2. This is the shared contract for recovery, diffs, catalogue changes and backups.

**Files:** `drafts.ts`, its tests, `publication.ts`, personal/projects/publish routes and route tests, `ProjectEditor.tsx`, `PersonalEditor.tsx`, `PublishPanel.tsx`.

**Interface:** Version draft envelopes to `schemaVersion: 2` with opaque `revision: string`. Add required `expectedRevision: string | null` to saves/discards; null means no existing draft. Successful save returns its new revision; mismatch returns HTTP 409 with a safe conflict code and latest revision. Publish requests carry `reviewedRevisions: { personal: string | null; projects: string | null }`. Cleanup compares each captured revision and never removes an unrelated/newer draft.

- [ ] Add deterministic interleavings in filesystem and actual SQL stores: two stale project-array saves, stale discard, a new personal/project save during GitHub await, and one matching/one changed draft at cleanup. A losing save retains local form text; no silent overwrite.
- [ ] Perform SQL conditional writes/deletes atomically. Filesystem read/check/rename/delete must share a short cross-process exclusive lock using exclusive file creation, with bounded busy/conflict responses; crashes fail closed until operator recovery confirms no active writer. Do not implement a process-local mutex as a filesystem CAS guarantee. Never hold this lock across GitHub/network awaits.
- [ ] Preserve v1 drafts through an explicit versioned migration under the same lock/transaction, and return their new revision to clients. Deploy compatibility readers before enabling v2 writers; preserve raw backup and document rollback compatibility.
- [ ] Run draft/publication/route tests, T1 SQL integration and two-tab owner browser checks; commit.

### Task 4 — Reconcile publication outcomes (#27, P1)

**Dependencies:** T2, T3.

**Files:** Create `publication-intents.ts`; modify `publication.ts`, `drafts.ts`, `src/lib/github.ts`, publish route, `PublishPanel.tsx` and publication tests.

**Interface:** Persist an owner-only `PublicationIntent` before the ref update: intent ID, reviewed revisions, full base/target SHA, expected canonical blob/tree identities and phase. Extend the Git client with exact commit inspection. Result kinds distinguish `failed-before-commit`, `outcome-unknown`, `published-recovery-pending` and `published`; preserve `conflict`. Retries identify the same intent rather than starting a second write. A later main head must be reconciled through ancestry/target-content evidence, not just equality with current HEAD.

- [ ] Inject receipt-write failure, cleanup failure, accepted update with lost response, later head advancement, intent-write failure, and two retries for the same intent. Confirm one publication, exact original commit recovery and retention of newer drafts.
- [ ] Store the target identity before attempting ref advancement; never claim GitHub was unchanged after a confirmed commit. Recovery must not depend on successfully writing another failure receipt. Bound retained intents and refuse to evict unresolved intents automatically.
- [ ] Run publication/client/UI tests and T1 integration; commit. Keep deployment outside publication recovery.

### Task 5 — Review value-level diffs bound to revisions (#30, P2)

**Dependencies:** T3; integrate with T4's outcome labels.

**Files:** `admin-view.ts`, `admin-view.test.ts`, `PublishPanel.tsx`, owner browser tests.

**Interface:** Add `buildContentDiff(...)` returning bounded typed changes with field path, before/after and added/removed/changed kind for personal/projects content. The review model carries T3's exact revision pair; publish consumes that pair.

- [ ] Assert nested section text, evidence links, gallery additions/removals and renamed projects show actual values; unchanged fields are omitted. If output is bounded, clearly expose remaining change count and block confirmation until the complete diff is accessible.
- [ ] Reset confirmation on changed reviewed revisions. A draft saved by another tab must produce 409 and a refresh/review action; retain owner text.
- [ ] Run admin view/publication tests and mobile/keyboard owner browser checks; commit.

### Task 6 — Define owner mutation boundaries (#50, P2)

**Dependencies:** T1; coordinate T3 route bodies to avoid competing contracts.

**Files:** Create `src/lib/owner-request.ts`; modify personal/projects/publish routes and tests, `src/proxy.ts` only if actual runtime evidence requires it.

**Interface:** `readOwnerMutationJson(request: Request): Promise<unknown>` runs after session/owner authorization; it enforces a proposed 4 MiB streamed body cap, JSON media type and same-origin browser policy using deployment-configured origins. Missing or `null` Origin is denied for cookie-authenticated unsafe requests; do not trust arbitrary Host/forwarded headers to expand the allowlist. DELETE revision bodies receive the same boundary. This helper handles request parsing, not ownership itself.

- [ ] Pin actual configured cookies/framework behavior through T1. Test anonymous/non-owner, trusted/untrusted/missing/null origins, malformed/chunked/oversized bodies and discard-storage failure. Assert 401/403/400/413 responses and zero mutation as applicable.
- [ ] Cancel over-budget streams without draining them, return safe actionable errors, and document the body cap even if larger schema-valid documents exist.
- [ ] Run route/auth tests and actual-runtime controls; commit.

### Task 7 — Validate and bound v1 ingestion (#40, P1)

**Dependencies:** T1. Current v2 protection is useful precedent, not proof that v1 is protected.

**Files:** Create `src/lib/metrics/cloudflare-v1-upload.ts`; modify `cloudflare/do-entry.mjs`, `cloudflare-store.ts`; add handler tests and T1 runtime cases.

**Interface:** `uploadCloudflareV1(request, storage, name): Promise<Response>` authenticates at the existing entry boundary before body reads. Preserve v1 names, 1 MiB compressed cap and 512 KiB latest/4 MiB history expanded caps. Validate existing schemas, ordered timestamps, future tolerance consistent with existing readers, and monotonic last-good replacement. An exact duplicate is idempotent; equal timestamps with different content are rejected.

- [ ] Test oversized streams stop before full consumption; gzip bomb/corruption/invalid schema/replay/future input leave last-good bytes unchanged. Include boundary-valid payloads and token-denied bodies that are never parsed.
- [ ] Bound decompression on every read, including `readCloudflareMetricsJson`, not only upload. Return safe errors without exposing snapshots.
- [ ] Run TS handler/reader tests, Python uploader tests and T1 actual handler checks; commit.

### Task 8 — Commit v1 latest/history together (#41, P2)

**Dependencies:** T7.

**Files:** `ops/frontpage-metrics-upload.py`, its tests, v1 upload helper, `cloudflare-store.ts`, `cloudflare/do-entry.mjs`.

**Interface:** Stage validated pair members by generation/content identity, then atomically advance one active SQL generation. Reads resolve both members from that pointer. Derive pair metadata from a consistent latest/history capture, retrying a bounded capture if local files change; do not stamp unrelated files with the same generation. Stage at most two pending generations/16 MiB, with a 10-minute expiry. Repeated commits are idempotent.

- [ ] Inject loss of second upload/commit response, process restart, mismatched pair identity, replay and concurrent readers. Assert the old complete pair stays visible until both new members validate and commit atomically.
- [ ] Roll out receiver/reader compatibility first, then the uploader. Bootstrap existing legacy rows explicitly, report an already mixed legacy pair honestly, and retire independent replacement only after the new writer is verified. Document downgrade behavior.
- [ ] Run uploader/ingestion/runtime tests and record a synthetic generation round trip; commit.

### Task 9 — Prove owner-state backup and restore (#43, P1)

**Dependencies:** T1, T3; include T4 intents if already shipped.

**Files:** Create operator-only `ops/frontpage-owner-state.mjs`; modify `DEPLOYMENT.md`, the DO entry/state adapter and focused export/import tests as needed.

**Interface:** Versioned export covers exact draft content/base/revisions, receipts and publication intents; integrity checks cover manifest and payloads. Wrangler authentication alone does not provide arbitrary remote DO SQL export. Provide a narrowly scoped maintenance handler on a dedicated operator hostname protected by Cloudflare Access and a distinct maintenance credential; reject it on the public hostname, verify authorization before state access, and disable restore by default. The CLI uses this operator transport and a separate filesystem mode. No anonymously accessible export or secret export is added. Restore validates the entire input before transactional replacement or a new filesystem destination, and requires explicit operator confirmation of the target and backup identity.

- [ ] Rehearse isolated export → fresh destination → readback for both stores. Assert exact content/revisions/receipts, corrupt/unknown-version rejection, truncation/oversize rejection, and no partial restore.
- [ ] Record encryption/access, retention and backup verification procedures; distinguish a Worker code rollback from restoring SQL owner state and an old VPS volume. Rehearsal must not overwrite active owner drafts.
- [ ] Run isolated round-trip tests; retain checksum/schema/version and destination receipts without secret/private draft contents in logs. Commit; close only after the operational rehearsal is recorded.

### Task 10 — Verify the intended release domain (#44, P1)

**Dependencies:** T1, T2; coordinate workflow edits with T11–T13.

**Files:** Create `scripts/verify-release.mjs`; modify CI, `ops/ansible/container-swap.yml`, associated safety tests and `DEPLOYMENT.md`.

**Interface:** `node scripts/verify-release.mjs --base-url <url> --expected-sha <full-sha>` has bounded retries/deadlines and exits nonzero on stale identity or required route failures. Check custom-domain `/api/health`, home/projects/status rendering, anonymous owner API denial and preserved `/proposals`, `/api/proposals`, `/api/agents` forwarding using read-only requests and the documented response contracts. Keep workers.dev checks as additional evidence.

- [ ] Test stale domain with healthy preview, partial routing failure, owner-data leakage and wrong container/rollback VERSION. Rollback validates the captured previous full identity, not the new SHA.
- [ ] Wire exact-domain smoke after deployment and document Worker-version rollback and v2 read-pointer deactivation separately. Keep state migrations backward compatible; never silently run the retired VPS app on Cloudflare-primary.
- [ ] Run runtime/deploy-safety tests; later release evidence must include actual domain smoke and recorded recovery path. Commit.

### Task 11 — Pin the VPS host identity (#49, P1)

**Dependencies:** None. One small security PR; still relevant to retained preload/rollback paths.

**Files:** CI and `DEPLOYMENT.md`; add a focused known-hosts setup test.

**Interface:** Protected `RACKNERD_KNOWN_HOSTS` contains the operator-verified public host key for the endpoint. Load it directly; live `ssh-keyscan` cannot establish trust. Keep `IdentitiesOnly=yes`, `IdentityAgent=none`, strict host checking and deploy-user restrictions.

- [ ] Verify the trusted fingerprint through an independent operator/provider channel before setting configuration. Prove expected key succeeds and a changed key fails before login/image pull; missing pin fails with a name-only error.
- [ ] Document intentional rotation and verify CI uses the pin without logging private key material. Commit. If the retained job is intentionally retired instead, its removal needs an explicit operational decision and scope review.

### Task 12 — Reproduce dependency/tool installation (#48, P2)

**Dependencies:** None; execute early to make later verification reproducible.

**Files:** `package.json`, lockfile, Dockerfile, CI and a small operational requirements/pins file if needed.

**Interface:** One reviewed install contract across CI and Docker; supported `linux/amd64` and `linux/arm64`. Pin Node image digest/version, Ansible core and collection versions. Repair optional native lockfile entries before retaining any workaround; if still necessary, centralize exact platform pins.

- [ ] Record current resolved native dependencies on each architecture, then prove clean `npm ci`/build/standalone/Worker behavior with the new contract. No blanket upgrades or lockfile regeneration from the stale primary checkout.
- [ ] Compare installed versions between CI/Docker and document deliberate update cadence. Run architecture-appropriate native/runtime smoke and Ansible syntax; commit. An emulated check must be labelled as such.

### Task 13 — Validate runtime environment and refresh documentation (#53, P2)

**Dependencies:** None; update after new routes/contracts land as part of their PRs.

**Files:** Create `scripts/check-environment.mjs`, `scripts/current-state.mjs`; modify package scripts, README and DEPLOYMENT. Preserve current untracked `CURRENT_STATE.md` and README WIP.

**Interface:** `check:environment -- --profile public-local|owner-local|cloudflare|collector|rollback` reports missing variable/binding names and profile only. `current-state.mjs --output <new-file>` generates dated branch/full SHA/dirty/worktree/source inventory; CI/live claims appear only when explicitly queried with provenance. Never overwrites the user's current-state note by default.

- [ ] Test missing owner/publication/collector config and a usable public-only setup with no owner secrets. Sentinel secret values must never occur in stdout/stderr/errors.
- [ ] Include runtime-specific commands and the Cloudflare-primary/retained-VPS distinction. Run script tests and review generated evidence; commit.

### Task 14 — Validate mining and truthful freshness (#35, P1)

**Dependencies:** T1 for runtime projection/privacy evidence. External disclosure decision precedes product-policy changes.

**Files:** `src/lib/metrics/v2/mining.ts`, new mining tests, status page and status tests.

**Interface:** Replace unchecked casts with finite/nested validation; use a proposed 5-second fetch deadline and bounded response. Retain upstream timestamp where documented and cache fetch time as a separate observation; if upstream sample time is unknown, say so rather than return `age: 0`. Recommend public coarse activity/freshness only, with worker IDs, wallet details, exact rates/shares/uptime in an independently gated owner model. Confirm the intended public disclosure with the owner before changing it.

- [ ] Test invalid numeric strings, missing/nested fields, invalid/future time, timeout, stale cached response and zero activity. A successful fetch is not automatically a current mining sample.
- [ ] Test the agreed projection in anonymous HTML/serialized payload and owner denial. Preserve private data only where needed; add no new balances/worker identifiers publicly.
- [ ] Run mining/status/runtime tests; commit. Record the disclosure decision alongside engineering evidence.

### Task 15 — Anchor history to the requested current window (#37, P2)

**Dependencies:** None; test both filesystem and Cloudflare readers via T1 before release.

**Files:** v2 `reader.ts`, `types.ts`, `schema.ts`, reader/schema tests, owner charts.

**Interface:** Keep `readSeriesV2(root, query, now)` and anchor `(now - range, now]` to injected now. Align closed slots by existing resolution; never invent a future/open sample. `coverage_percent` becomes available non-null cells / expected closed cells in the requested window; add separately named returned-point completeness and collection lag if useful. Missing slots remain null gaps. Version serialized metadata if old consumers would interpret it differently.

- [ ] Test dense data entirely outside the last hour, no timestamps/all-null values, missing middle/last slots, restart gaps, boundary equality and future rejection. Use existing 1h/24h/7d/30d caps of 240/1,440/10,080/2,880.
- [ ] Ensure empty old data cannot show complete/current coverage; update API/chart labels and compatible schemas together.
- [ ] Run reader/schema/chart tests, Python-projection compatibility and T1 range checks; commit.

### Task 16 — Select and bound query work (#38, P2)

**Dependencies:** T15.

**Files:** v2 reader/types/tests; transport reader if its path shares selection.

**Interface:** Change `filesForQuery(manifest, query, now)` to select only validated dated chunks intersecting T15's window before reads/decompression. Proposed aggregate ceilings: 32 chunks and 32 MiB decoded per query; stop before an over-budget read and return existing safe `too_large` behavior. Preserve path/symlink/schema and output limits. The same selection semantics apply to stored Cloudflare manifests.

- [ ] Assert a 24h query crossing UTC midnight reads only its intersecting daily chunks, 30d uses quarter-hour chunks, unrelated retention is untouched, and over-budget manifests fail boundedly.
- [ ] Measure synthetic maximum-retention before/after file/decompression counts, bytes and latency; do not add caching without evidence. Confirm caps accommodate legitimate generated fixtures before enabling them.
- [ ] Run reader/transport tests and the benchmark; commit with measured results.

### Task 17 — Refresh the entire owner dashboard (#39, P2)

**Dependencies:** T1; integrate T15 metadata without anchoring UI to initial props.

**Files:** Add authenticated `src/app/api/owner/latest/route.ts` plus tests; modify existing metrics/incidents routes only as needed; `OwnerObservabilityPanel.tsx`, poller/hook/tests and owner browser tests.

**Interface:** Latest endpoint returns `readOwnerLatestV2` under independent owner auth with private/no-store responses. Poll latest, incidents and selected series on existing 15-second cadence, proposed 10-second request deadlines, visibility/offline pauses and a shared auth-expired signal. Reconcile timestamps; different sample times remain visible rather than pretending atomic collection. Responses carry a range/request generation to reject late updates.

- [ ] Change totals/workloads/incidents/capabilities fixtures without reload; prove timeout → recovery, range A returning after range B, hiding/offline pause and selected incident disappearing safely.
- [ ] On 401/403 stop every refresh path and clear exact cached owner telemetry; never retain private values indefinitely in initial props after auth expiry.
- [ ] Run polling/component/route and real browser tests; commit.

### Task 18 — Enforce one collector writer across processes (#47, P2)

**Dependencies:** None for development; coordinate installation with T19's evidence window.

**Files:** `ops/frontpage_metrics_v2/store.py`, active/shadow units, store/deploy tests and operations documentation.

**Interface:** Acquire nonblocking `fcntl.flock` on a stable lock file beside the canonical database path for the lifetime of writer `MetricsStore.open`; readers/backups do not take writer ownership. Keep the lock inode instead of unlinking/replacing it, and avoid descriptor inheritance. Resolve path aliases consistently. Add unit mutual exclusion without deleting history.

- [ ] Spawn two actual processes: second writer must fail; after clean exit/SIGKILL a new writer succeeds; readonly/SQLite backup remains usable. Include symlink/path aliases and failed initialization cleanup.
- [ ] Run Python store/unit/deploy tests. Develop synthetically while current collection continues; install only through an explicit reviewed maintenance step that accounts for any evidence interruption.
- [ ] Record unchanged history/isolation and applicable new gate requirements; commit.

### Task 19 — Reconcile shipped collector work and finish acceptance (#46 P1; #45 P3)

**Dependencies:** Existing PRs #56–#60 provide the implementation. T1 supplies actual runtime proof; T7 addresses outstanding v1 ingestion safety; T15–T16 bound v2 query work. Keep new host changes out of the existing acceptance lane unless necessary.

**Files:** Existing activation runbook, comparator/collector tests and exact source/deployment receipts; update issues only during separately authorized execution.

**Interface:** Reuse installed schema-3 comparator and `--v2` uploader/activation from `docs/cloudflare-v2-activation.md`. Do not create another transport, timer or evidence epoch. #46's synthetic alignment is already implemented; its real continuous-window target remains open. #45's prototype is implemented; runtime parity, costs/isolation and activation evidence still need reconciliation.

- [ ] Map #46's targets to PR #56 and follow-ups #57/#58/#60, and #45's targets to #59 and its runbook. Preserve genuine mismatch/unknown records; the cached gate read in this plan is insufficient.
- [ ] Obtain a newly generated installed gate only when executing acceptance; require every unchanged threshold. Record source/unit hashes, epoch, active services and fresh completeness. A legitimate later collector change must have its own documented evidence requirements.
- [ ] Run actual-runtime parity/redaction/range checks and measure transport/read budgets. Once accepted, follow the existing operator installation/upload/activation steps, binding the receipt to the exact live SHA and fresh snapshot. Coordinate with the existing owner of that work.
- [ ] Verify sustained repeated public freshness/redaction, anonymous denial and authenticated latest/series/incidents, observer isolation and v1 fallback; rehearse read-pointer deactivation on an isolated candidate. Record which issue target is complete without equating design completion to production activation. Close each only when all of its own targets have evidence.

### Task 20 — Validate gallery input and associate errors (#29, P2)

**Dependencies:** None; integrate T3's revision responses.

**Files:** `ProjectEditor.tsx`, `EditorFields.tsx`, content schema/tests and owner browser tests.

**Interface:** Parse gallery JSON through the actual array/item schema before constructing the candidate. `{}`, `null`, scalar text/numbers are invalid; an explicit empty array is a deliberate clear. Preserve existing maximum eight items. Field error IDs connect input and message with `aria-invalid`/`aria-describedby`.

- [ ] Invalid container/entries keep entered text, prevent save and focus the first invalid field; valid empty gallery and eight valid entries remain usable.
- [ ] Run schema/editor keyboard/axe browser checks; commit.

### Task 21 — Preserve unsaved edits through navigation/failures (#54, P2)

**Dependencies:** None; integrate T3's conflict behavior without losing text.

**Files:** `useUnsavedChanges.ts`, both editors and owner browser tests.

**Interface:** One documented guard contract for replacing links, owner-controlled router calls, history/back and beforeunload. Non-replacing `_blank`/modifier clicks do not prompt. Use supported router/browser mechanisms; where browsers cannot guarantee interception, keep editor state in the mounted session and clearly document the tested limitation. No private drafts in localStorage/service workers.

- [ ] Use actual browser Back/Forward and app navigation tests: cancelling departure retains edits; accepting proceeds. Test new-tab clicks, offline save/discard, rejected fetch, 409, double click and busy-state recovery.
- [ ] Catch network failures consistently and announce actionable errors. Run owner browser tests; commit.

### Task 22 — Render evidence references and review age (#32, P2)

**Dependencies:** None; provides presentation for T23 and T28.

**Files:** detail route, `src/lib/projects/presentation.ts` and tests, content schema/tests, cards as appropriate.

**Interface:** Render stored URL/commit as explicit evidence links with existing source/CI/live scope. Show deterministic review age in elapsed days using injected now; future/invalid dates yield unknown/invalid review metadata, not negative age. Avoid an arbitrary automatic verification-expiry cutoff; any later threshold is an editorial policy decision.

- [ ] Test absent references, shortened commit display without invented full commit URLs, invalid/future dates and old evidence. Changes in age must not change lifecycle/maturity/health or evidence level.
- [ ] Run presentation/schema/route/browser checks; commit.

### Task 23 — Share complete detail presentation with private preview (#31, P2)

**Dependencies:** T20; land T22 first to avoid duplicate evidence rendering.

**Files:** Create `ProjectDetailContent.tsx`; modify detail route, editor/owner preview, `ProjectMedia.tsx`, presentation and owner/public browser tests.

**Interface:** Shared pure presentation consumes validated `ProjectContent`; callers decide canonical versus owner candidate and authorization. Preview includes sections, limitations, evidence and cover/gallery. Render at most the existing eight approved gallery items with alt/caption, responsive layout and keyboard-accessible links; no upload/lightbox framework is needed.

- [ ] Assert saved candidate preview and canonical page have equivalent content features, absent media is text-first and no preview data appears in anonymous HTML/serialized responses. Mobile/keyboard/axe tests include the gallery.
- [ ] Run presentation and both browser suites; commit.

### Task 24 — Preserve slug history (#33, P2)

**Dependencies:** T3 and T5 are execution additions: renamed drafts must participate in safe reviewed publication.

**Files:** content schema/parser/tests, `ProjectEditor.tsx`, detail route, sitemap/metadata and publication diff.

**Interface:** Add optional per-project `aliases: string[]` with a proposed cap of 32 historical slugs. On canonical rename retain the previous slug and flatten aliases to the current record. `resolveProjectSlug(slug, projects)` returns current/redirect/not-found; permanent redirects point directly to the canonical URL. Validate all canonical/alias names globally for collisions, self-aliases and cycles. Keep aliases inside the existing two-file publication contract.

- [ ] Test repeated rename, alias/canonical collision, conflicting drafts, unknown slug 404, preserved archived URLs and exactly one canonical sitemap/metadata URL per project.
- [ ] Seed only actual known published slugs; never invent history. Run schema/publication/route/browser checks; commit.

### Task 25 — Add create/archive catalogue actions (#34, P3)

**Dependencies:** T3, T5, T24 (matches #26/#30/#33 dependency chain).

**Files:** workspace list/editor, content admin-view/schema/tests, owner UI tests; add new-project page only if the existing workspace cannot host the form cleanly.

**Interface:** Owner create builds the minimum valid candidate, requires unique slug and honest evidence fields, and saves through T3. Archive changes lifecycle only, preserving aliases/evidence/current URLs. Clearly confirm that project draft discard affects the entire projects bundle; no delete path is added.

- [ ] Test valid create → save → preview → reviewed diff, duplicate slug, stale bundle, archive preserving other fields and explicit whole-bundle discard scope. Unauthorized API writes remain denied.
- [ ] Run content/routes/owner browser checks; commit. Do not fabricate curated project facts to fill defaults.

### Task 26 — Normalize GitHub references and coalesce stats (#36, P2)

**Dependencies:** None.

**Files:** `github-stats.ts`/tests, stats API/tests, coverage script/tests; create one shared JS-compatible parser only if needed by both Node tooling and TS app.

**Interface:** `normalizeGitHubRepository(value: string): { owner: string; repo: string; key: string } | null` accepts exact HTTPS github.com repo URLs (optional terminal `.git` and slash) and deliberate owner/repo references, normalizes comparison keys, and rejects lookalike hosts/extra routes. In-flight map is per key; settle/delete it on success/failure, preserving current five-minute settled cache semantics.

- [ ] Test case/trailing slash/`.git`, evil host/embedded URL, concurrent misses making one fetch pair, rejection followed by successful retry and safe bounded provider error categories.
- [ ] Run stats/API/coverage tests and check optional stats failure leaves project posture unchanged; commit.

### Task 27 — Expose one approved public status feed (#51, P3)

**Dependencies:** No original blocker; use validated public projection from T1/T7/T19 where available. Never depend on owner data.

**Files:** Add `src/app/status/feed.json/route.ts` and tests; reuse public incident/status projection and maintenance schema.

**Interface:** One bounded JSON Feed format, maximum 256 approved public incident/maintenance summaries; stable event ID and genuine source update times. Missing/invalid source produces an explicit unavailable response with safe freshness metadata, not a fabricated empty healthy feed. Document v1 behavior while v2 remains disabled.

- [ ] Assert stable deduplication, bounded output, escaping and no owner identifiers, host numbers, evidence payloads or private incidents in anonymous responses. Feed readers must distinguish actual zero events from unavailable data.
- [ ] Run projection/feed/runtime tests; commit. No email/subscriber system.

### Task 28 — Pilot a curated project timeline (#52, P3)

**Dependencies:** T22; integrate T5/T23 for diff/preview coverage.

**Files:** content schema/parser/tests, detail presentation/editor support and `content/projects.json` for one reviewed pilot.

**Interface:** Optional `milestones` list with a proposed maximum 20 entries, stable ID, occurrence date, source/CI/live scope and reviewed evidence reference. Use Frontpage as the proposed pilot, drawing only from verified receipts; retain prior entries, separate milestone occurrence from review date, and omit the section for empty data.

- [ ] Test ordering/stable IDs, optional empty state, invalid dates/links, no automatic verification from commits and value-level diff/preview parity. Proposed pilot content gets owner editorial review before publication.
- [ ] Run schema/presentation/browser checks; record owner usefulness review before broader rollout; commit.

### Task 29 — Measure singleton DO headroom (#55, P3)

**Dependencies:** T1; perform after T16 so measurements reflect bounded reads. Baseline before/after individual earlier changes can be recorded cheaply.

**Files:** Add bounded `scripts/measure-cloudflare-headroom.mjs` and evidence documentation; avoid app redesign in this task.

**Interface:** Isolated deployed candidate with synthetic owner/collector data. Proposed initial workload: concurrency 1/2/4, 60 s per stage, total ceiling 2,000 requests; mix 80% public, 15% owner reads, 5% collector/owner writes. Report exact SHA, warm/cold behavior, request counts, p50/p95/p99, errors, Worker versus DO CPU, storage/decompression and observed account Free budgets. Confirm current account limits before dispatch; no production load or paid fallback.

- [ ] Verify mixed public traffic cannot silently starve writes: record write deadline failures rather than averaging them away. Use proposed headroom target p95 public <1 s, p95 owner <2 s and valid writes <5 s, with zero integrity/privacy failures; these are candidate measurement targets, not promises or existing SLOs.
- [ ] Save reproducible measurement parameters and a keep/change decision. Local emulation does not establish provider CPU/quota fit. Retain current singleton architecture if headroom is adequate; any redesign is separately scoped.
- [ ] Run bounded isolated measurement and correctness checks; commit evidence/tooling. Close on measured decision, not on adding a benchmark script alone.

## Verification and PR discipline

For every implementation task: first reproduce the named failure in a focused regression where appropriate; implement the smallest change; run that task's checks; review; commit and publish one focused PR. Small docs/pin changes need their actual validation, not tests that merely mirror their text. New runtime/interfaces require failure tests.

Baseline code gates, executed in the current isolated source checkout:

```sh
df -h /System/Volumes/Data
npm test
npm run lint
npx tsc --noEmit
python3 -m unittest discover -s ops/tests
AUTH_SECRET=dev-secret npm run build
npm run test:e2e
npm run build:cloudflare
npm run test:cloudflare
```

Use the CI environment contract and exact pinned tools for Worker/build credentials; do not print values. Syntax-check affected Ansible playbooks with the existing vault configuration. Docker/architecture changes also need existing runtime smoke. T1 adds the last command. Do not claim all commands ran in this planning session.

After a merge, require fresh exact-main CI, intended-domain identity and applicable public/owner/proxy browser/API checks. UI fixes need visible interaction evidence. Metrics activation needs operator and sustained real-data evidence beyond synthetic CI. Backup restore and owner disclosure/editorial review remain explicit gates.

Each issue receives, during authorized execution, a concise closure record: implementing PR/full SHA; target-by-target evidence; runtime tested; operational/human gates; any explicit exception. Use `Refs #N` until all targets are met to avoid premature auto-closure. Do not close #43 on unit tests alone, #46 on synthetic alignment, #45 on code presence, #52 before the pilot review, or #55 on an unmeasured benchmark tool.

## Complete issue coverage

| Issue | Priority | Owning task | Required closure evidence |
|---|---|---|---|
| [#26](https://github.com/Reedtrullz/Frontpage/issues/26) | P1 | T3 | Filesystem/SQL revision races, two tabs, conditional cleanup |
| [#27](https://github.com/Reedtrullz/Frontpage/issues/27) | P1 | T4 | Post-commit failure/lost-response recovery without duplicate commit |
| [#28](https://github.com/Reedtrullz/Frontpage/issues/28) | P1 | T2 | Full write identity and safe deployment-format regressions |
| [#29](https://github.com/Reedtrullz/Frontpage/issues/29) | P2 | T20 | Invalid gallery retained, field linkage and focus |
| [#30](https://github.com/Reedtrullz/Frontpage/issues/30) | P2 | T5 | Value-level diff and revision-bound confirmation |
| [#31](https://github.com/Reedtrullz/Frontpage/issues/31) | P2 | T23 | Complete private preview, approved gallery, anonymous isolation |
| [#32](https://github.com/Reedtrullz/Frontpage/issues/32) | P2 | T22 | Reachable evidence references and deterministic independent review age |
| [#33](https://github.com/Reedtrullz/Frontpage/issues/33) | P2 | T24 | Old URL redirect, collision validation and canonical sitemap |
| [#34](https://github.com/Reedtrullz/Frontpage/issues/34) | P3 | T25 | Safe create/archive and explicit bundle discard |
| [#35](https://github.com/Reedtrullz/Frontpage/issues/35) | P1 | T14 | Validated deadlines/freshness and owner-agreed public projection |
| [#36](https://github.com/Reedtrullz/Frontpage/issues/36) | P2 | T26 | Unified parser, in-flight deduplication and sanitized optional failures |
| [#37](https://github.com/Reedtrullz/Frontpage/issues/37) | P2 | T15 | Current-window gaps/coverage for all four ranges |
| [#38](https://github.com/Reedtrullz/Frontpage/issues/38) | P2 | T16 | Relevant reads, aggregate caps and measured cost changes |
| [#39](https://github.com/Reedtrullz/Frontpage/issues/39) | P2 | T17 | All panels refresh, timeouts/range races/auth expiry |
| [#40](https://github.com/Reedtrullz/Frontpage/issues/40) | P1 | T7 | Actual-handler streaming/schema/replay/decompression limits |
| [#41](https://github.com/Reedtrullz/Frontpage/issues/41) | P2 | T8 | Atomic v1 generation under interruption/retry/read races |
| [#42](https://github.com/Reedtrullz/Frontpage/issues/42) | P1 | T1 | Real DO/proxy/restart/isolation CI gate |
| [#43](https://github.com/Reedtrullz/Frontpage/issues/43) | P1 | T9 | Isolated operator restore round trips and rollback-state contract |
| [#44](https://github.com/Reedtrullz/Frontpage/issues/44) | P1 | T10 | Exact intended-domain/container identity, critical routes and recovery |
| [#45](https://github.com/Reedtrullz/Frontpage/issues/45) | P3 | T19 | Reconcile shipped transport, actual parity/budgets/isolation and explicit gate |
| [#46](https://github.com/Reedtrullz/Frontpage/issues/46) | P1 | T19 | Reconcile repaired sampling plus real unchanged continuous acceptance |
| [#47](https://github.com/Reedtrullz/Frontpage/issues/47) | P2 | T18 | Separate-process exclusion/crash release and readonly access |
| [#48](https://github.com/Reedtrullz/Frontpage/issues/48) | P2 | T12 | Clean architecture installs and CI/Docker/tool parity |
| [#49](https://github.com/Reedtrullz/Frontpage/issues/49) | P1 | T11 | Independently verified pinned host key and wrong-key rejection |
| [#50](https://github.com/Reedtrullz/Frontpage/issues/50) | P2 | T6 | Actual cookie/origin/bounded-body/auth/storage-failure controls |
| [#51](https://github.com/Reedtrullz/Frontpage/issues/51) | P3 | T27 | Stable public-only feed and honest unavailable behavior |
| [#52](https://github.com/Reedtrullz/Frontpage/issues/52) | P3 | T28 | Curated optional pilot preserving evidence plus usefulness review |
| [#53](https://github.com/Reedtrullz/Frontpage/issues/53) | P2 | T13 | Name-only runtime preflight and reproducible dated source inventory |
| [#54](https://github.com/Reedtrullz/Frontpage/issues/54) | P2 | T21 | Real history/navigation and offline editor preservation |
| [#55](https://github.com/Reedtrullz/Frontpage/issues/55) | P3 | T29 | Isolated mixed-workload measurement and keep/change decision |

## Execution recommendation

Start with T1 (#42) and T2 (#28), then T3 (#26). Run a small independent operations stream for #49/#48/#53. Complete draft safety and metrics integrity before optional product additions. Use native implementation with focused independent reviews of owner persistence/publication, ingress/storage and release boundaries; introduce parallel implementers only when their files/interfaces do not overlap and current routing policy permits it.

Expected effort is driven by runtime harness integration, publication recovery and real operational gates. Do not commit to a calendar for all 30 issues before T1–T4 expose the actual integration cost. Continuous shadow time and owner/operator review are external acceptance time, not coding time.

## Plan self-review

- All 30 snapshot issues map exactly once to an owning task; original dependency chains are preserved, with additional safety dependencies stated.
- The five review-focus conditions are assigned to explicit tests/checks. Shared revision, identity, range and generation contracts are defined before consumers.
- Shipped #45/#46 work is reused. Current acceptance, source/CI proof, cached gate observations and live identity remain distinct.
- File names were checked against current remote source; new files are labelled. WIP is preserved. No application changes, issue writes or production mutation occurred in this planning session.
