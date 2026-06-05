2026-06-05: Accessibility fixes added for admin/project UI.
- Used wrapper labels plus aria-labels for unlabeled skill/social inputs.
- Added aria-pressed + focus-visible rings to filter toggles.
- Added focus handling for save/status messages with role=status/alert.

2026-06-05: Admin initial data now follows a server-wrapper/client-form pattern.
- Keep `src/app/admin/page.tsx` as the server component that calls `getPersonal()` and `getProjects()`.
- Keep interactive admin form state and save handlers in `src/app/admin/admin-client.tsx` behind a client boundary.
