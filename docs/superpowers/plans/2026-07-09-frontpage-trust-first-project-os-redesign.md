# Frontpage Trust-First Project OS Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Frontpage's stale runtime-content override and incomplete dashboard UI with a trust-first public Project OS plus a precise owner content and operations workspace.

**Architecture:** Published public content is validated JSON bundled into the image; the persistent volume stores owner drafts and publication receipts only. Project lifecycle, maturity, derived health, evidence, and optional repository activity are separate domain concepts. Public pages consume canonical content and public-safe metrics, while owner pages receive exact metrics and draft/publication state only after server-side authorization.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Auth.js v5, Zod 4, Vitest 4, Lucide React, Python metrics collector, Ansible, Playwright, axe-core.

## Global Constraints

- Node.js 22 is required for all JavaScript verification.
- Public pages never read mutable draft files.
- Public pages never receive exact host, internal-service, container, diagnostic, owner, auth, or secret values.
- Owner routes fail closed through both route protection and server-side owner checks.
- Runtime `/data` stores drafts and receipts only.
- Publish is an explicit owner-confirmed GitHub mutation to `main`; it never deploys automatically.
- No shell, SSH, Docker socket, command execution, restart, prune, or deploy controls are added to the web app.
- Lifecycle, maturity, health, evidence, and repository activity remain separate types and components.
- Status must never be conveyed by color alone.
- Normal text must meet WCAG 2.2 AA contrast.
- Public primary touch targets target at least 44px.
- Cards use an 8px maximum radius and are not nested inside cards.
- Project media must be real product imagery; missing media uses an explicit media-less layout.
- Each behavior change follows red-green-refactor and ends with focused plus full verification.

---

## File Structure

### Canonical content and domain

- Create `content/personal.json`: canonical published personal content.
- Create `content/projects.json`: canonical published project content and posture.
- Create `src/lib/content/schema.ts`: Zod schemas and exported content types.
- Create `src/lib/content/index.ts`: immutable canonical-content accessors.
- Create `src/lib/content/drafts.ts`: draft envelopes, receipts, persistence, and state derivation.
- Create `src/lib/content/publication.ts`: atomic GitHub publication and conflict result types.
- Replace `src/data/personal.ts` and `src/data/projects.ts` with compatibility type/data exports from canonical content.
- Replace `src/lib/data.ts` with canonical reads plus draft compatibility writes.

### Shared UI

- Create `src/components/ui/PostureBadge.tsx`: lifecycle, maturity, health, evidence badges.
- Create `src/components/ui/RelativeTime.tsx`: semantic relative and exact timestamps.
- Create `src/components/ui/ProjectMedia.tsx`: stable real-media rendering.
- Create `src/components/layout/HeaderClient.tsx`: active public navigation and responsive owner menu.
- Create `src/app/actions/auth.ts`: sign-out server action.
- Modify `src/components/layout/Header.tsx`, `Footer.tsx`, `src/app/layout.tsx`, and `globals.css`.
- Create `src/app/signin/page.tsx`, `src/app/not-found.tsx`, and `src/app/opengraph-image.tsx`.

### Public pages

- Create `src/components/dashboard/PublicStatusBand.tsx`.
- Create `src/components/dashboard/FlagshipProjectCard.tsx`.
- Create `src/components/dashboard/CoarseHistoryStrip.tsx`.
- Rewrite homepage, project catalogue, project detail, and status components.
- Add approved project media under `public/projects/<slug>/`.

### Owner pages

- Create `src/components/admin/ContentStateSummary.tsx`.
- Create `src/components/admin/ProjectEditor.tsx`.
- Create `src/components/admin/PersonalEditor.tsx`.
- Create `src/components/admin/PublishPanel.tsx`.
- Add `/admin/personal`, `/admin/projects`, `/admin/projects/[slug]`, and `/api/data/publish`.
- Rewrite `/admin`, admin layout, and `/ansible`.
- Create `src/components/admin/CopyCommand.tsx`.

