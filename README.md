# Frontpage

Personal portfolio and project database for reidar.tech.

This is the public narrative layer for the portfolio: project cards, project detail pages, GitHub-backed repository stats, and an owner-only admin surface for editing runtime personal/project data.

## What it does

- Serves curated project cards from `src/data/projects.ts`.
- Shows individual project detail pages at `/projects/[slug]`.
- Fetches GitHub repository metadata for project cards.
- Provides owner-only admin routes for personal/project data management.
- Preserves runtime-edited data in `DATA_DIR` while allowing new image versions to refresh bundled defaults.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Auth.js v5 with GitHub OAuth
- Vitest
- ESLint

## Local development

Use Node 22 in this environment:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm install
npm run dev
```

Then open `http://localhost:3000`.

Useful commands:

```bash
npm run lint
npm test
npm run build
```

## Runtime data

`src/lib/data.ts` reads data from `DATA_DIR` and falls back to bundled defaults:

- `src/data/personal.ts`
- `src/data/projects.ts`

Default local `DATA_DIR` is `public/data`. For clean verification that uses bundled source data instead of stale local runtime data, run:

```bash
DATA_DIR="$(mktemp -d)" npm run build
```

Production/runtime deployments should mount a persistent data directory and set a version value so runtime-edited data is not overwritten accidentally while bundled defaults can still be refreshed intentionally.

## VPS status dashboard

Frontpage includes a Project OS Dashboard surface:

- `/` shows the public workbench: curated project posture, public-safe service health, VPS freshness, and coarse disk/service state.
- `/status` shows public service status and, when signed in as the owner, exact VPS metrics.
- The Next.js app reads metrics from `METRICS_DIR`; it does not SSH to the host, shell out, or need privileged host access.
- The host collector writes `latest.json` and `history.json` under `/var/lib/frontpage-metrics` through a systemd timer.

Public views intentionally do not expose exact CPU, RAM, disk, load, uptime, container inventory, or internal-only service labels.

## Authentication and admin safety

Admin UI and write APIs are owner-only. Owner checks prefer immutable GitHub identity where configured, with login/email as explicit fallbacks. Do not expose Auth.js secrets, OAuth secrets, GitHub tokens, vault passwords, `.env` values, or any production runtime data.

## GitHub stats

Repository stats require `GITHUB_TOKEN` by default. This keeps clean builds and
CI from burning unauthenticated GitHub API quota. For local experiments without
a token, set `GITHUB_STATS_ALLOW_UNAUTHENTICATED=true`; the app will still fall
back safely if GitHub is unavailable or rate-limited.

## Project status labels

Project card copy is intentionally conservative:

- Nytt, RFS/RFMC, Heimdall/tcwiki, Vifty, and core portfolio infrastructure are active where the underlying project state supports that claim.
- THORArb, thor-maya-swap, Harmony Sync, and codex-antigravity-auth are labeled experimental/in-progress when safety or durability gates are still incomplete.
- Live/deployed claims require fresh CI/deploy and curl/browser verification for the exact SHA before being reported.

## Deployment note

This repository may be deployed through the configured CI/container/Ansible path, but this README does not claim the current working tree is live. Verify the exact GitHub Actions run and the live endpoint before reporting deployment success.
