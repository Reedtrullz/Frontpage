# @types/node Version Alignment Evaluation

**Task:** Evaluate whether `@types/node` should be upgraded from `^20` to `^22`.
**Date:** 2026-06-05
**Evaluator:** Sisyphus-Junior

---

## 1. Current State

| Item | Value |
|------|-------|
| Current `@types/node` | `^20` (package.json line 21) |
| Development Node.js version | `v22.22.3` |
| Framework | Next.js 16.2.7, React 19.2.7, TypeScript ^5 |

---

## 2. @types/node Availability & Stability

- **@types/node 22.x exists and is actively maintained.**
- Latest 22.x release at time of evaluation: `22.19.19`
- The 22.x line has received **190+ patch releases**, indicating sustained maintenance and stability.
- The 20.x line is also maintained (latest `20.19.41`), but 22.x is the current active LTS-aligned major line.

---

## 3. Node 22-Specific API Usage in Codebase

A comprehensive grep was performed for Node 22-specific APIs, including:

- `util.styleText`
- `fs.glob` / `fs.globSync`
- `assert.partialDeepStrictEqual`
- `crypto.hash`
- `sqlite` module
- `test.mock.module`
- `module.register`
- `AsyncLocalStorage.bind`
- `navigator` (global)
- `process.getBuiltinModule`
- `import.meta.resolve`
- New `Intl` APIs
- New `Array`/`Set`/`String` prototype methods

**Result: No matches found.**

The codebase does not currently use any Node 22-specific APIs. It relies on standard APIs available in both Node 20 and Node 22 (`fetch`, `Buffer.from`, `Date`, etc.).

---

## 4. Compatibility Assessment

| Factor | Assessment |
|--------|------------|
| Next.js 16 | Officially supports Node 18, 20, 22. No compatibility issues expected. |
| React 19 | Framework-agnostic; no Node version coupling. |
| TypeScript ^5 | Fully compatible with @types/node 22. |
| `@octokit/rest` | Works on Node 18+; no issues with Node 22 types. |
| `next-auth` v5 beta | Supports Node 18+; no type conflicts expected. |
| Build toolchain | No native modules or custom bindings that depend on Node 20 types. |

---

## 5. Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Type errors from API differences | Low | Low | No Node 22 APIs are used; only common APIs are touched. |
| Dependency type conflicts | Low | Low | All deps support Node 22; no known type conflicts. |
| Build breakage | Very Low | Medium | Run `npm run build` after upgrade to verify. |
| CI/Docker image mismatch | Low | Low | Dockerfile already installs Node 22; CI uses `node:22` base. |

---

## 6. Recommendation: UPGRADE

**Change `package.json`:**
```json
"@types/node": "^22"
```

**Rationale:**
1. **Alignment:** The development environment runs Node 22. `@types/node` should match the runtime to avoid type mismatches and to enable accurate IDE autocomplete for the actual Node version in use.
2. **Future-proofing:** Upgrading now prevents silent issues if a contributor later introduces a Node 22 API (e.g., `fs.glob`, `util.styleText`) while `@types/node` is still on 20.
3. **Stability:** The 22.x type line is mature (190+ releases) and follows the Node 22 LTS cycle.
4. **Low risk:** The codebase uses only common APIs; no breaking changes are expected.

**Suggested follow-up:**
- Run `npm install` to update `package-lock.json`.
- Run `npm run lint && npm run build` to verify no type regressions.
- Commit the change.

---

## 7. Verdict

| Decision | UPGRADE |
|----------|---------|
| Target version | `^22` |
| Confidence | High |
| Blocking concerns | None |