### Verification

- Add focused content, draft, publication-state, posture, and status unit tests.
- Create `playwright.config.ts` and `tests/e2e/public-ui.spec.ts`.
- Update package scripts and CI with a public browser/accessibility job.

---

### Task 1: Canonical Content And Project Posture

**Files:**
- Create: `content/personal.json`
- Create: `content/projects.json`
- Create: `src/lib/content/schema.ts`
- Create: `src/lib/content/index.ts`
- Create: `src/lib/content/schema.test.ts`
- Modify: `src/data/personal.ts`
- Modify: `src/data/projects.ts`
- Modify: `src/lib/data.ts`
- Modify: `src/lib/data.test.ts`

**Interfaces:**
- Produces: `PersonalContent`, `ProjectContent`, `ProjectLifecycle`, `ProjectMaturity`, `ProjectEvidence`, `getCanonicalPersonal()`, `getCanonicalProjects()`, `getCanonicalProject(slug)`.
- Preserves: `getPersonal()`, `getProjects()`, `getProject()` compatibility exports for existing consumers.

- [ ] **Step 1: Write failing canonical-schema and data-authority tests**

```ts
it("rejects duplicate project slugs", () => {
  const duplicate = [validProject, { ...validProject, name: "Second" }];
  expect(() => parseProjects(duplicate)).toThrow(/duplicate slug/i);
});

it("keeps published projects canonical when draft-shaped runtime files exist", async () => {
  const { getProjects } = await importDataModule(runtimeDir);
  fs.writeFileSync(path.join(runtimeDir, "projects.json"), "[]");
  expect(getProjects().length).toBe(13);
});
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `npm test -- src/lib/content/schema.test.ts src/lib/data.test.ts`

Expected: failures because canonical schemas/accessors do not exist and runtime data still overrides projects.

- [ ] **Step 3: Add canonical schemas and migrated JSON content**

Implement exact enums:

```ts
export const lifecycleSchema = z.enum(["active", "maintained", "paused", "archived"]);
export const maturitySchema = z.enum(["flagship", "stable", "experimental", "reference"]);
export const evidenceLevelSchema = z.enum(["source-reviewed", "ci-verified", "live-verified"]);
```

Validate URL-safe unique slugs, HTTP/HTTPS URLs, evidence timestamps, structured sections, media metadata, and unique project names/slugs.

Migrate all 13 source projects. Nytt, RFS, RFMC, and Heimdall are flagships. THORArb, thor-maya-swap, Harmony Sync, and codex-antigravity-auth are experimental. THORNode Watcher is reference/archived. Preserve conservative limitations.

- [ ] **Step 4: Replace public runtime overrides with canonical accessors**

```ts
export function getPersonal(): PersonalContent {
  return getCanonicalPersonal();
}

export function getProjects(): ProjectContent[] {
  return getCanonicalProjects();
}
```

Keep draft writes out of these public accessors.

- [ ] **Step 5: Run focused and full tests**

Run: `npm test -- src/lib/content/schema.test.ts src/lib/data.test.ts && npm test`

Expected: focused tests and all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add content src/lib/content src/data src/lib/data.ts src/lib/data.test.ts
git commit -m "feat: make canonical content authoritative"
```

### Task 2: Draft And Publication State

**Files:**
- Create: `src/lib/content/drafts.ts`
- Create: `src/lib/content/drafts.test.ts`
- Create: `src/lib/content/publication.ts`
- Create: `src/lib/content/publication.test.ts`
- Modify: `src/lib/github.ts`
- Modify: `src/app/api/data/personal/route.ts`
- Modify: `src/app/api/data/projects/route.ts`
- Create: `src/app/api/data/publish/route.ts`
- Modify: `src/app/api/data/route.ts`

**Interfaces:**
- Consumes: canonical schemas and content accessors from Task 1.
- Produces: `DraftEnvelope<T>`, `PublishReceipt`, `ContentPublicationState`, `savePersonalDraft()`, `saveProjectsDraft()`, `readDraftBundle()`, `derivePublicationState()`, `publishCanonicalContent()`.

