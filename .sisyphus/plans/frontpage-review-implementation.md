# Frontpage Review Implementation

## TL;DR

> Fix all findings from the comprehensive project review: security patches (Next.js CVE, owner-only auth), dependency upgrades, input validation, error boundaries, performance improvements (server-side GitHub stats, static layout), and accessibility gaps.
>
> **Deliverables**: Patched auth layer, validated API routes, server-rendered stats, error/loading boundaries, dependency upgrades
> **Estimated Effort**: Medium-Large (26 tasks across 4 waves)
> **Parallel Execution**: YES — 4 waves, max 8 tasks per wave
> **Critical Path**: Wave 1 (security) → Wave 2 (validation) → Wave 3 (boundaries) → Wave 4 (perf/a11y) → Final Verification

---

## Context

### Original Request
Comprehensive review of the Next.js 16 portfolio project identified security vulnerabilities, outdated dependencies, performance bottlenecks, and code quality issues. User requested an implementation plan to address all findings.

### Review Findings Summary
**Security**: Next.js middleware bypass CVE (GHSA-26hh-7cqf-hhc6), missing owner-only authorization, unvalidated API writes, stored URL injection, weak CSRF defense.
**Dependencies**: next@16.2.5 vulnerable, react/react-dom patch behind, eslint@9 vs 10, typescript@5 vs 6.
**Performance**: `auth()` in root layout makes all pages dynamic, per-card GitHub stats fetching (N+1), missing loading/error boundaries, unused Geist_Mono font.
**Code Quality**: Missing error handling, weak runtime type safety (unknown types), accessibility gaps, missing route boundaries.

### Metis Review
**Identified Gaps** (addressed in plan):
- Phased approach: security first, then validation, then performance, then optional upgrades
- No test suite addition (project explicitly has no tests)
- Keep existing auth flow working; maintain CI/CD pipeline
- No new features, only fixes from review findings
- Rollback strategy: dependency upgrades are patch-level; auth changes are additive checks
- Edge cases: concurrent admin edits, GitHub API rate limits, runtime data during deployment

---

## Work Objectives

### Core Objective
Address every finding from the comprehensive review with concrete code changes, maintaining existing functionality and CI/CD pipeline health.

### Concrete Deliverables
- `package.json` with patched dependencies (next@16.2.7, react@19.2.7, react-dom@19.2.7)
- `src/auth.ts` with owner-only authorization
- `src/middleware.ts` with owner-only check
- `src/app/admin/layout.tsx` with owner-only gate
- `src/app/api/data/personal/route.ts` + `projects/route.ts` with owner checks + Zod validation + URL scheme validation
- `src/app/error.tsx` + `src/app/admin/error.tsx` + `src/app/projects/error.tsx` + `src/app/projects/[slug]/error.tsx` (+ root-level `src/app/error.tsx`)
- `src/app/loading.tsx` + `src/app/admin/loading.tsx` + `src/app/projects/loading.tsx` + `src/app/projects/[slug]/loading.tsx` (+ root-level `src/app/loading.tsx`)
- `src/lib/` error handling improvements
- `src/components/projects/ProjectCard.tsx` converted to server component with stats passed as props
- `src/app/layout.tsx` with unused Geist_Mono removed
- Accessibility fixes in admin page and ProjectList

### Definition of Done
- [ ] `npm audit` reports zero vulnerabilities
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] All "Must Have" items from review are implemented
- [ ] All "Must NOT Have" guardrails are respected

### Must Have
1. Next.js upgraded to 16.2.7+ (CVE fix)
2. Owner-only authorization enforced across auth, middleware, admin layout, API routes
3. Zod validation on all write APIs
4. URL scheme validation (https/http only) for editable URLs
5. Server-side GitHub stats fetching (eliminate per-card N+1)
6. Error and loading boundaries for all main routes
7. Admin page error handling (try/catch/finally, res.ok checks)
8. Accessibility fixes (aria-labels, aria-pressed, proper labels)

### Must NOT Have (Guardrails)
- Do NOT add a test suite (project has no test infrastructure)
- Do NOT rewrite the data layer (incremental fixes only)
- Do NOT add new features beyond review findings
- Do NOT break existing CI/CD pipeline
- Do NOT change public-facing UI design without explicit reason
- Do NOT remove auth checks from any existing route
- Do NOT expose secrets or tokens in code
- Do NOT claim projects are "live/deployed" without CI verification

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None (project has no test runner)
- **Framework**: N/A
- **Agent-Executed QA**: MANDATORY for every task

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Playwright — navigate, interact, assert DOM, screenshot
- **TUI/CLI**: interactive_bash (tmux) — run command, send keystrokes, validate output
- **API/Backend**: Bash (curl) — send requests, assert status + response fields
- **Build**: Bash — `npm run lint`, `npm run build`, `npm audit`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Security Foundation — 8 tasks, ALL can start immediately):
├── Task 1: Upgrade dependencies (next, react, react-dom, eslint-config-next)
├── Task 2: auth.ts owner-only authorization
├── Task 3: middleware.ts owner-only check
├── Task 4: admin/layout.tsx owner-only gate
├── Task 5: API routes owner-only check (personal + projects)
├── Task 6: URL scheme validation on write
├── Task 7: Fix admin page error handling
└── Task 8: Fix lib error handling (github.ts + data.ts)

Wave 2 (Validation + Boundaries — 10 tasks, depends: Wave 1 for auth context):
├── Task 9: Zod validation for personal API
├── Task 10: Zod validation for projects API
├── Task 11: error.tsx for admin
├── Task 12: error.tsx for projects
├── Task 13: error.tsx for project detail
├── Task 13a: error.tsx for root layout
├── Task 14: loading.tsx for admin
├── Task 15: loading.tsx for projects
├── Task 16: loading.tsx for project detail
└── Task 16a: loading.tsx for root layout

