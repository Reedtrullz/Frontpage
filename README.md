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
npm run build
```

There is currently no `npm run test` script in `package.json`; do not report test success unless a test script is added and actually run.

## Runtime data

`src/lib/data.ts` reads data from `DATA_DIR` and falls back to bundled defaults:

- `src/data/personal.ts`
- `src/data/projects.ts`

Default local `DATA_DIR` is `public/data`. For clean verification that uses bundled source data instead of stale local runtime data, run:

```bash
DATA_DIR="$(mktemp -d)" npm run build
```

Production/runtime deployments should mount a persistent data directory and set a version value so runtime-edited data is not overwritten accidentally while bundled defaults can still be refreshed intentionally.

## Authentication and admin safety

Admin UI and write APIs are owner-only. Owner checks prefer immutable GitHub identity where configured, with login/email as explicit fallbacks. Do not expose Auth.js secrets, OAuth secrets, GitHub tokens, vault passwords, `.env` values, or any production runtime data.

## Project status labels

Project card copy is intentionally conservative:

- Nytt, RFS/RFMC, Heimdall/tcwiki, Vifty, and core portfolio infrastructure are active where the underlying project state supports that claim.
- THORArb, thor-maya-swap, Harmony Sync, and codex-antigravity-auth are labeled experimental/in-progress when safety or durability gates are still incomplete.
- Live/deployed claims require fresh CI/deploy and curl/browser verification for the exact SHA before being reported.

## Deployment note

This repository may be deployed through the configured CI/container/Ansible path, but this README does not claim the current working tree is live. Verify the exact GitHub Actions run and the live endpoint before reporting deployment success.