- [ ] **Step 1: Write failing draft-state tests**

```ts
it("distinguishes draft saved from deployed", () => {
  expect(derivePublicationState({ draftChanged: true, receipt: null, deployedVersion: "abc" }))
    .toEqual({ kind: "draft-saved", label: "Draft saved" });
});

it("preserves a draft when publication conflicts", async () => {
  const result = await publishCanonicalContent(input, fakeClientWithHead("new-head"));
  expect(result.kind).toBe("conflict");
  expect(readDraftBundle(dir).projects).not.toBeNull();
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- src/lib/content/drafts.test.ts src/lib/content/publication.test.ts`

Expected: missing-module failures.

- [ ] **Step 3: Implement atomic draft envelopes and receipts**

Draft envelope:

```ts
interface DraftEnvelope<T> {
  schemaVersion: 1;
  baseVersion: string;
  savedAt: string;
  content: T;
}
```

Write through temporary files plus rename. Validate before every write. Store receipts separately from drafts.

- [ ] **Step 4: Implement atomic Git publication**

Use GitHub Git Data APIs to create blobs, one tree, one commit, and one non-force ref update on `heads/main`. Compare the supplied base version with the current head before creating the commit. Return `published`, `conflict`, or `failed` with sanitized messages.

- [ ] **Step 5: Convert PUT APIs to draft-only saves and add publish API**

PUT responses:

```json
{ "ok": true, "state": "draft-saved", "savedAt": "2026-07-09T19:00:00Z" }
```

Publish response:

```json
{ "ok": true, "state": "awaiting-deploy", "commitSha": "...", "commitUrl": "..." }
```

All routes independently verify the owner.

- [ ] **Step 6: Run focused and full tests**

Run: `npm test -- src/lib/content/drafts.test.ts src/lib/content/publication.test.ts && npm test`

- [ ] **Step 7: Commit**

```bash
git add src/lib/content src/lib/github.ts src/app/api/data
git commit -m "feat: separate drafts from published content"
```

### Task 3: Shared Shell, Semantics, And Failure Surfaces

**Files:**
- Create: `src/components/ui/PostureBadge.tsx`
- Create: `src/components/ui/PostureBadge.test.ts`
- Create: `src/components/ui/RelativeTime.tsx`
- Create: `src/components/ui/RelativeTime.test.ts`
- Create: `src/components/layout/HeaderClient.tsx`
- Create: `src/app/actions/auth.ts`
- Modify: `src/components/layout/Header.tsx`
- Modify: `src/components/layout/Footer.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/auth.ts`
- Modify: `src/proxy.ts`
- Create: `src/app/signin/page.tsx`
- Create: `src/app/not-found.tsx`
- Create: `src/app/opengraph-image.tsx`
- Modify: public error boundaries and loading states.
- Modify: `package.json`, `package-lock.json`
- Create: `playwright.config.ts`
- Create: `tests/e2e/public-ui.spec.ts`

**Interfaces:**
- Consumes: posture types from Task 1 and public overall status from Task 5 through a narrow string prop.
- Produces: semantic badges, accessible relative time, responsive navigation, custom auth/error/not-found surfaces.

- [ ] **Step 1: Install UI/browser dependencies and write failing contracts**

Run: `npm install lucide-react && npm install --save-dev @playwright/test @axe-core/playwright`

Unit tests assert lifecycle/maturity copy, `Not monitored`, exact-time output, and sanitized public error copy helpers. Create Playwright configuration and public acceptance tests for the Reidar H1, responsive menu, branded owner sign-in, branded not-found, and skip link before implementing those surfaces.

- [ ] **Step 2: Confirm RED**

Run unit RED: `npm test -- src/components/ui/PostureBadge.test.ts src/components/ui/RelativeTime.test.ts`

