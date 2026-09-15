# Post-Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the next Frontpage release safer and faster to deploy, make catalogue search and current-work navigation coherent across projects and repositories, promote Bunkerkartet into canonical content, remove public media placeholders, and add bounded repository-coverage automation.

**Architecture:** Keep the existing Next.js content and presentation boundaries. Add a small Python stdlib normalizer for the VPS shadow projection tree and use it from the existing Ansible playbook; render and validate both new-container and rollback facts before stop, then wrap the swap/runtime-map/health sequence in rescue so every post-stop failure restores the previous container and collector mode. Treat catalogue results as a project list plus repository-only records with explicit project-filter semantics rather than duplicating records.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright, Python 3 stdlib/unittest, Ansible, GitHub Actions.

**Spec:** User-approved six post-release recommendations and coordinator addendum in the task prompt.

## Global Constraints

- Base branch is current `origin/main` at `190094899b55b721697b269b9d7dda8ff2534018`.
- Use Node 22 and preserve immutable canonical content, auth boundaries, metrics isolation, rollback identity, and CI/deploy fail-closed behavior.
- Do not mutate the VPS, merge, or deploy this batch.
- Repository-only records satisfy query-only searches; lifecycle, maturity, category, and health filters exclude records without project metadata.
- Bunkerkartet content must be source-reviewed and must not overclaim field verification, access permission, or runtime health.
- No invented media and no automatic content publication/modification from coverage automation.

### Task 1: Harden deployment normalization and rollback

**Files:**
- Create: `ops/normalize-shadow-projections.py`
- Create: `ops/tests/test_normalize_shadow_projections.py`
- Modify: `ansible-playbook.yml:44-150, 587-615, 808-1121`
- Modify: `ops/tests/test_frontpage_metrics_runtime_map.py`
- Create: `ops/tests/test_frontpage_deploy_safety.py`

**Interfaces:**
- `normalize-shadow-projections.py` exposes `normalize_roots(roots, owner_uid, group_gid, max_entries=4096)` and a CLI accepting two roots plus numeric owner/group IDs.
- The Ansible playbook runs the normalizer once on the host, validates typed identity/mode/rollback facts before stop, and restores the previous image/mount/env/collector mode from an Ansible `rescue` block after any post-stop failure.

- [ ] Write failing stdlib tests for exact `2750` directories, `0640` regular files, exact uid/gid, absent roots, symlink skipping, max-entry bound, and second-run idempotence.
- [ ] Run `python3 -m unittest ops.tests.test_normalize_shadow_projections` and confirm the new behavior fails before implementation.
- [ ] Implement the bounded `os.fwalk`/`O_NOFOLLOW` normalizer with no shell globbing or symlink traversal.
- [ ] Run the focused normalizer tests and confirm they pass.
- [ ] Write a mocked container/task failure-path test proving stop → start failure → previous image restoration → health check, plus a playbook contract test for preflight-before-stop and rescue coverage.
- [ ] Run the focused deployment-safety tests and confirm they fail before the playbook change.
- [ ] Refactor the playbook to render shared new/rollback env, volume, group, image, and mode facts before stop; assert previous image/version, owner/group IDs, typed booleans, image availability, read-only mounts, and rollback inputs.
- [ ] Replace per-file Ansible loops with the one bounded host-side normalizer, retain absent-path/idempotence behavior, and keep collector continuity actions unchanged.
- [ ] Wrap stop, start, active runtime-map rebinding, health polling, and failure handling in a rescue path that restores the previous container and prior v1/v2 mount/auth/service mode.
- [ ] Run the focused deployment tests, Python unittest suite, and Ansible syntax check.

### Task 2: Make project/repository search one coherent result set

**Files:**
- Modify: `src/lib/projects/presentation.ts`
- Modify: `src/lib/projects/presentation.test.ts`
- Modify: `src/components/projects/ProjectList.tsx`
- Modify: `tests/e2e/public-ui.spec.ts`

**Interfaces:**
- Add `ProjectLifecycleFilter = ProjectLifecycle | "all" | "current"` and make `current` mean active or maintained.
- Add repository filtering that matches name, description, repository URL, homepage URL, and upstream fields.
- Project-only filters exclude repository-only records; query-only and unfiltered views include matching repository-only records and retain fork/upstream labels.

