2026-06-05: Kept the existing protected-route matcher and reused the Auth.js middleware wrapper; non-owner authenticated users now redirect the same way as unauthenticated users.
2026-06-05: Kept the existing message toast flow and added a separate error state only for styling/visibility, without changing the admin component structure.
2026-06-05: Preserved the public API in `src/lib/data.ts` and `src/lib/github.ts` while tightening error handling inside existing helpers only.
4. 2026-06-05: Added route-local URL scheme validation for personal/project writes only, keeping auth as the first gate and rejecting invalid schemes with field-specific 400s.
### 2026-06-05
- Keep the admin shell UI intact; only gate access before rendering children.
- Use the signin redirect for both unauthenticated users and non-owners to keep the flow consistent.
- For API mutations, deny non-owners with a 403 Forbidden JSON response instead of a redirect so callers get a clear authorization failure.
- Keep loading UI minimal in the admin route: server-rendered spinner plus `Loading...`, matching the existing green/zinc theme.