Wave 3 (Performance + Accessibility — 6 tasks, depends: Wave 1 for stable auth):
├── Task 17: Move GitHub stats fetching server-side
├── Task 18: Remove unused Geist_Mono font
├── Task 19: Fix admin page client-side fetch → server-side initial data
├── Task 20: Fix accessibility gaps (aria-labels, aria-pressed, proper labels)
├── Task 21: Evaluate TypeScript 6 upgrade
└── Task 22: Evaluate ESLint 10 upgrade

Wave 4 (Optional Cleanup — 2 tasks, depends: Wave 3):
├── Task 23: @types/node alignment evaluation
└── Task 24: Final dependency cleanup + lockfile refresh

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 2-5 → Task 9-10 → Task 17 → F1-F4 → user okay
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 8 (Wave 1 & 2)
```

### Dependency Matrix

| Task | Blocks | Blocked By |
|------|--------|-----------|
| 1 | 2-24 | None |
| 2-6 | 9-24 | 1 |
| 7-8 | 9-24 | None |
| 9-10 | 11-24 | 2-6 |
| 11-16 | 17-24 | None |
| 17-20 | 21-24 | 1-16 |
| 21-24 | F1-F4 | 1-20 |
| F1-F4 | — | 1-24 |

---

## TODOs

- [x] 1. Upgrade dependencies (next, react, react-dom, eslint-config-next)

  **What to do**:
  - Update `package.json`: `next` 16.2.5 → 16.2.7, `react` 19.2.4 → 19.2.7, `react-dom` 19.2.4 → 19.2.7, `eslint-config-next` 16.2.5 → 16.2.7
  - Run `npm install` to update package-lock.json
  - Verify no breaking changes in Next.js 16.2.7 changelog

  **Must NOT do**:
  - Do NOT upgrade eslint to v10 or typescript to v6 in this task (separate evaluation tasks)
  - Do NOT change any other dependencies without explicit reason

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Dependency bump with verification is a straightforward change

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-8)
  - **Blocks**: Tasks 2-24 (all subsequent tasks need stable base)
  - **Blocked By**: None

  **References**:
  - `package.json` - Current dependency versions
  - `npm audit` output - Confirms CVE in next@16.2.5

  **Acceptance Criteria**:
  - [ ] `package.json` shows next@16.2.7, react@19.2.7, react-dom@19.2.7
  - [ ] `npm audit --audit-level=moderate` reports 0 vulnerabilities
  - [ ] `npm run build` passes
  - [ ] `npm run lint` passes

  **QA Scenarios**:
  ```
  Scenario: Dependency upgrade successful
    Tool: Bash
    Preconditions: Clean working tree
    Steps:
      1. Read package.json, verify versions updated
      2. Run `npm install`
      3. Run `npm audit --audit-level=moderate`
      4. Run `npm run lint`
      5. Run `npm run build`
    Expected Result: audit shows 0 vulns, lint passes, build passes
    Evidence: .sisyphus/evidence/task-1-dep-upgrade.log
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `fix(deps): patch next, react, react-dom for CVE`
  - Files: `package.json`, `package-lock.json`

- [x] 2. auth.ts owner-only authorization

  **What to do**:
  - Add owner allowlist check to `src/auth.ts` `authorized()` callback
  - Owner identification: prefer GitHub ID, fallback to login/email via env vars (`OWNER_GITHUB_ID`, `OWNER_EMAIL`)
  - If user is not in allowlist, return `false` (redirect to signin)

  **Must NOT do**:
  - Do NOT remove existing `trustHost: true` or provider config
  - Do NOT hardcode secrets or IDs in source code (use env vars)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Auth config change with clear requirements

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 3-6 (middleware, admin layout, API routes need consistent auth)
  - **Blocked By**: Task 1 (stable deps)

  **References**:
  - `src/auth.ts:1-17` - Current NextAuth config
  - `src/middleware.ts:1-15` - Current middleware
  - `src/app/admin/layout.tsx:1-48` - Current admin gate

  **Acceptance Criteria**:
  - [ ] `auth.ts` checks `OWNER_GITHUB_ID` or `OWNER_EMAIL` against session user
  - [ ] Non-owner authenticated users are rejected
  - [ ] `npm run build` passes

  **QA Scenarios**:
  ```
  Scenario: Owner access logic exists in code
    Tool: Bash (grep)
    Steps:
      1. grep -n "OWNER_GITHUB_ID\|OWNER_EMAIL" src/auth.ts
      2. grep -n "authorized" src/auth.ts
    Expected Result: Owner check logic found in auth.ts
    Evidence: .sisyphus/evidence/task-2-auth-code-review.log

  Scenario: Non-owner access denied (local dev test)
    Tool: Bash
    Preconditions: App running locally, OWNER_GITHUB_ID="12345"
    Steps:
      1. Start dev server: `OWNER_GITHUB_ID="12345" npm run dev &`
      2. curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin
      3. Verify redirect to /api/auth/signin (302)
    Expected Result: 302 redirect (no valid session = redirect)
    Evidence: .sisyphus/evidence/task-2-owner-auth-denied.log
  ```

  **Commit**: YES (groups with Wave 1)

