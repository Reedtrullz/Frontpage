### 2026-06-05
- `next build` briefly held a stale build process lock after the first failed type check; waiting for the lingering process to exit allowed the subsequent build to succeed.
