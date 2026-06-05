# ESLint 10 Upgrade Evaluation

**Date:** 2026-06-05
**Task:** Evaluate upgrading ESLint from v9 to v10 for Next.js 16.2.7 project
**Current ESLint version:** 9.39.4
**Current eslint-config-next:** 16.2.7

---

## 1. ESLint 10 Release Status

**RELEASED.** ESLint v10.0.0 was officially released on February 6, 2026. The latest version as of this evaluation is **v10.4.1** (released May 29, 2026).

- npm registry confirms: `10.4.1` is the latest stable version
- The v10.x line is the current active release

## 2. Key Breaking Changes in ESLint 10

The most impactful breaking changes for this codebase:

1. **Legacy `.eslintrc` configuration system completely removed.** Only flat config (`eslint.config.mjs`) is supported. This project already uses flat config, so this is not a blocker.
2. **Configuration file lookup behavior changed.** ESLint now searches from the directory of each linted file rather than CWD. This improves monorepo support and should not affect this project.
3. **Node.js requirements:** Requires Node.js v20.19.0, v22.13.0, or v24+. This project uses Node 22, so this is not a blocker.
4. **RuleContext API changes (CRITICAL):** Several legacy methods were removed from the `RuleContext` object:
   - `context.getFilename()` → replaced by `context.filename`
   - `context.getCwd()` → replaced by `context.cwd`
   - `context.getSourceCode()` → replaced by `context.sourceCode`
   - `context.getPhysicalFilename()` → replaced by `context.physicalFilename`

## 3. eslint-config-next 16.2.7 Compatibility

**Peer dependency declaration:** `eslint: '>=9.0.0'`

Technically, this range includes ESLint 10. However, the **underlying plugins bundled with eslint-config-next 16.2.7 are NOT compatible with ESLint 10**.

Dependencies of eslint-config-next@16.2.7:
- `eslint-plugin-react: ^7.37.0`
- `eslint-plugin-react-hooks: ^7.0.0`
- `eslint-plugin-import: ^2.32.0`
- `eslint-plugin-jsx-a11y: ^6.10.0`
- `typescript-eslint: ^8.46.0`

The installed `eslint-plugin-react@7.37.5` still uses the removed `context.getFilename()` API.

## 4. Test Results (Isolated Environment)

A temporary copy of the project was created and ESLint was upgraded to v10.4.1:

```bash
npm install eslint@10 --save-dev
```

Installation completed with peer dependency override warnings but no hard errors.

**Lint execution result: FAILURE**

```
TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function
Occurred while linting .../eslint.config.mjs
    at resolveBasedir (.../eslint-plugin-react/lib/util/version.js:31:100)
```

The lint run crashes immediately because `eslint-plugin-react` (v7.37.5, bundled with eslint-config-next 16.2.7) calls the removed `getFilename()` method.

## 5. Available eslint-config-next Versions

No stable version beyond 16.2.7 exists on npm. The only newer versions are canary builds:
- `16.3.0-canary.23` through `16.3.0-canary.41`

There is no official stable release of eslint-config-next with ESLint 10 support at this time.

## 6. Recommendation

**RECOMMENDATION: STAY on ESLint 9.x**

### Rationale:
1. ESLint 10 is released and stable, but the ecosystem (specifically `eslint-config-next` and its bundled `eslint-plugin-react`) has not caught up.
2. The lint run crashes with a hard TypeError due to removed RuleContext APIs.
3. No stable `eslint-config-next` version beyond 16.2.7 is available.
4. There are no security or critical bug-fix reasons forcing an immediate upgrade.

### Action Plan:
- **Monitor** the [Next.js GitHub repository](https://github.com/vercel/next.js) and npm for an `eslint-config-next` release that officially supports ESLint 10.
- **Re-evaluate** when `eslint-config-next` 16.3.0 (or later) stable is released.
- **Current config is safe:** The project's `eslint.config.mjs` already uses the modern flat config format, so the eventual upgrade path will be straightforward once dependencies are ready.

### If forced to upgrade before official support:
- Would require `--legacy-peer-deps` or manual overrides
- Would likely require patching or upgrading individual plugins (`eslint-plugin-react`, etc.) independently of eslint-config-next
- Not recommended for a production project

---

**Verdict:** Do not upgrade. Wait for official eslint-config-next support.
