# Task 1 Report: Test Runner And Owner Authorization Helper

Status: completed

Branch: `codex/frontpage-project-os-dashboard`

## Scope completed

- Added `vitest` as a dev dependency and `npm test` script in `package.json`.
- Created `vitest.config.ts` with Node environment and `@` alias support.
- Added `src/lib/authz.test.ts` first, then verified the expected RED failure.
- Implemented `src/lib/authz.ts` with `AuthzUser`, `ForbiddenError`, `isOwnerUser`, and `requireOwnerUser`.
- Replaced duplicated owner checks in:
  - `src/app/api/data/projects/route.ts`
  - `src/app/api/data/personal/route.ts`
  - `src/app/admin/layout.tsx`
  - `src/middleware.ts`

## TDD evidence

### RED

Command:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- src/lib/authz.test.ts
```

Observed result:

- Exit code: `1`
- Failure matched the brief:
  - `Error: Cannot find module './authz' imported from /Users/reidar/Projectos/Frontpage/src/lib/authz.test.ts`

### GREEN

Command:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- src/lib/authz.test.ts
```

Observed result:

- Exit code: `0`
- `Test Files  1 passed (1)`
- `Tests  4 passed (4)`

## Verification

Commands run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- src/lib/authz.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run lint
git diff --check
```

Observed results:

- Focused authz test passed: `1` file, `4` tests.
- `npm run lint` exited `0`.
- `git diff --check` produced no output.

## Files changed

- `package.json`
- `package-lock.json`
- `vitest.config.ts`
- `src/lib/authz.ts`
- `src/lib/authz.test.ts`
- `src/app/api/data/projects/route.ts`
- `src/app/api/data/personal/route.ts`
- `src/app/admin/layout.tsx`
- `src/middleware.ts`

## Notes

- `npm install --save-dev vitest` resolved to `vitest@4.1.10`; I kept the lockfile-generated version.
- No changes were made outside the task-owned files and this report file.