- [x] 3. middleware.ts owner-only check

  **What to do**:
  - Update `src/middleware.ts` to check owner allowlist (same logic as auth.ts)
  - Redirect non-owner authenticated users from `/admin/*` and `/ansible`
  - Keep unauthenticated redirect behavior intact

  **Must NOT do**:
  - Do NOT change matcher config
  - Do NOT remove existing unauthenticated redirect

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: None (additive to Task 2)
  - **Blocked By**: Task 2 (consistent auth logic)

  **References**:
  - `src/middleware.ts:1-15` - Current middleware
  - `src/auth.ts` - Auth config (Task 2)

  **Acceptance Criteria**:
  - [ ] Middleware rejects non-owner authenticated users from protected routes
  - [ ] Unauthenticated users still redirect to signin
  - [ ] Public routes unaffected

  **QA Scenarios**:
  ```
  Scenario: Middleware owner check exists in code
    Tool: Bash (grep)
    Steps:
      1. grep -n "OWNER_GITHUB_ID\|OWNER_EMAIL" src/middleware.ts
      2. grep -n "redirect" src/middleware.ts
    Expected Result: Owner check + redirect logic found
    Evidence: .sisyphus/evidence/task-3-middleware-code.log

  Scenario: Middleware redirects unauthenticated
    Tool: Bash
    Steps:
      1. Start dev server: `npm run dev &`
      2. curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin
    Expected Result: 302 redirect (no session = redirect to signin)
    Evidence: .sisyphus/evidence/task-3-middleware-redirect.log
  ```

  **Commit**: YES (groups with Wave 1)

- [x] 4. admin/layout.tsx owner-only gate

  **What to do**:
  - Update `src/app/admin/layout.tsx` to enforce owner-only access
  - If non-owner: `redirect("/")` or `redirect("/api/auth/signin")`
  - Keep existing sign-out form and session display

  **Must NOT do**:
  - Do NOT remove existing layout styling
  - Do NOT change sign-out behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: None
  - **Blocked By**: Task 2

  **References**:
  - `src/app/admin/layout.tsx:1-48` - Current admin layout

  **Acceptance Criteria**:
  - [ ] Layout redirects non-owner users before rendering children
  - [ ] Owner users see full admin UI

  **QA Scenarios**:
  ```
  Scenario: Admin layout owner check exists
    Tool: Bash (grep)
    Steps:
      1. grep -n "OWNER_GITHUB_ID\|OWNER_EMAIL\|redirect" src/app/admin/layout.tsx
    Expected Result: Owner check + redirect found in layout
    Evidence: .sisyphus/evidence/task-4-admin-layout-code.log

  Scenario: Admin layout redirects unauthenticated
    Tool: Bash
    Steps:
      1. Start dev server: `npm run dev &`
      2. curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin
    Expected Result: 302 redirect (no session = redirect)
    Evidence: .sisyphus/evidence/task-4-admin-layout-redirect.log
  ```

  **Commit**: YES (groups with Wave 1)

- [x] 5. API routes owner-only check (personal + projects)

  **What to do**:
  - Update `src/app/api/data/personal/route.ts` and `src/app/api/data/projects/route.ts`
  - Add owner allowlist check at the start of each PUT handler (before any data processing)
  - Return `401 Unauthorized` for non-owner authenticated users

  **Must NOT do**:
  - Do NOT remove existing `session?.user` check (keep it as first gate)
  - Do NOT change response shape (still return `{ ok: true, synced }` on success)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 9-10 (Zod validation builds on auth)
  - **Blocked By**: Task 2

  **References**:
  - `src/app/api/data/personal/route.ts:1-23` - Current personal API
  - `src/app/api/data/projects/route.ts:1-23` - Current projects API

  **Acceptance Criteria**:
  - [ ] Both PUT routes check owner allowlist before processing
  - [ ] Non-owner requests return 401 with `{ error: "Unauthorized" }`

  **QA Scenarios**:
  ```
  Scenario: API owner check exists in code
    Tool: Bash (grep)
    Steps:
      1. grep -n "OWNER_GITHUB_ID\|OWNER_EMAIL" src/app/api/data/personal/route.ts
      2. grep -n "OWNER_GITHUB_ID\|OWNER_EMAIL" src/app/api/data/projects/route.ts
      3. grep -n "401\|Unauthorized" src/app/api/data/personal/route.ts
    Expected Result: Owner check + 401 response found in both routes
    Evidence: .sisyphus/evidence/task-5-api-auth-code.log

  Scenario: API rejects unauthenticated write
    Tool: Bash
    Steps:
      1. Start dev server: `npm run dev &`
      2. curl -X PUT -H "Content-Type: application/json" -d '{"name":"test"}' -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/data/personal
    Expected Result: 401 (no session = unauthorized)
    Evidence: .sisyphus/evidence/task-5-api-auth-denied.log
  ```

  **Commit**: YES (groups with Wave 1)

- [x] 6. URL scheme validation on write

  **What to do**:
  - In admin write endpoints and client-side validation, reject URLs with non-https schemes
  - Fields to validate: `repoUrl`, `liveUrl`, `socials[].url`
  - Allow: `https://`, `http://` (with warning)
  - Reject: `javascript:`, `data:`, `file:`, etc.
  - Return 400 with clear error message for invalid URLs

  **Must NOT do**:
  - Do NOT break existing valid URLs
  - Do NOT validate URLs on read/render (only on write)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: None
  - **Blocked By**: Task 5

  **References**:
  - `src/app/api/data/personal/route.ts` - Personal write endpoint
  - `src/app/api/data/projects/route.ts` - Projects write endpoint

  **Acceptance Criteria**:
  - [ ] Admin API rejects `javascript:` URLs with 400
  - [ ] Admin API accepts `https://` URLs normally
  - [ ] Validation is reflected in admin UI (client-side + server-side)

  **QA Scenarios**:
  ```
  Scenario: URL validation logic exists in code
    Tool: Bash (grep)
    Steps:
      1. grep -n "http\|https\|scheme\|javascript" src/app/api/data/personal/route.ts
      2. grep -n "http\|https\|scheme\|javascript" src/app/api/data/projects/route.ts
    Expected Result: URL scheme validation logic found in both routes
    Evidence: .sisyphus/evidence/task-6-url-validation-code.log

  Scenario: Unauthenticated PUT rejected before validation
    Tool: Bash
    Steps:
      1. Start dev server: `npm run dev &`
      2. curl -X PUT -H "Content-Type: application/json" -d '{"repoUrl":"javascript:alert(1)"}' -s -w "\n%{http_code}" http://localhost:3000/api/data/projects
    Expected Result: 401 (auth gate fires before validation)
    Evidence: .sisyphus/evidence/task-6-url-validation-auth.log
  ```

  **Commit**: YES (groups with Wave 1)

