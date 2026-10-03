# Release verification receipt — 2026-10-03

## Fresh parent-reported live baseline

Observed approximately 16:00 UTC against `https://reidar.tech`; this snapshot was supplied by the parent. The ops worktree made no live request and no route/origin changes during this session.

| GET route | Result | Contract evidence |
|---|---:|---|
| `/api/health` | 200 | Reports deployed SHA `c45bc2a5517eb2435bea89fd4194b638fd48a96c`. |
| `/proposals` | 302 | `Location: /proposals/projects`. |
| `/proposals/projects` | 200 | HTML document with title `Projects`. |
| `/api/proposals` | 200 | JSON response. |
| `/api/agents` | 405 | `Allow: POST`; JSON body `{"detail":"Method Not Allowed"}`. |

The earlier 403 `text/plain` responses from `/proposals`, `/api/proposals`, and `/api/agents` are gone in this fresh snapshot, without changes from this ops session. This receipt is a point-in-time route observation, not proof that the updated release verifier passed all checks. Parent must rerun it read-only after the verifier change. No POST/registration request was issued.

## Source contract confirmation

The parent confirmed source at `hermes-proposals-dashboard` HEAD `48f14bdd5223d14caa7dfd272b57c03a1b2bc155`; source checkout WIP was left untouched. `main.py:1531` defines GET `/proposals` redirecting to `/proposals/projects` with 302; the GET route at line 1603 returns the Projects HTML. `/api/agents` has a POST-only route. This grounds the verifier's route-specific checks.

## Verifier contract in this branch

- `/proposals` follows at most three redirects. Each destination must stay on the exact origin and within the `/proposals` path prefix; loops, missing locations, cross-origin and off-prefix targets fail. Final response must be HTTP 200 non-empty HTML with a `Projects` title.
- `/api/proposals` remains a GET requiring 2xx JSON.
- `/api/agents` remains GET-only in the verifier and accepts either 2xx JSON or exactly HTTP 405, `Allow: POST`, and JSON containing only `{"detail":"Method Not Allowed"}`. The verifier never sends POST.
- Exact health SHA, public pages, owner-denial checks, and all unrelated rejection behavior remain enforced.

Focused verifier regressions cover the redirect contract, overlong chains, loops, cross-origin/off-prefix targets, HTML title, POST-only method response, missing/wrong `Allow`, wrong detail, and denial responses. No live provider request or release verification was made by this worktree.
