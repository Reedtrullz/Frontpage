# src/lib KNOWLEDGE BASE

**Scope:** Data layer, GitHub integrations, and server-side utilities.

## OVERVIEW
Runtime data persistence with bundled-default fallback, GitHub repo stats fetching with caching, and GitHub-backed sync for admin writes.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Read/write personal or projects | `data.ts` | JSON file I/O with version invalidation |
| Fetch GitHub repo stats | `github-stats.ts` | Octokit + 5min in-memory cache |
| Sync admin edits back to repo | `github.ts` | Commits `public/data/*.json` via API |

## CONVENTIONS
- **Runtime data pattern**: `readJSON<T>` reads from `DATA_DIR` if version matches; otherwise rewrites bundled defaults.
- **Version invalidation**: `process.env.VERSION` (default `"dev"`) stored in `.data_version`. Bump to force refresh.
- **GitHub cache**: `fetchRepoStats` uses a `Map` with 5min TTL. Safe for single-instance deploys; not for serverless.
- **Auth in API routes**: Every write route checks `session?.user` explicitly. No shared API auth middleware.

## ANTI-PATTERNS
- Do not bypass version check in `readJSON` — it prevents stale runtime data from persisting across deployments.
- Do not remove auth checks from API routes that consume functions in this directory.
- Do not expose `GITHUB_TOKEN` or other secrets in client-facing code.

## NOTES
- `getOctokit()` in `github.ts` is a lazy singleton. It returns `null` when `GITHUB_TOKEN` is missing.
- `syncToGithub` base64-encodes content before calling `repos.createOrUpdateFileContents`.