- [x] 7. Fix admin page error handling

  **What to do**:
  - Add `try/catch/finally` to all async operations in `src/app/admin/page.tsx`
  - `savePersonal`: catch errors, show error message, reset `saving` in finally
  - `saveProjects`: same pattern
  - `useEffect` fetch: add `.catch()` and error state
  - Check `res.ok` before parsing response JSON

  **Must NOT do**:
  - Do NOT remove existing success message flow
  - Do NOT suppress errors silently

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/admin/page.tsx:50-349` - Current admin page

  **Acceptance Criteria**:
  - [ ] All fetch calls wrapped in try/catch
  - [ ] `saving` state resets even on error
  - [ ] Error messages displayed to user
  - [ ] `res.ok` checked before `res.json()`

  **QA Scenarios**:
  ```
  Scenario: Admin save shows error on failure
    Tool: Playwright
    Preconditions: App running locally
    Steps:
      1. Navigate to /admin (as owner)
      2. Edit a field
      3. Block /api/data/personal endpoint (or trigger error)
      4. Click "Save Personal Info"
    Expected Result: Error message shown, "Saving..." button returns to normal state
    Evidence: .sisyphus/evidence/task-7-admin-error-handling.png
  ```

  **Commit**: YES (groups with Wave 1)

- [x] 8. Fix lib error handling (github.ts + data.ts)

  **What to do**:
  - `src/lib/github.ts`: Replace broad catch with specific error handling; log meaningful messages; don't swallow errors
  - `src/lib/data.ts`: Add try/catch around `JSON.parse` in `readJSON`; return fallback on parse error instead of crashing
  - `src/lib/github-stats.ts`: Keep existing error handling but ensure cache is not poisoned by invalid data

  **Must NOT do**:
  - Do NOT remove existing `console.error` calls
  - Do NOT change public API signatures

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/lib/github.ts:1-59` - GitHub sync
  - `src/lib/data.ts:1-56` - Data persistence
  - `src/lib/github-stats.ts:1-111` - Stats fetching

  **Acceptance Criteria**:
  - [ ] `readJSON` gracefully handles invalid JSON files
  - [ ] `syncToGithub` logs specific error types
  - [ ] No empty catch blocks remain

  **QA Scenarios**:
  ```
  Scenario: Invalid JSON handled gracefully
    Tool: Bash
    Steps:
      1. Create invalid JSON file: `echo "not json" > public/data/personal.json`
      2. Run a node script that calls `getPersonal()` from `src/lib/data.ts`
      3. Verify it returns bundled fallback without throwing
      4. Restore or delete the invalid file
    Expected Result: Returns fallback data, no crash
    Evidence: .sisyphus/evidence/task-8-lib-error-invalid-json.log

  Scenario: GitHub sync error logging
    Tool: Bash (grep)
    Steps:
      1. grep -n "console.error\|console.log" src/lib/github.ts
      2. Verify error messages are specific (not just "error")
    Expected Result: Specific error logging found (e.g., "GitHub sync failed:", "No GITHUB_TOKEN")
    Evidence: .sisyphus/evidence/task-8-lib-error-github.log
  ```

  **Commit**: YES (groups with Wave 1)

- [x] 9. Zod validation for personal API

  **What to do**:
  - Add Zod schema for `PersonalData` in `src/app/api/data/personal/route.ts`
  - Validate `req.json()` against schema before calling `savePersonal`
  - Fields: `name` (string, max 100), `title` (string, max 100), `location` (string, max 100), `bio` (string, max 2000), `whatIDo` (string array, max 20 items, each max 200 chars), `skills` (string array, max 50 items), `socials` (array of `{ label, url }`, url must be http/https)
  - Return 400 with field-specific error messages

  **Must NOT do**:
  - Do NOT change the `PersonalData` interface in `src/data/personal.ts`
  - Do NOT break existing valid data

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - Reason: Validation logic requires careful schema design

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: Tasks 2-5 (auth must be stable)

  **References**:
  - `src/app/api/data/personal/route.ts:1-23` - Current route
  - `src/data/personal.ts:1-45` - PersonalData interface

  **Acceptance Criteria**:
  - [ ] Zod schema validates all PersonalData fields
  - [ ] Invalid payloads return 400 with clear errors
  - [ ] Valid payloads pass through normally

  **QA Scenarios**:
  ```
  Scenario: Zod schema exists in personal route
    Tool: Bash (grep)
    Steps:
      1. grep -n "z\." src/app/api/data/personal/route.ts
      2. grep -n "parse\|safeParse" src/app/api/data/personal/route.ts
    Expected Result: Zod import, schema definition, and parse call found
    Evidence: .sisyphus/evidence/task-9-zod-personal-code.log

  Scenario: Zod schema rejects invalid data directly
    Tool: Bash (node)
    Steps:
      1. Create a test script that imports the Zod schema from personal/route.ts and calls .safeParse({"name":"","bio":"x","whatIDo":[],"skills":[],"socials":[]})
      2. Run with node
    Expected Result: safeParse returns { success: false } with field errors
    Evidence: .sisyphus/evidence/task-9-zod-personal-invalid.log
  ```

  **Commit**: YES (groups with Wave 2)