Run browser RED after building the existing app: `npm run build && npm run test:e2e -- --grep "application shell"`

Expected: unit modules are missing and browser assertions fail against the old header/sign-in/not-found UI.

- [ ] **Step 3: Implement semantic tokens and shared components**

Use explicit badge maps. Do not accept arbitrary strings. Add CSS variables for neutral, information, healthy, warning, and failure roles. Replace `text-zinc-600` for normal labels.

- [ ] **Step 4: Implement responsive public and owner navigation**

Desktop: wordmark, Projects, Status, GitHub icon, owner menu. Mobile: wordmark, compact status indicator, menu icon. Add active state and `aria-current`.

- [ ] **Step 5: Add branded sign-in, not-found, error, and metadata surfaces**

Configure Auth.js `pages.signIn` and `pages.error` to `/signin`. Public errors omit `error.message`. Add skip link and main target.

- [ ] **Step 6: Verify**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build && npm run test:e2e -- --grep "application shell"`

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json playwright.config.ts tests/e2e src/app src/auth.ts src/proxy.ts src/components/layout src/components/ui
git commit -m "feat: add trust-first application shell"
```

### Task 4: Public Homepage, Catalogue, Detail, And Media

**Files:**
- Create: `src/components/ui/ProjectMedia.tsx`
- Create: `src/components/dashboard/PublicStatusBand.tsx`
- Create: `src/components/dashboard/FlagshipProjectCard.tsx`
- Rewrite: `src/components/dashboard/ProjectDashboard.tsx`
- Rewrite: `src/components/dashboard/ProjectHealthRow.tsx`
- Rewrite: `src/components/projects/ProjectList.tsx`
- Rewrite: `src/components/projects/ProjectCard.tsx`
- Rewrite: `src/app/projects/page.tsx`
- Rewrite: `src/app/projects/[slug]/page.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/lib/projects/presentation.ts`
- Create: `src/lib/projects/presentation.test.ts`
- Add: `public/projects/<slug>/cover.webp` for available real project media.

**Interfaces:**
- Consumes: canonical projects, posture badges, public metrics, optional GitHub stats.
- Produces: deterministic flagship ordering, filter/sort functions, evidence summaries, responsive public project surfaces.

- [ ] **Step 1: Write failing project-presentation tests**

```ts
it("sorts flagships by featured rank", () => {
  expect(selectFlagships(projects).map((project) => project.slug))
    .toEqual(["nytt", "rfs", "rfmc", "heimdall"]);
});

it("filters by search, lifecycle, maturity, and category", () => {
  expect(filterProjects(projects, { query: "flight", lifecycle: "active", maturity: "flagship", category: "all" }))
    .toEqual(expect.arrayContaining([expect.objectContaining({ slug: "rfs" })]));
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- src/lib/projects/presentation.test.ts`

- [ ] **Step 3: Implement pure selection, filtering, sorting, and evidence helpers**

GitHub absence returns `null` activity, not `no repo signal`.

- [ ] **Step 4: Capture and optimize real flagship media**

Capture reachable live project pages at a stable desktop viewport. Crop sensitive browser chrome, encode WebP, record dimensions and descriptive alt text in canonical content. Omit media for unreachable projects rather than fabricating it.

- [ ] **Step 5: Rewrite homepage**

Order: Reidar identity, coherent status band, flagship media cards, labelled current-work table, recent evidence, concise about band. Mobile rows render visible labels.

- [ ] **Step 6: Rewrite catalogue and detail pages**

Catalogue has URL-backed search, lifecycle, maturity, category, sort, clear command, two-column desktop cards, and one-column mobile cards. Detail uses `minmax(0,1fr) 280px`, structured sections, evidence strip, limitations, actions, and related projects.

- [ ] **Step 7: Verify**

Run: `npm test -- src/lib/projects/presentation.test.ts && npm test && npm run lint && npx tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add content public/projects src/app/page.tsx src/app/projects src/components/dashboard src/components/projects src/components/ui/ProjectMedia.tsx src/lib/projects
git commit -m "feat: rebuild public Project OS experience"
```

