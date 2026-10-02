# Cloudflare metrics v2 activation

V2 transport and readers ship disabled. V1 collection, uploads and public fallback continue. The existing v2 shadow service/database remain the source; no VPS application promotion, collector restart or epoch reset is involved.

The uploader reads only the owner manifest's referenced files plus the two public projections. It rejects partial publication, symlinks, stale/future latest data and changed snapshots. It stages gzip files by SHA-256 (1 MiB compressed, existing 512 KiB/4 MiB expanded caps), then atomically commits a complete manifest. Only missing files transfer; staging is capped at 520 files/64 MiB and each complete snapshot at 32 MiB. Failed/incomplete/out-of-order commits preserve the last complete snapshot. Public and owner readers retain their existing schemas and freshness limits. Owner route/handler checks remain independent.

The observer uploader uses systemd `LoadCredential`; do not add it to the metrics or Docker groups. Its UTC :12/:27/:42/:57 timer is separate from v1 :50 uploads and is not enabled by default. Re-read actual sampling and freshness after enabling; the schedule is not proof of sustained performance.

## Before activation

1. Independently review the activation diff and require all exact-head CI checks to pass. Merge, then require the exact merged main CI and live `/api/health` SHA. Use the clean isolated checkout and preserve dirty primary checkout/rollback assets.
2. Regenerate the installed schema-3 comparator through `ssh Racknerd-Deploy` and `sudo -n`. The real gate must pass unchanged 48-hour, completeness, divergence, mismatch and freshness thresholds. Cached JSON or elapsed time alone is insufficient.
3. From that exact clean reviewed SHA, install the v2 upload units with `FRONTPAGE_DEPLOYED_SHA=<sha> ansible-playbook -i inventory/hosts.yml ansible-cloudflare-v2-upload.yml --vault-password-file .vault_pass`. This does not enable the timer. Confirm both collectors and the original epoch/hash remain unchanged.
4. After the real gate passes, set `FRONTPAGE_V2_UPLOAD_ENABLE=1` on the same playbook invocation. It regenerates the gate before enabling uploads. This read/compare step writes only the gate receipt, including in check mode; stdout from that fresh execution is used for approval. Wait for successful complete commits; inspect unit status/journal without printing secrets. Initial historical staging may need more than one tick; no partial data becomes visible.
5. Activate through the installed uploader on the VPS, using the existing secret file and exact live Worker SHA:

   ```sh
   sudo -n env FRONTPAGE_METRICS_DIR=/var/lib/frontpage-metrics/v2-shadow \
     FRONTPAGE_UPLOAD_URL=https://frontpage.reidjoss.workers.dev \
     FRONTPAGE_UPLOAD_SECRET_FILE=/etc/frontpage-metrics/cloudflare-upload-secret \
     /usr/local/bin/frontpage-metrics-upload --v2 --activate --expected-version <full-live-sha>
   ```

   The command regenerates the gate before upload and again immediately before activation. The authenticated Worker checks schema-3 thresholds, complete 48-hour timestamps/pair count, fresh evidence/receipt, exact deployed SHA and fresh complete projections before enabling the SQL read pointer. The secret is the trusted collector boundary; receipt JSON alone is not independent host attestation.
6. Verify fresh live identity, repeated public freshness/redaction, anonymous owner denial and authenticated owner latest/series/incidents readback. Confirm timer/service operation, observer isolation, original evidence and both collectors. Activation is incomplete until this readback succeeds; do not repeat owner publication. Disable the acceptance heartbeat only after all acceptance/activation/readback steps pass.

## Rollback

Use the same installed uploader/environment with `--deactivate` to disable the SQL v2 read pointer. Existing v1 uploads and fallback remain available; retain v2 collection, database, uploads, historical evidence, staging and backups for diagnosis. Never use `FRONTPAGE_VPS_ROLLBACK=1` for this path. Worker rollback assets remain independently available.

Storage limits and atomicity are grounded in the [Cloudflare SQLite limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [synchronous storage transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync).