- [x] 10. Zod validation for projects API

  **What to do**:
  - Add Zod schema for `Project[]` in `src/app/api/data/projects/route.ts`
  - Validate each project: `slug` (string, kebab-case, max 50), `name` (string, max 100), `shortDescription` (string, max 500), `longDescription` (string, max 5000), `tags` (string array, max 20), `techStack` (string array, max 20), `status` (enum: active, in-progress, completed, paused), `category` (enum: defi, bot, frontend, tooling, wiki, infra), `repoUrl` (optional, url), `liveUrl` (optional, url), `featured` (boolean)
  - Return 400 with field-specific error messages

  **Must NOT do**:
  - Do NOT change the `Project` interface in `src/data/projects.ts`
  - Do NOT break existing valid projects data

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: Tasks 2-5

  **References**:
  - `src/app/api/data/projects/route.ts:1-23` - Current route
  - `src/data/projects.ts:1-212` - Project interface and data

  **Acceptance Criteria**:
  - [ ] Zod schema validates all Project fields
  - [ ] Invalid payloads return 400 with clear errors
  - [ ] Valid payloads pass through normally

  **QA Scenarios**:
  ```
  Scenario: Zod schema exists in projects route
    Tool: Bash (grep)
    Steps:
      1. grep -n "z\." src/app/api/data/projects/route.ts
      2. grep -n "parse\|safeParse" src/app/api/data/projects/route.ts
    Expected Result: Zod import, schema definition, and parse call found
    Evidence: .sisyphus/evidence/task-10-zod-projects-code.log

  Scenario: Zod schema rejects invalid project directly
    Tool: Bash (node)
    Steps:
      1. Create a test script that imports the Zod schema from projects/route.ts and calls .safeParse([{"slug":"test","name":"Test","shortDescription":"x","longDescription":"x","tags":[],"techStack":[],"status":"invalid-status","category":"frontend","featured":false}])
      2. Run with node
    Expected Result: safeParse returns { success: false } with enum error
    Evidence: .sisyphus/evidence/task-10-zod-projects-invalid.log
  ```

  **Commit**: YES (groups with Wave 2)

- [x] 11. error.tsx for admin

  **What to do**:
  - Create `src/app/admin/error.tsx`
  - Display friendly error message with "Try again" button
  - Log error details server-side
  - Match existing dark theme styling

  **Must NOT do**:
  - Do NOT expose stack traces or sensitive info to client

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - Next.js docs: `error.js` convention
  - `src/app/admin/page.tsx` - Admin page to protect

  **Acceptance Criteria**:
  - [ ] File exists at `src/app/admin/error.tsx`
  - [ ] Throws in admin page show boundary UI instead of crash

  **QA Scenarios**:
  ```
  Scenario: Admin error.tsx exists and exports correctly
    Tool: Bash (grep)
    Steps:
      1. cat src/app/admin/error.tsx
      2. Verify file exports a default component
      3. Verify it accepts { error, reset } props
    Expected Result: File exists with valid Next.js error boundary signature
    Evidence: .sisyphus/evidence/task-11-admin-error-code.log

  Scenario: Admin error boundary renders on throw
    Tool: Playwright
    Preconditions: Temporarily add `throw new Error("test")` inside admin/page.tsx
    Steps:
      1. Navigate to /admin
      2. Screenshot the page
      3. Revert the temporary throw
    Expected Result: Error boundary UI visible (not white screen)
    Evidence: .sisyphus/evidence/task-11-admin-error-boundary.png
  ```

  **Commit**: YES (groups with Wave 2)

- [x] 12. error.tsx for projects

  **What to do**:
  - Create `src/app/projects/error.tsx`
  - Same pattern as admin error boundary

  **Must NOT do**:
  - Do NOT expose stack traces to client

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/projects/page.tsx` - Projects page

  **Acceptance Criteria**:
  - [ ] File exists at `src/app/projects/error.tsx`
  - [ ] Throws in projects page show boundary UI

  **QA Scenarios**:
  ```
  Scenario: Projects error.tsx exists with correct signature
    Tool: Bash (grep)
    Steps:
      1. cat src/app/projects/error.tsx
      2. Verify default export + { error, reset } props
    Expected Result: File exists with valid Next.js error boundary signature
    Evidence: .sisyphus/evidence/task-12-projects-error-code.log

  Scenario: Projects error boundary renders on throw
    Tool: Playwright
    Preconditions: Temporarily add `throw new Error("test")` inside projects/page.tsx
    Steps:
      1. Navigate to /projects
      2. Screenshot
      3. Revert throw
    Expected Result: Error boundary UI visible
    Evidence: .sisyphus/evidence/task-12-projects-error-boundary.png
  ```

  **Commit**: YES (groups with Wave 2)

- [x] 13. error.tsx for project detail

  **What to do**:
  - Create `src/app/projects/[slug]/error.tsx`
  - Same pattern as other error boundaries

  **Must NOT do**:
  - Do NOT expose stack traces to client

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/projects/[slug]/page.tsx` - Project detail page

  **Acceptance Criteria**:
  - [ ] File exists at `src/app/projects/[slug]/error.tsx`
  - [ ] Throws in project detail page show boundary UI

  **QA Scenarios**:
  ```
  Scenario: Project detail error.tsx exists with correct signature
    Tool: Bash (grep)
    Steps:
      1. cat src/app/projects/\[slug\]/error.tsx
      2. Verify default export + { error, reset } props
    Expected Result: File exists with valid Next.js error boundary signature
    Evidence: .sisyphus/evidence/task-13-detail-error-code.log

  Scenario: Project detail error boundary renders on throw
    Tool: Playwright
    Preconditions: Temporarily add `throw new Error("test")` inside projects/\[slug\]/page.tsx
    Steps:
      1. Navigate to /projects/nytt
      2. Screenshot
      3. Revert throw
    Expected Result: Error boundary UI visible
    Evidence: .sisyphus/evidence/task-13-detail-error-boundary.png
  ```

  **Commit**: YES (groups with Wave 2)

