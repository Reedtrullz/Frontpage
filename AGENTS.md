# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-05

## OVERVIEW
Personal portfolio and project database for reidar.tech. Next.js 16 App Router + React 19 + TypeScript + Tailwind CSS 4 + Auth.js v5. Owner-only admin panel with runtime data persistence.

## STRUCTURE
```
.
├── src/
│   ├── app/              # Next.js App Router routes
│   ├── components/       # React components (ui, home, projects, layout)
│   ├── lib/              # Data layer + GitHub integrations
│   ├── data/             # Bundled default data (personal.ts, projects.ts)
│   ├── middleware.ts     # Auth guards
│   └── auth.ts           # NextAuth config
├── public/
│   └── data/             # Runtime data JSON (persisted)
├── .github/workflows/    # CI: lint + build + Docker push to GHCR
├── ansible-playbook.yml + inventory/ + group_vars/  # VPS deployment
└── Dockerfile
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add/change page | `src/app/` | App Router pattern |
| Add/change API | `src/app/api/**/route.ts` | Standard App Router API routes |
| Edit project data | `src/data/projects.ts` | Bundled defaults; runtime edits go to `public/data/` |
| Edit personal data | `src/data/personal.ts` | Same pattern as projects |
| Change styling/theme | `src/app/globals.css` | Tailwind v4 `@theme inline` |
| Auth config | `src/auth.ts` | GitHub OAuth provider |
| Route protection | `src/middleware.ts` | Guards `/admin/*` and `/ansible` |
| GitHub stats | `src/lib/github-stats.ts` | 5min TTL in-memory cache |
| Data persistence | `src/lib/data.ts` | Reads from `DATA_DIR`, falls back to bundled defaults |
| Deployment | `ansible-playbook.yml` | Docker swap + healthcheck + rollback |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `getPersonal` | function | `src/lib/data.ts` | Read personal data with fallback |
| `getProjects` | function | `src/lib/data.ts` | Read projects with fallback |
| `savePersonal` | function | `src/lib/data.ts` | Write personal JSON to DATA_DIR |
| `saveProjects` | function | `src/lib/data.ts` | Write projects JSON to DATA_DIR |
| `fetchRepoStats` | function | `src/lib/github-stats.ts` | Fetch repo stats with caching |
| `syncToGithub` | function | `src/lib/github.ts` | Commit data changes back to repo |
| `auth` | function | `src/auth.ts` | NextAuth handler + session helper |
| `middleware` | function | `src/middleware.ts` | Redirect unauthenticated from admin |

## CONVENTIONS
- **Next.js 16 breaking changes**: APIs differ from training data. Check `node_modules/next/dist/docs/` before writing code.
- **No root `middleware.ts`**: Lives at `src/middleware.ts` instead.
- **No `tailwind.config`**: Tailwind v4 uses `@theme inline` in `globals.css`.
- **Config files use `.ts`/`.mjs`**: `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`.
- **Path alias**: `@/*` maps to `./src/*`.
- **Green/zinc dark theme**: `text-green-500`, `bg-zinc-950`, `border-zinc-800` are the palette.
- **Font stack**: Geist Sans, Geist Mono, JetBrains Mono via `next/font/google`.
- **Server Components by default**: `"use client"` only for interactivity (admin, ProjectCard, ProjectList, TypingText, Hero).

## ANTI-PATTERNS (THIS PROJECT)
- Do not expose Auth.js secrets, OAuth secrets, GitHub tokens, vault passwords, `.env` values.
- Do not claim a project is "live/deployed" without fresh CI verification and curl/browser check.
- Do not oversell experimental projects (THORArb, thor-maya-swap, Harmony Sync, codex-antigravity-auth).
- Do not suppress type errors with `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Do not add `npm test` unless a real test runner is configured.
- Admin UI and write APIs are owner-only. Never remove auth checks.

## UNIQUE STYLES
- **Runtime data versioning**: `src/lib/data.ts` invalidates cached JSON when `VERSION` env changes, then rewrites bundled defaults.
- **Project status labels**: Conservative copy. Active requires supporting evidence. Experimental stays experimental until safety gates are complete.
- **Ansible docs page**: `src/app/ansible/page.tsx` documents the deployment pipeline (unusual for an app route).
- **CI clears `public/data/*.json`**: Ensures build uses bundled defaults, not stale runtime data.

## COMMANDS
```bash
# Dev (Node 22 required)
source ~/.nvm/nvm.sh && nvm use 22
npm run dev

# Lint + build
npm run lint
npm run build

# Clean build (ignores local runtime data)
DATA_DIR="$(mktemp -d)" npm run build

# Deploy
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml --vault-password-file .vault_pass
```

## NOTES
- `public/data/` is the default `DATA_DIR`. In production, mount a persistent directory and set `VERSION`.
- GitHub stats API uses an in-memory 5-minute TTL cache. Not shared across serverless instances.
- No tests exist yet. CI job named "test" only runs lint + build.
- Dockerfile and CI both manually install Linux-native packages for Tailwind/Sharp/Rolldown.
