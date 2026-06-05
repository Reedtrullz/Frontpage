### 2026-06-05
- `next build` briefly held a stale build process lock after the first failed type check; waiting for the lingering process to exit allowed the subsequent build to succeed.
- A clean `next build` still fails on a pre-existing type error in `src/app/api/data/personal/route.ts` (`issue.path.reduce` accumulator typing), unrelated to `src/app/error.tsx`.
- Moving GitHub stats into `ProjectCard` props initially broke `FeaturedProjects`; passing `stats={null}` there preserves build correctness without adding homepage GitHub fetching.

### 2026-06-05
- ESLint `react-hooks/error-boundaries` flags JSX returned inside `try/catch`; assign server-loaded values in the `try/catch`, then return JSX afterward.