- [x] 13a. error.tsx for root layout

  **What to do**:
  - Create `src/app/error.tsx` for root-level error boundary
  - Same pattern as segment error boundaries: friendly message, "Try again" button, dark theme
  - Must handle errors from root layout and all nested routes

  **Must NOT do**:
  - Do NOT expose stack traces or sensitive info

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - Next.js docs: root `error.js` convention
  - `src/app/layout.tsx` - Root layout

  **Acceptance Criteria**:
  - [ ] File exists at `src/app/error.tsx`
  - [ ] Exports default component accepting `{ error, reset }`

  **QA Scenarios**:
  ```
  Scenario: Root error.tsx exists with correct signature
    Tool: Bash (grep)
    Steps:
      1. cat src/app/error.tsx
      2. Verify default export + { error, reset } props
    Expected Result: File exists with valid Next.js error boundary signature
    Evidence: .sisyphus/evidence/task-13a-root-error-code.log
  ```

  **Commit**: YES (groups with Wave 2)

- [x] 14. loading.tsx for admin

  **What to do**:
  - Create `src/app/admin/loading.tsx`
  - Show a simple skeleton loader matching the dark theme
  - Use existing color palette (zinc/green)

  **Must NOT do**:
  - Do NOT add heavy animation libraries
  - Do NOT show sensitive data in loading state

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/admin/page.tsx` - Admin page layout

  **Acceptance Criteria**:
  - [ ] File exists at `src/app/admin/loading.tsx`
  - [ ] Loading state shown during admin page transitions

  **QA Scenarios**:
  ```
  Scenario: Admin loading.tsx exists with correct pattern
    Tool: Bash (grep)
    Steps:
      1. cat src/app/admin/loading.tsx
      2. Verify default export component
      3. Verify uses existing theme colors (zinc/green)
    Expected Result: File exists with valid Next.js loading signature
    Evidence: .sisyphus/evidence/task-14-admin-loading-code.log

  Scenario: Admin loading state renders during navigation
    Tool: Playwright
    Steps:
      1. Throttle network to Slow 3G
      2. Navigate to /admin
      3. Wait for selector matching skeleton pattern (e.g., `[data-testid="skeleton"]` or `className` containing "animate-pulse")
      4. Screenshot before main content loads
      5. Restore network speed
    Expected Result: Skeleton loader visible during slow load
    Evidence: .sisyphus/evidence/task-14-admin-loading.png
  ```

  **Commit**: YES (groups with Wave 2)

- [x] 15. loading.tsx for projects

  **What to do**:
  - Create `src/app/projects/loading.tsx`
  - Show project grid skeleton with 6 placeholder cards

  **Must NOT do**:
  - Do NOT add heavy animation libraries

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/projects/page.tsx` - Projects page
  - `src/components/projects/ProjectCard.tsx` - Card styling reference

  **Acceptance Criteria**:
  - [ ] File exists at `src/app/projects/loading.tsx`
  - [ ] Loading state shown during projects page transitions

  **QA Scenarios**:
  ```
  Scenario: Projects loading.tsx exists with correct pattern
    Tool: Bash (grep)
    Steps:
      1. cat src/app/projects/loading.tsx
      2. Verify default export component
      3. Verify uses existing theme colors
    Expected Result: File exists with valid Next.js loading signature
    Evidence: .sisyphus/evidence/task-15-projects-loading-code.log

  Scenario: Projects loading state renders during navigation
    Tool: Playwright
    Steps:
      1. Throttle network to Slow 3G
      2. Navigate to /projects
      3. Wait for skeleton selector
      4. Screenshot before main content loads
      5. Restore network speed
    Expected Result: Skeleton cards visible during slow load
    Evidence: .sisyphus/evidence/task-15-projects-loading.png
  ```

  **Commit**: YES (groups with Wave 2)

- [x] 16. loading.tsx for project detail

  **What to do**:
  - Create `src/app/projects/[slug]/loading.tsx`
  - Show project detail skeleton with title, description, tech stack placeholders

  **Must NOT do**:
  - Do NOT add heavy animation libraries

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/projects/[slug]/page.tsx` - Project detail page

  **Acceptance Criteria**:
  - [ ] File exists at `src/app/projects/[slug]/loading.tsx`
  - [ ] Loading state shown during project detail transitions

  **QA Scenarios**:
  ```
  Scenario: Project detail loading.tsx exists with correct pattern
    Tool: Bash (grep)
    Steps:
      1. cat src/app/projects/\[slug\]/loading.tsx
      2. Verify default export component
      3. Verify uses existing theme colors
    Expected Result: File exists with valid Next.js loading signature
    Evidence: .sisyphus/evidence/task-16-detail-loading-code.log

  Scenario: Project detail loading state renders during navigation
    Tool: Playwright
    Steps:
      1. Throttle network to Slow 3G
      2. Navigate to /projects/nytt
      3. Wait for skeleton selector
      4. Screenshot before main content loads
      5. Restore network speed
    Expected Result: Skeleton detail page visible during slow load
    Evidence: .sisyphus/evidence/task-16-detail-loading.png
  ```

  **Commit**: YES (groups with Wave 2)

- [x] 16a. loading.tsx for root layout

  **What to do**:
  - Create `src/app/loading.tsx` for root-level loading state
  - Show a simple full-page skeleton matching the dark theme
  - Use existing zinc/green palette

  **Must NOT do**:
  - Do NOT add heavy animation libraries

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/layout.tsx` - Root layout
  - `src/app/globals.css` - Theme colors

  **Acceptance Criteria**:
  - [ ] File exists at `src/app/loading.tsx`
  - [ ] Exports default loading component

  **QA Scenarios**:
  ```
  Scenario: Root loading.tsx exists with correct pattern
    Tool: Bash (grep)
    Steps:
      1. cat src/app/loading.tsx
      2. Verify default export component
      3. Verify uses existing theme colors
    Expected Result: File exists with valid Next.js loading signature
    Evidence: .sisyphus/evidence/task-16a-root-loading-code.log
  ```

  **Commit**: YES (groups with Wave 2)