### Task 5: Public And Owner Status Completion

**Files:**
- Modify: `src/lib/metrics/reader.ts`
- Modify: `src/lib/metrics/reader.test.ts`
- Modify: `src/lib/metrics/status-page.ts`
- Modify: `src/lib/metrics/status-page.test.ts`
- Create: `src/components/dashboard/CoarseHistoryStrip.tsx`
- Create: `src/components/dashboard/OwnerAttentionSummary.tsx`
- Rewrite: `src/components/dashboard/VpsStatusSummary.tsx`
- Rewrite: `src/components/dashboard/StatusInventory.tsx`
- Rewrite: `src/components/dashboard/OwnerMetricsPanel.tsx`
- Modify: `src/app/status/page.tsx`
- Modify: `ops/frontpage-metrics.config.json` only for live endpoints confirmed by read-only checks.

**Interfaces:**
- Produces: `OverallPublicStatus`, `deriveOverallPublicStatus()`, `deriveProjectHealth()`, `OwnerAttentionItem[]`.

- [ ] **Step 1: Write failing status derivation tests**

```ts
it("prioritizes a down service over a healthy host", () => {
  expect(deriveOverallPublicStatus(publicModelWith({ service: "down" })).kind)
    .toBe("disruption");
});

it("does not expose exact values in coarse history", () => {
  expect(JSON.stringify(derivePublicMetrics(readResult))).not.toContain("ram_used_bytes");
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- src/lib/metrics/reader.test.ts src/lib/metrics/status-page.test.ts`

- [ ] **Step 3: Implement overall/project/attention derivation**

Follow the exact priority from the design specification. Keep host telemetry separate from overall status.

- [ ] **Step 4: Complete public status UI**

Render overall summary, coarse CPU/RAM/disk 24-hour strips, public services with semantic time, and explicit stale/unavailable/down states.

- [ ] **Step 5: Complete owner status UI**

Render attention summary, current values, used/total bytes, uptime, exact collection time, thresholds, charts, public/internal services, containers, and sanitized diagnostics.

- [ ] **Step 6: Verify probes before adding them**

Use focused read-only HTTP checks. Add only endpoints with stable expected responses and safe labels. Collector Python tests must pass after config changes.

- [ ] **Step 7: Verify**

Run: `npm test && python3 -m unittest ops.tests.test_frontpage_metrics_collector && npm run lint && npx tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add src/lib/metrics src/components/dashboard src/app/status ops/frontpage-metrics.config.json
git commit -m "feat: complete public and owner status views"
```

### Task 6: Owner Content Workspace And Runbook

**Files:**
- Create: `src/components/admin/ContentStateSummary.tsx`
- Create: `src/components/admin/ProjectEditor.tsx`
- Create: `src/components/admin/PersonalEditor.tsx`
- Create: `src/components/admin/PublishPanel.tsx`
- Create: `src/components/admin/CopyCommand.tsx`
- Rewrite: `src/app/admin/layout.tsx`
- Rewrite: `src/app/admin/page.tsx`
- Create: `src/app/admin/personal/page.tsx`
- Create: `src/app/admin/projects/page.tsx`
- Create: `src/app/admin/projects/[slug]/page.tsx`
- Remove: `src/app/admin/admin-client.tsx` after its replacement is complete.
- Rewrite: `src/app/ansible/page.tsx`
- Create: `src/lib/content/admin-view.ts`
- Create: `src/lib/content/admin-view.test.ts`

**Interfaces:**
- Consumes: drafts/publication state and canonical content.
- Produces: owner overview, complete project/personal editors, draft diff, publish confirmation, receipts, and read-only runbook.

- [ ] **Step 1: Write failing owner-view tests**

Test publication labels, project draft markers, complete-field validation summaries, and sanitized runbook copy.

- [ ] **Step 2: Confirm RED**

