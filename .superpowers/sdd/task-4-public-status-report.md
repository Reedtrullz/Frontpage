# Task 4 Public Status Report

## Result

Recomposed `/status` for responsive scanning on `codex/public-status-readability`.

## Scope

- Tightened the status hero and main content spacing.
- Rendered the public service inventory before coarse history in the mobile document flow.
- Preserved the desktop two-column reading order: history left, inventory right.
- Kept the page server-rendered and left the owner-only status section unchanged.
- Preserved Task 3's normalized history and coverage props for every history strip.

## Browser Coverage

Added a 390px browser assertion covering:

- Fresh public status (`Operational` and the fixture's `1/1 up` result).
- Service reliability and coverage wording.
- Visible history direction labels (`24h ago` and `now`).
- Inventory appearing above history on mobile.
- No horizontal overflow and no serious axe violations at mobile and desktop widths.
- Desktop history-left/inventory-right composition.

The task brief referred to `5/5 up`, but the owned synthetic browser fixture currently contains one public check. The test therefore preserves the actual fixture contract, `1/1 up`, without changing an out-of-scope fixture.

Updated the existing coarse-history assertion to the Task 3 accessible label (`CPU pressure history: ...`), replacing the label removed by normalized timestamped history rendering.

## TDD Evidence

RED:

```bash
AUTH_SECRET=dev-secret npm run build
npm run test:e2e -- --grep "prioritizes fresh public checks before history on mobile"
```

The new assertion failed as intended: at 390px the service inventory began at y=1614 while history began at y=798.

GREEN:

```bash
AUTH_SECRET=dev-secret npm run build
npm run test:e2e -- --grep "prioritizes fresh public checks before history on mobile"
```

The focused browser run passed after the responsive ordering change.

## Final Verification

```bash
npm test
npm run lint
npx tsc --noEmit
npm run test:e2e
git diff --check
```

Results:

- Unit tests: 23 files, 127 tests passed.
- ESLint: passed.
- TypeScript: passed with no diagnostics.
- Playwright: 14 tests passed, including authenticated owner coverage.
- Diff whitespace check: passed.

## Self-Review

- Confirmed the public model still passes normalized `history` and `historyCoverage` into CPU, RAM, and Disk strips.
- Confirmed no client polling, nested cards, or public private-field rendering were introduced.
- Confirmed public redaction checks still reject exact host fields, internal service IDs, container IDs, diagnostics, and owner status.
- Confirmed the owner-only section still remains conditional on `model.ownerAttention`.
- Confirmed the intended commit contains only Task 4's page, public browser test, and this report.

## Non-Claims

- No CI, deploy, push, or production readback was performed.
