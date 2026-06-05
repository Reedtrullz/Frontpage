2026-06-05: Middleware owner gating should mirror `src/auth.ts` exactly: GitHub ID first, then email fallback, both guarded by env vars.
2026-06-05: Admin save handlers should guard `res.ok` before parsing JSON and always reset `saving` in `finally` so the UI cannot get stuck.
2026-06-05: `src/lib/data.ts` should treat JSON parse failures as recoverable runtime-data corruption and fall back to bundled defaults instead of crashing reads.
2026-06-05: `src/lib/github.ts` works best with per-file error handling and contextual logs so auth, rate limit, and network issues are distinguishable.
5. 2026-06-05: Write-route URL checks should happen after auth and use scheme-only validation so stored XSS vectors like javascript: are blocked without changing read paths.
### 2026-06-05
- In server layouts, narrow `session?.user` into a local `user` variable before owner checks so TypeScript accepts later renders.
- Owner gating in admin layout should mirror `auth.ts`: GitHub ID first, email fallback, then redirect non-owners to `/api/auth/signin`.
- API write routes should keep the existing `session?.user` gate, then mirror `auth.ts` owner allowlisting before touching request bodies.
- API write routes should mirror the owner check used in auth/middleware: require session user, then compare OWNER_GITHUB_ID and OWNER_EMAIL before any mutation.
- API write routes should return 403 Forbidden for authenticated non-owners, matching the owner-only policy used elsewhere.