Run: `npm test -- src/lib/content/admin-view.test.ts`

- [ ] **Step 3: Implement owner overview and navigation**

Show deployed version, canonical base, draft state, validation, latest receipt, and safe destinations. Use responsive navigation.

- [ ] **Step 4: Implement complete editors**

Personal and project editors cover every canonical field, use inline validation, preserve drafts on error, announce save state, and warn before leaving with unsaved changes. Project list supports search and draft indicators.

- [ ] **Step 5: Implement publish confirmation and receipt UI**

Show human-readable diff summary, require explicit confirmation, and render commit receipt or conflict/failure without losing drafts.

- [ ] **Step 6: Rewrite Ansible as a read-only runbook**

Remove raw IP/key-path presentation, correct zero-downtime wording, group posture/commands/reference, and add accessible copy controls. Do not execute commands.

- [ ] **Step 7: Verify**

Run: `npm test && npm run lint && npx tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add src/app/admin src/app/ansible src/components/admin src/lib/content
git commit -m "feat: add owner content and runbook workspace"
```

### Task 7: Accessibility, Browser Coverage, Build, And Release Readiness

**Files:**
- Modify: `tests/e2e/public-ui.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `next.config.ts` only if canonical content tracing requires it.

**Interfaces:**
- Produces: repeatable public browser/accessibility gate and documented content/publication model.

- [ ] **Step 1: Complete browser and accessibility coverage**

Coverage:

```ts
test("public routes are labelled and leak no owner metrics", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reidar" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("ram_used_bytes");
});
```

Add 360px/390px overflow assertions, active navigation, flagship routes, branded 404, coarse status history, and axe scans.

- [ ] **Step 2: Run the complete browser suite**

Run: `npm run build && npm run test:e2e`

Expected: the suite passes; any uncovered integration defect becomes a demonstrated failing case before its correction.

- [ ] **Step 3: Fix only failures demonstrated by the browser suite**

Do not broaden scope. Re-run the failing spec after each fix.

- [ ] **Step 4: Add CI browser job and documentation**

CI installs Chromium and runs the public suite after Build check. README documents canonical content, drafts, publish/deploy states, public/owner posture, and exact local commands.

- [ ] **Step 5: Run full local gate**

```bash
source ~/.nvm/nvm.sh
nvm use 22
npm test
npm run lint
npx tsc --noEmit
DATA_DIR="$(mktemp -d)" AUTH_SECRET=dev-secret npm run build
python3 -m unittest ops.tests.test_frontpage_metrics_collector
python3 -m py_compile ops/frontpage-metrics-collector.py
ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file .vault_pass
git diff --check
```

- [ ] **Step 6: Run responsive and leak QA**

Verify `/`, `/projects`, `/projects/nytt`, `/projects/rfs`, `/status`, `/signin`, and a missing project at 360, 390, 768, 1024, and 1440px. Verify no overlap, no horizontal overflow, nonblank media, keyboard navigation, and no owner/raw metric markers in public HTML.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json playwright.config.ts tests .github/workflows/ci.yml README.md next.config.ts
git commit -m "test: gate trust-first Project OS experience"
```

### Task 8: Final Branch Verification And Review Handoff

**Files:**
- Review all changed files against the design spec and this plan.

**Interfaces:**
- Consumes all previous tasks.
- Produces a clean, locally verified feature branch ready for code review.

- [ ] **Step 1: Confirm task checklist and commit history**

Every task has a green verification record and focused commit.

- [ ] **Step 2: Inspect final diff for truth, privacy, and scope**

Check canonical content count/posture, public-owner boundaries, error sanitization, no secret material, responsive classes, and no dead legacy components.

- [ ] **Step 3: Run the complete verification gate fresh**

Repeat Task 7 Step 6 and public browser tests from a clean build.

- [ ] **Step 4: Use finishing-a-development-branch**

Present verified options for push/PR/merge. Do not push, merge, deploy, or mutate production without the user's requested finishing action.
