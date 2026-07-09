# Frontpage

`reidar.tech` is a trust-first Project OS: a public index of Reidar's projects, evidence, and public-safe service status, plus an owner-only content and operations workspace.

## Product surfaces

- `/` presents Reidar, current public status, flagship projects, project posture, and recent evidence.
- `/projects` provides URL-backed search, lifecycle, maturity, category, and sort controls.
- `/projects/[slug]` shows structured project scope, evidence, media, limitations, and related work.
- `/status` shows overall service condition, coarse CPU/RAM/disk history, and public checks. Signed-in owner sessions also receive exact host resources, allowlisted services/containers, attention items, and sanitized diagnostics.
- `/admin` is the owner content workspace for drafts, validation, diffs, publication receipts, and deploy state.
- `/ansible` is an owner-only read-only operations runbook. It copies commands but never executes them.

## Content authority

Published public content is repository-owned and schema-validated:

```text
content/personal.json
content/projects.json
        |
        v
src/lib/content/schema.ts
        |
        v
public pages and APIs
```

Public routes never read mutable runtime content. `src/data/*` and `src/lib/data.ts` are compatibility exports backed by the canonical JSON.

Project posture uses separate dimensions:

- Lifecycle: `active`, `maintained`, `paused`, `archived`
- Maturity: `flagship`, `stable`, `experimental`, `reference`
- Runtime health: derived from configured public checks
- Evidence: `source-reviewed`, `ci-verified`, `live-verified`
- Repository activity: optional context only; it never changes posture

## Draft, publish, and deploy

`DATA_DIR` stores owner state only:

```text
drafts/personal.json
drafts/projects.json
receipts/publication.json
```

The owner workflow is deliberately explicit:

1. Save a validated local draft.
2. Preview and review the human-readable diff.
3. Confirm publication.
4. Publish both canonical files in one non-force Git commit to `main`.
5. Keep the UI at `Awaiting deploy` until the running `VERSION` matches the published commit.
6. Deploy separately through the Ansible runbook.

Publish conflicts preserve the draft. There is no last-write-wins update and publication never triggers an Ansible deploy from the web application.

## VPS metrics boundary

The host-owned Python collector writes schema-bound `latest.json` and `history.json` on a systemd timer. The application receives those files through a read-only mount at `METRICS_DIR`.

Public status receives only:

- freshness and overall public condition
- allowlisted public service labels/status/latency
- coarse CPU/RAM/disk buckets
- public project health bindings

Exact CPU, RAM, disk, load, uptime, internal services, containers, and diagnostics are rendered only after a server-side owner check. The app receives no Docker socket, SSH capability, shell execution, restart, prune, or deploy control.

## Stack

- Next.js 16 App Router and React 19
- TypeScript and Tailwind CSS 4
- Auth.js v5 with GitHub OAuth
- Zod schemas
- Vitest
- Playwright and axe-core
- Python host metrics collector
- Docker, GHCR, and Ansible deployment

Node.js 22 is required.

## Local development

```bash
source ~/.nvm/nvm.sh
nvm use 22
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Public pages work without OAuth or metrics configuration and degrade honestly when optional signals are unavailable. Owner routes require GitHub OAuth and an owner identity.

The production GitHub OAuth callback is exactly:

```text
https://reidar.tech/api/auth/callback/github
```

Relevant runtime variables:

- `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`
- `OWNER_GITHUB_ID` (preferred) or `OWNER_EMAIL`
- `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`
- `VERSION`, `DATA_DIR`, `METRICS_DIR`
- `GITHUB_STATS_ALLOW_UNAUTHENTICATED=true` only for deliberate local experiments

Never commit or print OAuth secrets, publication tokens, vault passwords, environment dumps, or runtime drafts.

## Verification

```bash
source ~/.nvm/nvm.sh
nvm use 22
npm test
npm run lint
npx tsc --noEmit
AUTH_SECRET=dev-secret npm run build
npm run test:e2e
python3 -m unittest ops.tests.test_frontpage_metrics_collector
python3 -m py_compile ops/frontpage-metrics-collector.py
git diff --check
```

`pretest:e2e` creates ignored, synthetic, fresh metrics under `tests/e2e/.metrics` and stages the standalone output exactly as the runtime image does. The browser suite verifies public rendering at 360, 390, 768, 1024, and 1440 pixels, real project media, branded failure/auth states, owner-route denial, WCAG axe checks, and the absence of owner/raw metric markers in public HTML.

CI runs unit, lint, type, Python, production build, browser/accessibility, and Docker build gates before an image can be published.

## Deployment

Pushes to `main` build commit-addressed GHCR images after CI passes. The playbook resolves current `main` (or an explicit full `GITHUB_SHA`), pulls that immutable `sha-<commit>` tag before stopping the current container, and passes the exact commit as `VERSION`. Deployment remains a separate operator action:

```bash
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml --vault-password-file .vault_pass
```

The playbook records the prior image ID and deployed `VERSION`, replaces the container with a brief maintenance window, polls `/api/health`, and restores the previous immutable image identity if the new container fails health checks.

This README does not claim the current working tree is live. Verify the exact CI run, deployed `VERSION`, image digest/commit, and live browser/API behavior before reporting deployment success.