- [ ] Write failing unit tests for query-only repository match, no-match empty state, reset behavior, mixed project/repository matches, fork distinction, and `current` active/maintained filtering.
- [ ] Run the focused presentation tests and confirm failure.
- [ ] Implement combined filtering/count derivation with no new state or dependency.
- [ ] Render accurate project/repository result counts and a single empty state only when both result sets are empty; preserve accessible external repository links.
- [ ] Run unit tests and update browser assertions for counts, query results, reset, filter semantics, and mobile overflow.

### Task 3: Promote Bunkerkartet to canonical project content

**Files:**
- Modify: `content/projects.json`
- Modify: `content/repositories.json`
- Modify: `src/lib/repository-coverage.test.ts`
- Modify: `tests/e2e/public-ui.spec.ts`

**Interfaces:**
- Add one canonical `bunkerkartet` project record with `repoUrl`, `liveUrl`, source-reviewed evidence, and conservative sections/limitations.
- Remove the duplicate repository-only entry while retaining all five fork records and full remote coverage.

- [ ] Add failing content/coverage assertions for the canonical project, live product link, no duplicate repository URL, and five remaining repository-only records.
- [ ] Run the focused tests and confirm failure.
- [ ] Add the README-grounded record using source timestamp/commit evidence and no field-access or health overclaim.
- [ ] Run content and coverage tests plus `npm run check:repositories`.
- [ ] Add browser coverage for the Bunkerkartet project card/detail and repository count.

### Task 4: Remove public editorial no-media notices

**Files:**
- Modify: `src/components/dashboard/FlagshipProjectCard.tsx`
- Modify: `src/components/projects/ProjectCard.tsx`
- Modify: `src/components/ui/ProjectMedia.tsx`
- Modify: `tests/e2e/public-ui.spec.ts`

**Interfaces:**
- Media-less public cards render text-first content without “No approved media” or “Media not published” editorial copy; detail pages remain unchanged and continue omitting absent media.

- [ ] Update browser tests to assert media-less cards remain usable and editorial notices are absent.
- [ ] Run the focused browser test and confirm failure.
- [ ] Remove the unused public placeholder component and render media only when approved media exists.
- [ ] Run unit/lint/type checks and browser accessibility/overflow checks.

### Task 5: Add bounded scheduled repository coverage detection

**Files:**
- Modify: `scripts/check-repository-coverage.mjs`
- Modify: `src/lib/repository-coverage.test.ts`
- Create: `.github/workflows/repository-coverage.yml`

**Interfaces:**
- Coverage fetches have a timeout and finite page limit, validate every remote record shape, return exit `1` for missing records and exit `2` for API/validation/limit failures.
- The workflow runs on manual dispatch and a weekly schedule, reports only the normal Actions result, and never edits curated content or opens notifications/issues.

- [ ] Write failing offline tests for malformed API records, timeout/fetch failure, and page-bound exhaustion.
- [ ] Run the focused tests and confirm failure.
- [ ] Implement bounded fetch and response validation using native `AbortSignal.timeout` and a finite page cap.
- [ ] Add the minimal workflow with Node 22, read-only contents permission, manual dispatch, weekly schedule, and a five-minute job timeout.
- [ ] Run offline tests and the CLI against the current public inventory.

### Task 6: Bound current-work rendering and matching catalogue link

**Files:**
- Modify: `src/components/dashboard/ProjectDashboard.tsx`
- Modify: `tests/e2e/public-ui.spec.ts`

**Interfaces:**
- Render at most six current projects, show the total current count, and link to `/projects?lifecycle=current` so active and maintained selection matches the homepage.

- [ ] Add failing browser assertions for six-row maximum, total count, matching link, and mobile overflow.
- [ ] Implement `current.slice(0, 6)` and the existing semantic link/button patterns.
- [ ] Run browser checks at desktop and mobile widths.

### Task 7: Full verification and evidence log

**Files:**
- Modify: `docs/superpowers/plans/2026-09-15-post-release-hardening.md`
- Append: `/Users/reidar/Obsidian/Hermes/Hermes/Daily/15-09-2026.md`
- Append: `/Users/reidar/Obsidian/Hermes/Hermes/Personal/Projects/Frontpage/Frontpage.md`

- [ ] Run disk guard, dependency audit, Vitest, lint, TypeScript, production build, Python unittest/compileall, Ansible syntax check, repository coverage CLI, Docker smoke if available, and Playwright desktop/mobile/accessibility checks.
- [ ] Inspect `git diff --check`, worktree status, exact branch/commit, and confirm no deploy/merge occurred.
- [ ] Log exact evidence, known limitations, and no-deploy boundary in Obsidian without secrets.