- [x] 17. Move GitHub stats fetching server-side

  **What to do**:
  - Convert `src/components/projects/ProjectCard.tsx` from client component to server component
  - Fetch GitHub stats in server component parent (`FeaturedProjects.tsx` or `ProjectList.tsx` or page components)
  - Pass stats as props to `ProjectCard`
  - Cache `/api/github/stats` response with `revalidate` or Cache-Control headers (5min TTL)
  - Update `src/app/api/github/stats/route.ts` to add caching headers or `export const revalidate = 300`

  **Must NOT do**:
  - Do NOT remove the existing in-memory cache in `github-stats.ts` (keep as fallback)
  - Do NOT break the existing stats display UI

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  - Reason: Requires understanding of Server vs Client Components, caching strategies, and data flow refactoring

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Tasks 1-16 (stable auth and boundaries)

  **References**:
  - `src/components/projects/ProjectCard.tsx:80-99` - Client-side stats fetch
  - `src/app/api/github/stats/route.ts:1-30` - Stats API endpoint
  - `src/lib/github-stats.ts:1-111` - Stats fetching logic
  - `src/components/home/FeaturedProjects.tsx` - Featured projects list
  - `src/components/projects/ProjectList.tsx` - Full projects list

  **Acceptance Criteria**:
  - [ ] `ProjectCard.tsx` no longer has `"use client"` or `useEffect` for stats
  - [ ] Stats are fetched once per page render (server-side)
  - [ ] `/api/github/stats` uses caching (revalidate or headers)
  - [ ] `npm run build` passes
  - [ ] `npm run lint` passes

  **QA Scenarios**:
  ```
  Scenario: Project cards show stats without client fetch
    Tool: Playwright
    Steps:
      1. Navigate to /projects
      2. Open browser DevTools Network tab
      3. Verify no requests to /api/github/stats from client-side
      4. Verify stats (stars, language) are visible on cards
    Expected Result: Stats visible, zero client-side fetch calls to stats endpoint
    Evidence: .sisyphus/evidence/task-17-server-stats-network.png
  ```

  **Commit**: YES (groups with Wave 3)

- [x] 18. Remove unused Geist_Mono font

  **What to do**:
  - Remove `Geist_Mono` import from `src/app/layout.tsx`
  - Remove `--font-geist-mono` variable from `html` className
  - Verify no CSS references to `--font-geist-mono`
  - Verify build still works

  **Must NOT do**:
  - Do NOT remove `Geist` (sans) or `JetBrains_Mono` (used in CSS)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/layout.tsx:1-49` - Font imports and usage
  - `src/app/globals.css:1-11` - Font variable references

  **Acceptance Criteria**:
  - [ ] `Geist_Mono` import removed
  - [ ] `--font-geist-mono` class removed from html
  - [ ] No references to `--font-geist-mono` in codebase
  - [ ] `npm run build` passes

  **QA Scenarios**:
  ```
  Scenario: Font removed without breaking build
    Tool: Bash
    Steps:
      1. Search codebase for "Geist_Mono" and "--font-geist-mono"
      2. Run npm run build
    Expected Result: Zero references found, build passes
    Evidence: .sisyphus/evidence/task-18-remove-font.log
  ```

  **Commit**: YES (groups with Wave 3)

- [x] 19. Fix admin page client-side fetch → server-side initial data

  **What to do**:
  - Make `src/app/admin/page.tsx` a Server Component (remove `"use client"`)
  - Pass initial `personal` and `projects` data from server component to a new client child component
  - Or: keep admin page as client but fetch data server-side in `layout.tsx` and pass via props
  - Goal: eliminate the `useEffect` + `fetch("/api/data")` pattern in admin

  **Must NOT do**:
  - Do NOT break admin interactivity (editing, adding skills, etc.)
  - Do NOT expose sensitive data

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Tasks 1-16

  **References**:
  - `src/app/admin/page.tsx:1-349` - Current admin page
  - `src/app/admin/layout.tsx:1-48` - Admin layout (server component)

  **Acceptance Criteria**:
  - [ ] Admin page receives initial data server-side (no client fetch for initial load)
  - [ ] All editing functionality still works
  - [ ] `npm run build` passes

  **QA Scenarios**:
  ```
  Scenario: Admin renders with server data
    Tool: Playwright
    Steps:
      1. Navigate to /admin
      2. Check Network tab for /api/data fetch
      3. Verify data is visible immediately (no loading spinner)
    Expected Result: No client fetch to /api/data on initial load, data visible immediately
    Evidence: .sisyphus/evidence/task-19-admin-server-data.png
  ```

  **Commit**: YES (groups with Wave 3)

- [x] 20. Fix accessibility gaps

  **What to do**:
  - `src/app/admin/page.tsx`:
    - Add `aria-label="Remove skill"` to skill remove button (line 182)
    - Add proper labels to social URL inputs (lines 202-213, not just placeholders)
    - Ensure all form inputs have associated `<label>` elements
  - `src/components/projects/ProjectList.tsx`:
    - Add `aria-pressed={activeTags.includes(tag)}` to tag toggle buttons
    - Add `aria-pressed={selectedCategory === cat.value}` to category buttons
    - Ensure filter buttons have visible focus indicators (or confirm Tailwind default)

  **Must NOT do**:
  - Do NOT change visual design
  - Do NOT add new dependencies for a11y

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/admin/page.tsx:175-215` - Skills and socials section
  - `src/components/projects/ProjectList.tsx:65-95` - Filter buttons

  **Acceptance Criteria**:
  - [ ] All form inputs have proper `<label>` associations
  - [ ] All toggle buttons have `aria-pressed`
  - [ ] Remove button has `aria-label`
  - [ ] No axe-core violations on admin and projects pages

  **QA Scenarios**:
  ```
  Scenario: Accessibility attributes present
    Tool: Bash (grep)
    Steps:
      1. grep for aria-label="Remove skill" in admin/page.tsx
      2. grep for aria-pressed in ProjectList.tsx
      3. grep for <label in admin/page.tsx
    Expected Result: All attributes found
    Evidence: .sisyphus/evidence/task-20-a11y-attributes.log
  ```

  **Commit**: YES (groups with Wave 3)

