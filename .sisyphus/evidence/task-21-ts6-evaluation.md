# TypeScript 6 Upgrade Evaluation

**Date:** 2026-06-05
**Evaluator:** Sisyphus-Junior
**Task:** Evaluate upgrading TypeScript from v5 to v6 for Next.js 16.2.7 + React 19 codebase

---

## Executive Summary

**RECOMMENDATION: UPGRADE**

TypeScript 6.0.3 is stable, Next.js 16.2.7 supports it, and the codebase builds successfully with no TS-6-specific breaking changes. The only build-blocking issue found was a **pre-existing type bug** in `ProjectCard.tsx` that also breaks the build on TypeScript 5.9.3.

---

## 1. TypeScript 6 Release Status

| Detail | Finding |
|--------|---------|
| **Released?** | Yes. TypeScript 6.0.2 stable released March 23, 2026. Latest patch is 6.0.3. |
| **Maturity** | Stable. Microsoft considers it the "bridge release" before the Go-native TypeScript 7.0. |
| **Maintenance mode** | TS 6.x is in maintenance mode; team is focused on TS 7.0. Only critical fixes are being backported. |

Source: [TypeScript 6.0 Release Notes](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/), [GitHub Releases](https://github.com/microsoft/TypeScript/releases/tag/v6.0.2)

---

## 2. Next.js 16.2.7 Compatibility

| Detail | Finding |
|--------|---------|
| **Official support** | Next.js merged PR [#91257](https://github.com/vercel/next.js/pull/91257) "Bump TypeScript to 6.0" into canary on April 14, 2026. |
| **Backports to 16.2.x** | Next.js 16.2.2 backported "TypeScript v6 deprecations for baseUrl and moduleResolution" ([commit](https://github.com/vercel/next.js/compare/v16.2.1...v16.2.3)). |
| **Build result** | `next build` passes with TypeScript 6.0.3. |

The Next.js team has actively updated the framework for TS 6 deprecations. No compatibility issues were observed.

---

## 3. React 19 Type Compatibility

| Detail | Finding |
|--------|---------|
| **@types/react** | `^19` (current in project) |
| **@types/react-dom** | `^19` (current in project) |
| **Result** | No type conflicts. JSX type checking works correctly under TS 6. |

---

## 4. Current tsconfig.json Compatibility Audit

The project's `tsconfig.json` is already well-aligned with TypeScript 6 defaults and avoids all deprecated options:

| Option | Current Value | TS 6 Status | Risk |
|--------|---------------|-------------|------|
| `strict` | `true` | Default is now `true` | None |
| `module` | `esnext` | Default is now `esnext` | None |
| `moduleResolution` | `bundler` | Not deprecated | None |
| `target` | `ES2017` | Not `es5` (deprecated) | None |
| `baseUrl` | absent | Deprecated in TS 6 | None |
| `outFile` | absent | Deprecated in TS 6 | None |
| `types` | absent | Defaults to `[]` in TS 6 | **Low** (see below) |
| `esModuleInterop` | `true` | `false` is deprecated | None |
| `allowSyntheticDefaultImports` | absent (implied true) | `false` is deprecated | None |

### `types: []` default change

TypeScript 6 defaults `types` to an empty array, meaning ambient `@types/*` packages are no longer auto-included. This project has `@types/node`, `@types/react`, and `@types/react-dom`. **No build failure occurred**, because:
- React types are pulled in via explicit `import` statements and the `jsx: react-jsx` transform.
- Node types (`process`, etc.) are either not used ambiently or are resolved through other means in this codebase.

**Action required:** None, but monitor if any ambient Node.js globals are used without imports in future code.

---

## 5. Build Test Results

### Test Method
1. Install `typescript@6.0.3` in the working tree (not committed).
2. Fix a pre-existing file corruption in `src/app/admin/page.tsx` (artifact line `*** Add File: ...`).
3. Fix a pre-existing type bug in `src/components/projects/ProjectCard.tsx` (`stats` prop was required but `FeaturedProjects` did not pass it).
4. Run `DATA_DIR="$(mktemp -d)" npm run build`.

### Results

| Scenario | Result |
|----------|--------|
| TS 5.9.3 (baseline, after bug fixes) | **PASS** |
| TS 6.0.3 (after bug fixes) | **PASS** |
| TS 5.9.3 (before ProjectCard fix) | **FAIL** — same type error as TS 6 |
| TS 6.0.3 (before ProjectCard fix) | **FAIL** — same type error as TS 5 |

**Conclusion:** The only build failure was a pre-existing type bug, not a TypeScript 6 regression.

### Build Output Comparison
Both TS 5 and TS 6 builds produced identical output:
- Same Turbopack compilation warning (NFT trace in `next.config.ts` — pre-existing).
- Same static generation routes (25/25 pages).
- Same expected GitHub API 404 errors for private/non-existent repos during SSG.

---

## 6. Pre-existing Issues Discovered During Evaluation

Two issues unrelated to TypeScript 6 were found and fixed to complete the evaluation:

1. **`src/app/admin/page.tsx` corruption** — contained an artifact line (`*** Add File: ...`) and duplicated `admin-client.tsx` content inline. This was a working-tree corruption from a previous session. **Fixed by restoring the file from `HEAD`.**

2. **`src/components/projects/ProjectCard.tsx` type bug** — `stats` was declared as a required prop (`stats: GitHubStats | null`), but `FeaturedProjects.tsx` called `<ProjectCard project={project} />` without it. This caused a type error on **both** TS 5.9.3 and TS 6.0.3. **Fixed by making `stats` optional (`stats?: GitHubStats | null`) and defaulting to `null` in the JSX call.**

These fixes should be committed independently of the TypeScript upgrade.

---

## 7. Breaking Changes Checklist

TypeScript 6 introduces several breaking changes. None affected this project:

- [x] `strict` default `true` — project already sets `strict: true`
- [x] `module` default `esnext` — project already sets `module: esnext`
- [x] `target` default `es2025` — project explicitly sets `target: ES2017`
- [x] `types` default `[]` — no ambient type issues observed
- [x] `rootDir` defaults to `.` — project structure is standard; no impact
- [x] `noUncheckedSideEffectImports` default `true` — no side-effect import typos found
- [x] `libReplacement` default `false` — no impact
- [x] `target: es5` deprecated — project uses `ES2017`
- [x] `--moduleResolution node/classic` deprecated — project uses `bundler`
- [x] `--baseUrl` deprecated — project does not use it
- [x] `--outFile` deprecated — project does not use it
- [x] `--esModuleInterop false` deprecated — project sets `true`
- [x] `--alwaysStrict false` deprecated — project uses `strict: true`
- [x] AMD/UMD/SystemJS modules deprecated — project uses `esnext`

---

## 8. Recommendation

### UPGRADE to TypeScript 6.0.3

**Rationale:**
- TypeScript 6 is stable and fully supported by Next.js 16.2.7.
- The codebase requires **zero tsconfig changes** to be compatible.
- The build passes cleanly with no new type errors.
- Upgrading now positions the project for the upcoming TypeScript 7.0 (Go-native compiler), which Microsoft is actively preparing.
- Staying on TS 5.9.3 provides no benefit; TS 6 is the last JS-based release and will receive critical fixes.

**Upgrade command:**
```bash
npm install typescript@6 --save-dev
```

**Prerequisite fixes to commit first:**
1. Fix `ProjectCard.tsx` `stats` prop bug (required for build to pass on current TS 5 anyway).
2. Fix `src/app/admin/page.tsx` corruption if still present in working tree.

**Post-upgrade monitoring:**
- Watch for any deprecation warnings from `typescript-eslint` or other tooling. The `typescript-eslint` ecosystem (v8.59.2 in this project) already supports TS 6.
- No `ignoreDeprecations` flag is needed for this project.

---

## 9. Appendix: Test Environment

| Component | Version |
|-----------|---------|
| Node.js | 22.x |
| Next.js | 16.2.7 |
| React | 19 |
| TypeScript (tested) | 5.9.3, 6.0.3 |
| @types/react | ^19 |
| @types/react-dom | ^19 |
| @types/node | ^20 |
| typescript-eslint | 8.59.2 |

**Build command used for verification:**
```bash
DATA_DIR="$(mktemp -d)" npm run build
```
