# src/lib KNOWLEDGE BASE

**Scope:** Canonical content, owner drafts/publication, metrics, authz, GitHub integrations, and server utilities.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Read canonical content | `content/index.ts` | Parses repository JSON once, returns clones |
| Change content types | `content/schema.ts` | Strict Zod schemas and posture enums |
| Read/write owner drafts | `content/drafts.ts` | Atomic files under `DATA_DIR/drafts` |
| Build owner diff/state | `content/admin-view.ts` | Canonical versus draft view model |
| Publish content | `content/publication.ts`, `github.ts` | Two blobs, one tree, one non-force commit |
| Read VPS metrics | `metrics/reader.ts` | Schema-bound latest/history reads |
| Derive status | `metrics/status-page.ts` | Public-safe and exact owner models |
| Check ownership | `authz.ts` | Prefer stable GitHub numeric ID |
| Fetch repository context | `github-stats.ts` | Optional five-minute in-memory cache |

## CONVENTIONS
- Public content never reads `DATA_DIR`; repository JSON bundled in the image is authoritative.
- Runtime persistence contains drafts and publication receipts only. Draft envelopes always include schema version, base `VERSION`, and saved timestamp.
- Publication validates both canonical files, compares the draft base to GitHub head, and updates the ref without force. Conflicts preserve drafts.
- Metrics readers return sanitized diagnostics. Public models contain coarse buckets and public allowlisted checks only; exact values stay owner-only.
- Write API routes authenticate and authorize independently of `src/proxy.ts`.
- GitHub stats failure is optional context, not project posture.

## ANTI-PATTERNS
- Do not add runtime project/personal overrides or write owner data under `public/`.
- Do not serialize exact metrics, internal service IDs, containers, or diagnostics into public models.
- Do not turn publication into deployment or add host-control capabilities to this layer.
- Do not force-update Git refs or clear drafts after a failed/conflicted publication.
- Do not expose `GITHUB_TOKEN`, Auth.js secrets, request dumps, or raw provider errors.

## NOTES
- `VERSION` is the deployed image commit identity and is part of publication conflict/deploy-state handling.
- `GITHUB_TOKEN` is server-only and currently supports both repository stats and owner publication.
- The production metrics mount is read-only; the collector, not the web app, owns Docker inspection.