- [x] 21. Evaluate TypeScript 6 upgrade

  **What to do**:
  - Research TypeScript 6 breaking changes vs current v5
  - Check if `eslint-config-next` and other tools support TS 6
  - Run `npm install typescript@6` in a test branch
  - Run `npx tsc --noEmit` and document any new errors
  - Document findings and recommendation (upgrade now / wait / hold)

  **Must NOT do**:
  - Do NOT commit the upgrade unless it passes cleanly
  - Do NOT force fixes for new TS 6 strictness if it would bloat this plan

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: Tasks 1-20

  **References**:
  - `tsconfig.json` - Current TS config
  - `package.json` - Current TS version

  **Acceptance Criteria**:
  - [ ] Document created with findings (`.sisyphus/drafts/ts6-evaluation.md`)
  - [ ] Clear recommendation: upgrade / wait / hold

  **QA Scenarios**:
  ```
  Scenario: TypeScript 6 evaluation document exists
    Tool: Bash
    Steps:
      1. Read `.sisyphus/drafts/ts6-evaluation.md`
      2. Verify it contains: current version, latest version, breaking changes list, compatibility notes, and explicit recommendation
    Expected Result: Document exists with all required sections
    Evidence: .sisyphus/evidence/task-21-ts6-eval.log
  ```

  **Commit**: NO (evaluation only)

- [x] 22. Evaluate ESLint 10 upgrade

  **What to do**:
  - Research ESLint 10 breaking changes vs current v9
  - Check `eslint-config-next` compatibility with ESLint 10
  - Run `npm install eslint@10` in a test branch
  - Run `npm run lint` and document any new errors
  - Document findings and recommendation

  **Must NOT do**:
  - Do NOT commit the upgrade unless it passes cleanly

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: Tasks 1-20

  **References**:
  - `eslint.config.mjs` - Current ESLint config
  - `package.json` - Current ESLint version

  **Acceptance Criteria**:
  - [ ] Document created with findings (`.sisyphus/drafts/eslint10-evaluation.md`)
  - [ ] Clear recommendation: upgrade / wait / hold

  **QA Scenarios**:
  ```
  Scenario: ESLint 10 evaluation complete
    Tool: Bash
    Steps:
      1. Read evaluation document
    Expected Result: Document exists with actionable recommendation
    Evidence: .sisyphus/evidence/task-22-eslint10-eval.log
  ```

  **Commit**: NO (evaluation only)

- [x] 23. @types/node alignment evaluation

  **What to do**:
  - Check current `@types/node` (v20) vs Node 22 runtime
  - Evaluate upgrading to `@types/node@22` (matching runtime) vs `@types/node@25` (latest)
  - Document recommendation

  **Must NOT do**:
  - Do NOT upgrade without verifying no type conflicts

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: Tasks 1-20

  **References**:
  - `package.json` - Current @types/node version

  **Acceptance Criteria**:
  - [ ] Document created with findings (`.sisyphus/drafts/types-node-eval.md`)

  **QA Scenarios**:
  ```
  Scenario: @types/node evaluation complete
    Tool: Bash
    Steps:
      1. Read evaluation document
    Expected Result: Document exists with recommendation
    Evidence: .sisyphus/evidence/task-23-types-node-eval.log
  ```

  **Commit**: NO (evaluation only)

- [x] 24. Final dependency cleanup + lockfile refresh

  **What to do**:
  - Run `npm dedupe` to clean lockfile
  - Run `npm audit` to verify zero vulnerabilities
  - Verify `package-lock.json` is committed and consistent
  - Clean any unused optional dependencies if safe

  **Must NOT do**:
  - Do NOT remove manually-installed native packages needed for CI/Docker

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Tasks 1-23

  **References**:
  - `package.json` - All dependencies
  - `package-lock.json` - Lockfile

  **Acceptance Criteria**:
  - [ ] `npm audit` shows 0 vulnerabilities
  - [ ] `npm run build` passes
  - [ ] `npm run lint` passes
  - [ ] Lockfile committed

  **QA Scenarios**:
  ```
  Scenario: Clean dependency state
    Tool: Bash
    Steps:
      1. Run npm audit --audit-level=moderate
      2. Run npm run lint
      3. Run npm run build
    Expected Result: All pass cleanly
    Evidence: .sisyphus/evidence/task-24-final-cleanup.log
  ```

  **Commit**: YES (groups with Wave 4)

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + `npm run lint` + `npm audit`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Audit [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration. Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `fix(security): patch deps + owner-only auth` — package.json, auth.ts, middleware.ts, admin/layout.tsx, api routes, lib files
- **Wave 2**: `feat(validation): zod schemas + error/loading boundaries` — zod files, error.tsx, loading.tsx
- **Wave 3**: `perf: server-side stats + a11y fixes` — ProjectCard, layout, admin page, ProjectList
- **Wave 4**: `chore(deps): evaluate major upgrades` — evaluation docs
- **Wave FINAL**: `chore(review): final verification` — evidence only

---

## Success Criteria

### Verification Commands
```bash
npm audit --audit-level=moderate  # Expected: 0 vulnerabilities
npm run lint                      # Expected: PASS
npm run build                     # Expected: PASS
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] `npm audit` clean
- [ ] `npm run lint` clean
- [ ] `npm run build` clean
- [ ] All QA evidence files exist in `.sisyphus/evidence/`
