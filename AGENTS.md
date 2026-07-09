# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-09

## OVERVIEW
Trust-first Project OS for reidar.tech. Next.js 16 App Router + React 19 + TypeScript + Tailwind CSS 4 + Auth.js v5. Public content is repository-owned and immutable at runtime; owner-only drafts, publication receipts, exact VPS metrics, and the read-only operations runbook are server-gated.

## STRUCTURE
```
.
|-- content/                     # Canonical published personal/project JSON
|-- src/
|   |-- app/                     # App Router pages and API routes
|   |-- components/              # Public, owner, layout, and shared UI
|   |-- lib/content/             # Schemas, drafts, admin view, publication
|   |-- lib/metrics/             # Metrics schemas, reader, public/owner models
|   |-- data/                    # Compatibility exports from canonical content
|   |-- proxy.ts                 # Owner route guards
|   `-- auth.ts                  # Auth.js GitHub configuration
|-- data/                        # Ignored runtime drafts and receipts in dev
|-- ops/                         # Host collector, config, systemd units, tests
|-- public/projects/             # Approved project media
|-- .github/workflows/ci.yml     # Test, build, browser, Docker, publish gates
|-- ansible-playbook.yml         # Immutable image deploy and rollback
`-- Dockerfile                   # Next.js standalone image
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Edit published project data | `content/projects.json` | Canonical and schema-validated |
| Edit published personal data | `content/personal.json` | Canonical and schema-validated |
| Change content schema | `src/lib/content/schema.ts` | Keep editor and migration tests aligned |
| Change draft/publication flow | `src/lib/content/` | Runtime `/data` is drafts and receipts only |
| Change public metrics | `src/lib/metrics/reader.ts` | Derived, coarse, public-safe model |
| Change owner metrics | `src/lib/metrics/status-page.ts` | Exact model only after owner auth |
| Change host collection | `ops/frontpage-metrics-collector.py` | Writes `latest.json` and `history.json` |
| Change owner auth | `src/auth.ts`, `src/lib/authz.ts`, `src/proxy.ts` | Keep route and handler checks independent |
| Change styling/theme | `src/app/globals.css` | Tailwind v4 semantic role tokens |
| Change deployment | `ansible-playbook.yml` | Exact SHA image, health check, immutable rollback |

## CODE MAP
| Symbol | Location | Role |
|--------|----------|------|
| `getCanonicalPersonal` / `getCanonicalProjects` | `src/lib/content/index.ts` | Immutable public content reads |
| `savePersonalDraft` / `saveProjectsDraft` | `src/lib/content/drafts.ts` | Atomic owner draft writes |
| `publishCanonicalContent` | `src/lib/content/publication.ts` | Non-force, two-file Git commit |
| `createGitHubPublicationClient` | `src/lib/github.ts` | Git Data API adapter |
| `readMetricsFromDir` | `src/lib/metrics/reader.ts` | Schema-bound metrics file reads |
| `createStatusPageModel` | `src/lib/metrics/status-page.ts` | Public/owner visibility split |
| `isOwnerUser` | `src/lib/authz.ts` | GitHub ID or email owner check |

## CONVENTIONS
- Next.js 16 APIs differ from older examples. Check `node_modules/next/dist/docs/` before framework changes.
- Route protection lives in `src/proxy.ts`; owner pages and write handlers also verify ownership server-side.
- Public routes read canonical `content/*.json` only. Never restore mutable public runtime overrides.
- `DATA_DIR` stores only `drafts/` and `receipts/`; `METRICS_DIR` is a read-only collector mount.
- Lifecycle, maturity, runtime health, evidence, and repository activity stay separate.
- Use semantic CSS roles from `globals.css`; status is never conveyed by color alone.
- Server Components are the default. Use client components only for interaction.

## ANTI-PATTERNS
- Never expose exact host metrics, internal services, containers, diagnostics, owner state, or secrets on public routes.
- Never remove independent auth checks from admin pages or write APIs.
- Never give the web app a shell, SSH, Docker socket, deploy, restart, or prune capability.
- Never claim a project or deployment is live without fresh CI, exact-version, and browser/API proof.
- Never oversell experimental projects or collapse posture dimensions into one status.
- Never suppress type errors with `as any`, `@ts-ignore`, or `@ts-expect-error`.

## COMMANDS
```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test
npm run lint
npx tsc --noEmit
AUTH_SECRET=dev-secret npm run build
npm run test:e2e
python3 -m unittest ops.tests.test_frontpage_metrics_collector
ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file .vault_pass
```

## NOTES
- Browser tests stage the standalone runtime and synthetic ignored metrics before launch.
- GitHub repository stats use a five-minute in-memory cache and are optional context only.
- CI publishes `latest` and full `sha-<commit>` images only after unit, type, lint, Python, browser/accessibility, and Docker gates.
- Ansible resolves current `main` unless `GITHUB_SHA` is explicitly supplied, then deploys that immutable image tag.
