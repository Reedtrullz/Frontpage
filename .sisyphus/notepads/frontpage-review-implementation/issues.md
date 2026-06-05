### 2026-06-05
- `next build` briefly held a stale build process lock after the first failed type check; waiting for the lingering process to exit allowed the subsequent build to succeed.
- A clean `next build` still fails on a pre-existing type error in `src/app/api/data/personal/route.ts` (`issue.path.reduce` accumulator typing), unrelated to `src/app/error.tsx`.
