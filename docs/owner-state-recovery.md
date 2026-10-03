# Owner state recovery

Owner drafts, their opaque revisions and bases, publication receipts, and the bounded publication journal form one versioned private backup. Canonical public JSON, environment values, credentials, and metrics are excluded. The manifest carries an ID and a SHA-256 integrity digest. This detects accidental corruption; it is not encryption or an authenticity signature. Store backups only in an encrypted, access-controlled operator destination and verify the independent backup system before relying on it. Retention is an operator policy; retain a verified pre-migration copy through the migration and rollback window.

Build the outside-app operator tool with `npm run build:owner-tool`. Commands below run `node .owner-tool/frontpage-owner-state.mjs`. Export and verification never print record values. Local exports create a new mode-0600 file; they do not overwrite an existing backup. Filesystem restoration requires an entirely new destination and stages complete validated files before rename. The source and destination are never the active application directory during rehearsal.

```sh
node .owner-tool/frontpage-owner-state.mjs --mode file --action export --data-dir /private/operator/source-data --backup /private/operator/owner-backup.json
node .owner-tool/frontpage-owner-state.mjs --mode file --action verify --backup /private/operator/owner-backup.json
node .owner-tool/frontpage-owner-state.mjs --mode file --action restore --backup /private/operator/owner-backup.json --data-dir /private/operator/fresh-restored-data --confirm-target /private/operator/fresh-restored-data --confirm-backup BACKUP_UUID
```

Cloudflare maintenance requires a separate operator hostname, a Cloudflare Access application/service token, a distinct bearer credential, and an explicit state target ID. Configure `OWNER_OPERATOR_HOST`, `OWNER_ACCESS_TEAM` (for example `team.cloudflareaccess.com`), `OWNER_ACCESS_AUD`, `OWNER_ACCESS_SERVICE_ID` (the exact permitted service-token client ID), `OWNER_MAINTENANCE_SECRET`, and `OWNER_STATE_TARGET` as operator settings. Protect the hostname with Cloudflare Access before enabling it. The public hostname rejects maintenance paths. The handler also verifies the signed Access assertion, issuer, audience, expiry, application-token type, and user subject or pinned service identity plus the distinct credential before reading SQL state. Collector and owner-session credentials grant no maintenance access.

Restore is disabled unless `OWNER_RESTORE_ENABLED=1`. Enable it only for a planned operator recovery window with owner writes stopped. Confirm the target and backup ID, restore, compare exported readback, then disable restore and resume writes. The restore replaces only the owner-state table in one SQLite transaction. A dedicated isolated candidate must be rehearsed before production use. This branch has not configured an operator hostname or performed a live restore.

```sh
node .owner-tool/frontpage-owner-state.mjs --mode cloudflare --action export --endpoint https://OPERATOR_HOST/__operator/owner-state --expected-operator-host OPERATOR_HOST --target ISOLATED_TARGET --backup /private/operator/owner-backup.json --maintenance-secret-file /private/operator/maintenance-token --access-client-id-file /private/operator/access-id --access-client-secret-file /private/operator/access-secret
# Restore uses the same transport options plus --action restore,
# --confirm-target ISOLATED_TARGET and --confirm-backup BACKUP_UUID.
```

Legacy v1 draft envelopes remain readable and are exported without inventing their original revision. Normal draft reads migrate them to v2 under the owner-state lock. A code rollback does not roll back Durable Object SQLite contents. The older VPS volume is a separate state store and may not match current SQL drafts. Never point old v1-only code at migrated state without a verified compatible reader or an explicit, separately validated state recovery. A leftover filesystem `.owner-state.lock` after a process crash fails closed; verify all writers have stopped before an operator removes that lock.

Local tests cover file and SQLite round trips, revision preservation, malformed records, integrity failures, unknown versions, and fresh-destination protection. Production acceptance still requires configured Access, encrypted backup storage, a real isolated operator round trip, and verified readback.

Access assertion validation and the empty-subject service-token case follow [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) and [application token claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/). Configure a short operator Access session duration according to operator policy.
