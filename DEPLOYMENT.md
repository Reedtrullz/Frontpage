# Frontpage Deployment Guide

## Architecture

```
Main push → GitHub CI checks → exact-commit Cloudflare Worker deploy
                                     ↓
                reidar.tech → forwarding Worker → SQLite Durable Object
                                     ↑
          VPS metrics uploader; protected proposals origin

CI also publishes an immutable GHCR image for an intentional VPS rollback.
```

The VPS remains a collector host, protected proposals origin, and rollback target.

## Cloudflare Free migration

`npm run build:cloudflare` uses OpenNext. The forwarding Worker serves static assets and sends application requests to a SQLite Durable Object, where SSR and owner draft/receipt storage run. The direct OpenNext Worker exceeded the Free HTTP CPU limit; verify forwarding Worker and Durable Object CPU separately in observability. The named Worker is `frontpage.reidjoss.workers.dev`.

The DO stores compressed copies of `latest.json` and `history.json`, uploaded once per minute by the existing VPS collector host. The upload route accepts only those two names, requires `COLLECTOR_UPLOAD_SECRET`, and enforces compressed and expanded size caps. Public/owner metric filtering and schema validation remain in the application. The v2 collector remains in shadow mode; do not promote or delete it as part of this migration.
The latest shadow-gate report supplied on 3 October 2026 had 20.367 hours of the required 48-hour window, 0.01362769% public-service mismatches against a required 0%, and one historic incomplete v2 minute. This evidence is not an activation approval. Do not activate v2 or restart a collector to reset the window; preserve the current epoch and follow the [v2 activation runbook](docs/cloudflare-v2-activation.md) only after a newly generated gate is approved.

The forwarding Worker passes `/proposals`, `/api/proposals`, and `/api/agents` to `PROPOSALS_ORIGIN` at `proposals-origin.reidar.tech`. `ansible-cloudflare-proposals-origin.yml` installs a private Caddy snippet with an exact token and path matcher; anonymous direct requests receive 403. The VPS reverse SSH tunnel to the local dashboard remains a separate dependency. Rotate the 1Password variable and Worker secret together, then rerun that playbook.

### Production operation

Main CI builds and deploys the named `frontpage` Worker after its checks pass, then verifies `/api/health.version` equals the commit SHA. `reidar.tech` is its Worker custom domain. The repository has `FRONTPAGE_CLOUDFLARE_DEPLOY_ENABLED=1` and `FRONTPAGE_VPS_DEPLOY_ENABLED=0`; the production GitHub environment holds the scoped Cloudflare deployment token. Worker secrets and the collector upload token come from the Cloudflare 1Password Environment. Rotate the repository-scoped GitHub publication token before its 2026-12-28 expiry.

After each main release, compare `gh api repos/Reedtrullz/Frontpage/branches/main --jq .commit.sha` with `curl -fsS https://reidar.tech/api/health`, check public and owner routes, proposals forwarding, and fresh `/status` samples. Inspect forwarding Worker and Durable Object CPU separately; short samples do not prove monthly Free quota fit.

`ansible-cloudflare-collector.yml` maintains the VPS uploader and, with `FRONTPAGE_MARK_CLOUDFLARE_PRIMARY=1` and `FRONTPAGE_DEPLOYED_SHA=<live full Worker SHA>`, switches v1/v2 health checks to the Worker, clears the retired app allowlist, starts a new 48-hour shadow comparison epoch when topology changes, and writes `/etc/frontpage/cloudflare-primary`. Both collectors, their data, the protected proposals origin, and the reverse tunnel remain. The former app container and apex Caddy block are retired; `/backups/Caddyfile.pre-frontpage-retire-20260929`, `/backups/frontpage_data.pre-cloudflare-20260928.tar.gz`, the `frontpage_data` volume, and `frontpage:cloudflare-rollback-20260929` remain for rollback.

## Prerequisites

### Local (control node)
- Ansible: `brew install ansible`
- SSH alias `Racknerd-Deploy` with the dedicated key and `IdentityAgent none`
- Frontpage vault password file at `.vault_pass` (ignored by git, `0600`)

### VPS (managed node)
- Docker
- GHCR pull credentials — `docker login ghcr.io -u Reedtrullz --password-stdin`
- Caddy import for the token-protected `proposals-origin.reidar.tech` vhost
- UFW + fail2ban (already configured)

## VPS rollback only

The former apex Caddy block is preserved in `/backups/Caddyfile.pre-frontpage-retire-20260929`. Restore that exact block and the prior proxied VPS A record only for an intentional rollback. The protected proposals-origin import must stay in place.

The previous app proxy was:

```
reidar.tech {
    reverse_proxy localhost:3002
}
```

Validate Caddy before reloading it. Restore the known-good image with a full SHA and the explicit rollback flag:

```bash
FRONTPAGE_VPS_ROLLBACK=1 GITHUB_SHA=948b3e7567ba1d53bb1ecab1f2ad604d1605a222 \
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml \
  --vault-password-file .vault_pass
```

If a local checkout has migrated this vault to the shared password file, first
verify it can decrypt `group_vars/all/vault.yml`:

```bash
ansible-vault view group_vars/all/vault.yml --vault-password-file ~/.vault_pass.txt >/dev/null
```

The VPS rollback playbook:
1. Records the currently-running image (for rollback)
2. Resolves a full commit SHA and pulls `ghcr.io/reedtrullz/frontpage:sha-<full-sha>`
3. Stops + removes old container
4. Starts new container on port 3002 (mapped from internal 3000)
5. Polls `/api/health` until healthy (or rolls back)
6. Verifies the running image tag and `VERSION` both match the requested full SHA

## Verify production

```bash
curl -fsS https://reidar.tech/api/health | jq
curl -fsS -o /dev/null -w '%{http_code}\n' https://reidar.tech/
curl -fsS -o /dev/null -w '%{http_code}\n' https://reidar.tech/api/proposals
ssh Racknerd-Deploy 'systemctl is-active frontpage-metrics-collector.timer frontpage-metrics-upload.timer frontpage-metrics-collector-v2-shadow.service'
```


## Release identity and operator preflight

After a Cloudflare deployment finishes, verify the exact expected full commit and the intended custom domain:

```bash
node scripts/verify-release.mjs \
  --base-url https://reidar.tech \
  --expected-sha "$GITHUB_SHA"
```

The bounded, read-only smoke checks `/api/health`, `/`, `/projects`, `/status`, anonymous owner metrics denial, and `/proposals`, `/api/proposals`, and `/api/agents` forwarding. A successful workers.dev preview alone does not establish the custom-domain release identity.

The proposals-origin contract is read-only: `/proposals` may redirect up to three times, only to same-origin paths under `/proposals`, and must finish at non-empty HTML titled `Projects`. `/api/proposals` must return 2xx JSON. `/api/agents` is GET-verified: accept either 2xx JSON or exactly HTTP 405 with `Allow: POST` and JSON `{"detail":"Method Not Allowed"}`; never POST as part of release verification. Missing/wrong `Allow`, other error responses, cross-origin/off-prefix redirects, and redirect loops fail. See the [2026-10-03 release receipt](docs/release-verification-receipt-2026-10-03.md) for the parent-reported current baseline and its source evidence.

For a Cloudflare Worker code rollback, first identify the previously accepted Worker version and its source SHA. From this checkout, run `npx wrangler rollback <VERSION_ID> --name frontpage` with the scoped Cloudflare credentials, then repeat the exact-domain smoke using that version's full source SHA. Cloudflare's version rollback preserves external resources and Durable Object state; it does not restore old SQL data. Follow the separate [v2 activation runbook](docs/cloudflare-v2-activation.md) to deactivate the v2 read pointer with the authenticated collector uploader's `--deactivate` operation when that read contract itself must be disabled. This is a separate action from Worker rollback and from restoring VPS owner state. See the [owner-state recovery runbook](docs/owner-state-recovery.md) for versioned backup/restore, state-target confirmation, and the optional Cloudflare operator transport.

### Runtime environment profiles

The environment checker prints missing names and profile only; it never prints values:

```bash
node scripts/check-environment.mjs --profile public-local
node scripts/check-environment.mjs --profile owner-local
node scripts/check-environment.mjs --profile cloudflare --wrangler-config wrangler.jsonc
node scripts/check-environment.mjs --profile collector
FRONTPAGE_VAULT_PASSWORD_FILE=.vault_pass node scripts/check-environment.mjs --profile rollback
```

The Cloudflare profile reads secret names from the shell but does not expect `FRONTPAGE_SQL` there: the Durable Object entry injects that runtime SQL handle. Pass `--wrangler-config` to verify the `FRONTPAGE` Durable Object binding and its SQLite migration. Without an inspected config the command reports this as unverified and exits unsuccessfully; a shell variable named `FRONTPAGE_SQL` cannot satisfy the configuration check.

A public-local profile intentionally needs no owner secrets. `FRONTPAGE_SQL` is injected by the DO entry from its SQLite storage and cannot be supplied by a local shell export; the checked Wrangler config must bind `FRONTPAGE` and declare the SQLite class migration. The collector profile checks the configured secret-file path is readable without reading or printing its contents.

To preserve existing notes, generate a state inventory only at a new destination:

```bash
node scripts/current-state.mjs --output docs/generated/frontpage-state-$(date -u +%Y%m%dT%H%M%SZ).md
```

The report covers local branch/SHA/dirty count, registered worktrees and selected source paths. It does not query CI or production.

### SSH host identity for retained VPS operations

CI must load the operator-verified public host key from protected `RACKNERD_KNOWN_HOSTS` using `scripts/install-known-hosts.mjs`; live `ssh-keyscan` output must never establish trust. The value must contain one key for `198.23.137.16` and must be independently verified before it is configured. Keep `StrictHostKeyChecking=yes`, `IdentitiesOnly=yes`, `IdentityAgent=none`, and `UserKnownHostsFile` pointed at that generated file. For a planned rotation, verify the replacement fingerprint through the provider/operator channel first, review the old and new fingerprints, then replace the protected pin. This work does not supply a replacement key.

### Toolchain pins

Docker uses the Node 22.22.3 Bookworm slim manifest digest recorded in the Dockerfile. Install Ansible from `ops/requirements-ansible.txt` and `ops/ansible/requirements.yml` so local validation and CI can use the same exact versions. The Linux native packages must match `package-lock.json`; the lock records exact optional package versions and `os`/`cpu` selectors for both supported architectures. CI and Docker install from that lock with `npm ci --include=optional`; CI builds and smoke-tests amd64 and arm64 independently. The CI integration details and remaining remote evidence are in [the release-ops handoff](docs/superpowers/plans/2026-10-03-release-ops-parent-integration.md).

### Cloudflare headroom evidence

`scripts/measure-cloudflare-headroom.mjs` implements a bounded mixed-workload harness for issue #55. **Do not run it until the parent has verified the preview Worker bindings, distinct Durable Object/storage, synthetic owner session, isolated collector credential, current account quota, and authorized request allowance, and explicitly coordinated the run.** It refuses `reidar.tech`, its subdomains, and the production `frontpage.reidjoss.workers.dev` origin. Only the verified `frontpage-do-preview`, `frontpage-migration-preview`, or a freshly inspected dedicated `frontpage-headroom-*` Worker is accepted in the isolation evidence. Prefer a new isolated headroom Worker over overwriting an existing preview; the harness itself creates no Cloudflare resources.

Every live invocation requires all of these preconditions before the first request: `FRONTPAGE_BENCHMARK_ISOLATED_APPROVED=1`, `FRONTPAGE_BENCHMARK_COORDINATED=1`, an exact `FRONTPAGE_BENCHMARK_ALLOWED_ORIGIN`, non-secret budget reference, configured request cap, fresh provider observability evidence, fresh origin-matched preview-binding evidence, and a non-secret coordination reference. Provider evidence must contain actual observed Worker CPU ms, Durable Object CPU ms, account quota name/used/limit/unit, and an operator-authorized request allowance no greater than observed remaining quota. Those values are copied to the report; the harness does not infer CPU or account headroom. Evidence must be no older than 15 minutes. Missing, stale, insufficient, or mismatched evidence prevents network access.

The provider evidence JSON shape is:

```json
{
  "observedAt": "<UTC timestamp from current provider observability>",
  "source": "<dashboard or API source name>",
  "workerCpuMs": 0,
  "durableObjectCpuMs": 0,
  "quota": {
    "name": "Workers requests",
    "used": 0,
    "limit": 100000,
    "unit": "requests/month",
    "authorizedRequestBudget": 182
  }
}
```

The isolation evidence file must bind the exact allowed origin to an inspected preview Worker and explicitly attest production-resource separation, a distinct Durable Object, an isolated collector secret, and a synthetic owner session. It contains no credentials:

```json
{
  "observedAt": "<UTC timestamp from the bindings inspection>",
  "source": "Wrangler preview bindings inventory",
  "origin": "https://<verified-preview-host>",
  "candidateWorker": "frontpage-headroom-<unique-name>",
  "candidateDurableObjectNamespace": "<preview DO namespace identity>",
  "productionDurableObjectNamespace": "<production DO namespace identity>",
  "candidateCollectorSecretBinding": "COLLECTOR_UPLOAD_SECRET",
  "productionWorker": "frontpage",
  "productionResourcesExcluded": true,
  "distinctDurableObjectFromProduction": true,
  "isolatedCollectorSecret": true,
  "syntheticOwnerSession": true
}
```

Replace example CPU/quota values with measurements actually read from current provider observability. The sample values above are shape examples only and never benchmark evidence.

The two global setup requests are an anonymous `/api/health` GET that proves the exact candidate SHA and an authenticated `GET /__collector/v1/capabilities` that must advertise `{schema_version:1,atomic_generations:true}`. Both count against the total request cap and happen before stage traffic. The steady-stage mix is 80% public GETs, 15% authenticated owner GETs, and 5% collector writes at concurrency 1/2/4; setup preflights are reported separately from those mix percentages. One logical synthetic v1 generation is exactly three PUTs: gzip `latest.json`, gzip `history.json`, then `/__collector/v1/commit`. Each PUT carries the same `X-Frontpage-Generation` SHA-256 of the uncompressed latest bytes, NUL, then history bytes. The locally validated schema-v1 pair has the same new monotonic timestamp. Writers serialize the complete atomic triplet, and a generation counts completed only after the commit returns 204. The shared write deadline is five seconds and also bounded by the 60-second stage deadline. Failed history or commit operations are reported as incomplete generations. Stage requests are paced across the requested stage duration; each report contains the time actually measured and the configured maximum, so an early end never claims a full 60 seconds.

The hard cap is 2,000 HTTP requests total, including both setup preflights and every generation triplet. At least 182 requests are needed for one 60-request mixed cycle at each of the three concurrency levels plus setup. Each stage can run for at most 60 seconds. Supply parent-approved p95 threshold targets for public, owner, collector-request, and complete generation latency; the generation target cannot exceed five seconds. Threshold provenance, targets, measured p95 values and per-category outcomes are reported. Do not invent targets: missing target evidence blocks the run. Supply owner-cookie and collector-bearer values only through separate regular files with mode `0400` or `0600`; their values never enter the JSON report. Example invocation after the parent has prepared evidence and coordinated the run:

```bash
FRONTPAGE_BENCHMARK_ISOLATED_APPROVED=1 \
FRONTPAGE_BENCHMARK_COORDINATED=1 \
FRONTPAGE_BENCHMARK_ALLOWED_ORIGIN=https://<verified-preview-host> \
FRONTPAGE_BENCHMARK_BUDGET_REFERENCE='<current quota evidence reference>' \
FRONTPAGE_BENCHMARK_MAX_REQUESTS=182 \
node scripts/measure-cloudflare-headroom.mjs \
  --base-url https://<verified-preview-host> \
  --expected-sha <full-candidate-sha> \
  --max-requests 182 \
  --stage-seconds 60 \
  --owner-cookie-file <0400-or-0600-owner-cookie-file> \
  --collector-token-file <0400-or-0600-preview-collector-token-file> \
  --provider-evidence-file <current-provider-observability.json> \
  --isolation-evidence-file <verified-preview-bindings.json> \
  --latency-targets-file <parent-approved-thresholds.json> \
  --coordination-reference <parent-coordination-reference>
```

The JSON result reports exact SHA, both preflights, steady-stage request mix/counts, measured stage duration versus its budget, public/owner/collector/generation latency and category thresholds, HTTP/network/deadline failures, partial and completed writes, queued writer starvation, generation hashes, and supplied actual provider CPU/quota evidence. It does not make a keep/change decision automatically: provider measurements, storage/decompression cost, correctness/privacy, and account-plan fit still require operator review. Tests use mocked fetch only; no provider measurement is implied by local regressions.

## VPS metrics collector

Frontpage v1 ships a host collector installed by Ansible:

- `/usr/local/bin/frontpage-metrics-collector`
- `/etc/frontpage-metrics/config.json`
- `/var/lib/frontpage-metrics/v1/latest.json`
- `/var/lib/frontpage-metrics/v1/history.json`
- `frontpage-metrics-collector.service`
- `frontpage-metrics-collector.timer`

The collector service runs as `frontpage-metrics` with supplementary `docker`
group access for its remaining host inventory. The Cloudflare-primary config
checks `https://reidar.tech/api/health`, has no Frontpage internal service or
app container entry, and uploads snapshots to the Worker. The site has no
Docker socket or host filesystem mount.

### Optional service response checks

Services without a `check` retain the status-only contract: the collector makes
a no-redirect `GET` with the configured bounded timeout and compares the
response status to `expected_status`. An explicit `http-status` check preserves
that same behavior. The owned Frontpage `/api/health` entries additionally
require this bounded JSON assertion:

```json
"check": {
  "type": "json-field",
  "path": ["status"],
  "expected": "healthy"
}
```

Only `http-status` and `json-field` check types are accepted. A `json-field`
path contains one to three simple field names, its expected value is a string
of at most 80 characters, and the collector reads at most 64 KiB before
parsing JSON. A non-matching field, malformed JSON, or unreadable response
marks the service down. External services remain status-only unless Frontpage
owns and explicitly configures their response contract.

Metrics store only each service's configured public label/visibility, status,
check time, bounded latency, and optional project slug. They never include a
response body, target URL, exception text, parser details, or diagnostics.

Verify on the VPS:

```bash
ssh Racknerd-Deploy 'systemctl is-active frontpage-metrics-collector.timer frontpage-metrics-upload.timer'
ssh Racknerd-Deploy 'sudo -n test -s /var/lib/frontpage-metrics/v1/latest.json && sudo -n test -s /var/lib/frontpage-metrics/v1/history.json'
curl -fsS https://reidar.tech/status
```

Non-claim: `/api/health` remains app-health only; host status is surfaced by
the dashboard and `/status`.

## Observability collector v2 shadow mode

Ansible installs Collector v2 beside v1 before any promotion:

- Service account: `frontpage-observer`, with no supplementary groups and no Docker access.
- Shadow projections: `/var/lib/frontpage-metrics/v2-shadow/{public,owner}`.
- Private working database: `/var/lib/frontpage-metrics/private/metrics-v2-shadow.sqlite3`.
- Collector package deploys copy an explicit tracked `.py` manifest. Local
  bytecode caches are removed on the host and cannot reset the shadow evidence
  epoch; tracked source additions, changes, and removals still reset it.
- Runtime map: `/run/frontpage-metrics/runtime-map.json`, generated only from the repository allowlist and exact container facts supplied by Ansible.
- Service: `frontpage-metrics-collector-v2-shadow.service`.

The `public` and `owner` projection directories have ordinary permission bits
`0750` plus the Linux setgid bit (`2750`). Setgid is required so atomic temp
files created by `frontpage-observer` inherit the read-only
`frontpage-metrics` group without adding the observer account to that group.
Projection files are `0640`. The private directory is
`frontpage-observer:frontpage-observer` and `0700`.

During an intentional VPS rollback, the app receives only the dedicated v1 directory:

```text
/var/lib/frontpage-metrics/v1 -> /metrics:ro
```

Neither `v2-shadow`, `private`, nor the SQLite database is mounted into the
rollback container. The Cloudflare Worker receives v1 snapshots through the
authenticated uploader. VPS app promotion is a separate rollback-era deployment after the 48-hour comparison
gate. It switches the collector to `/var/lib/frontpage-metrics/v2`, mounts
only `v2/public` at `/metrics-public:ro` and `v2/owner` at
`/metrics-owner:ro`, and sets `PUBLIC_METRICS_DIR` and `OWNER_METRICS_DIR`.

Verify shadow mode on the VPS:

```bash
ssh Racknerd-Deploy 'systemctl is-active frontpage-metrics-collector.timer frontpage-metrics-collector-v2-shadow.service'
ssh Racknerd-Deploy 'id -nG frontpage-observer'
ssh Racknerd-Deploy "sudo -n stat -c '%a %U %G %n' /var/lib/frontpage-metrics/v2-shadow/public /var/lib/frontpage-metrics/v2-shadow/public/latest.v2.json /var/lib/frontpage-metrics/private"
```

Expected evidence:

- Both v1 timer and v2 shadow service are `active`.
- `id -nG frontpage-observer` does not include `docker` or `frontpage-metrics`.
- Projection directories report `2750`; projection files report `640` and group `frontpage-metrics`; private reports `700`.
- The runtime allowlist and current runtime map contain no retired Frontpage
  app entry. The Cloudflare-primary collector playbook backs up the old configs.

Shadow operation is not promotion. A running v2 service does not prove the
48-hour divergence gate, owner UI activation, public redaction, or production
v2 mounts.

### Host-only shadow comparison and VPS rollback promotion

For Cloudflare-primary collector maintenance, use the existing clean worktree
at the exact reviewed commit. This updates collector sources, the comparator,
Cloudflare health-check configs and aligned units without restoring the VPS app
or replacing the installed upload secret:

```bash
FRONTPAGE_COLLECTOR_MAINTENANCE=1 \
FRONTPAGE_DEPLOYED_SHA=$(git rev-parse HEAD) \
ansible-playbook -i inventory/hosts.yml ansible-cloudflare-collector.yml \
  --vault-password-file ~/.vault_pass.txt
```

Both collectors acquire independent samples on UTC `:00/:15/:30/:45` slots.
V1 runs continuously, supervised by its retained timer, and publishes a minute
mean for CPU, RAM and disk with the last service state, matching v2's minute
projection. The one-shot v1 command remains a preflight snapshot and cannot
contribute acceptance evidence. Partial, late, duplicate and warmup samples
remain failed evidence. A changed source/config/unit starts a new host-clock
epoch after a 60-second warmup; an unchanged maintenance run preserves it.
Archive the previous epoch, gate, histories and a consistent SQLite backup
before deploying a collection repair. Do not delete the live database.
V1 keeps one HTTP/container check per minute, now on the `:45` host sample
that matches v2's last service observation; it does not increase public probe
volume to collect the four host readings.

The comparison may continue on the host. Its VPS application promotion steps
below require an intentional rollback and do not promote the Cloudflare Worker.

The v1 collector keeps its app-facing `history.json` capped at 1,440 samples
and writes a separate host-only `comparison-history.json` capped at 4,320
minute samples. The app never reads the comparison file. Generate the gate
artifact with:

```bash
sudo /usr/local/bin/frontpage-metrics-shadow-compare \
  --v1-history /var/lib/frontpage-metrics/v1/comparison-history.json \
  --v2-database /var/lib/frontpage-metrics/private/metrics-v2-shadow.sqlite3 \
  --projection-root /var/lib/frontpage-metrics/v2-shadow \
  --evidence-epoch /var/lib/frontpage-metrics/shadow-evidence-epoch.json \
  --output /var/lib/frontpage-metrics/shadow-gate.json
```

Ansible creates the host-only evidence epoch when collector code, comparator
logic, configuration, or systemd units change. It preserves the marker on
web-only deploys. The comparator evaluates the latest rolling 48-hour window
after that epoch, so a collector or comparison change cannot reuse older
evidence. Incomplete host rows are unavailable evidence rather than parser
errors and are counted as missed minutes.

An operator can deliberately discard a contaminated window without deleting
host files by deploying once with
`FRONTPAGE_OBSERVABILITY_RESET_EVIDENCE=1`. This starts a new epoch without
restarting an otherwise healthy collector. Evidence reset and promotion are
mutually exclusive in one deployment.

The resulting gate artifact uses schema version 3. Approval requires 48
continuous hours, evidence no older than 120 seconds, no
paired-sample gap above 120 seconds, zero missed or incomplete host minutes,
p99 relative divergence below 2% for CPU, RAM, and disk capacity, and zero
mismatches or missing entries across public service states. The artifact also
records the epoch, window bounds, evidence age, paired and missed minutes,
database size, and projection size. A valid but non-approved comparison exits
with status 2; malformed inputs still fail operationally.
The comparator excludes the still-open UTC minute, requires four valid CPU
intervals and host readings in each closed minute, rejects duplicate v1 minute
records, and treats matching unknown service states as unavailable evidence.

Promotion is a separate exact-SHA invocation and requires both the generated
artifact and an explicit operator acknowledgment:

```bash
GITHUB_SHA=<full-40-character-sha> \
FRONTPAGE_OBSERVABILITY_V2_PROMOTE=1 \
OBSERVABILITY_V2_SHADOW_GATE=approved \
FRONTPAGE_VPS_ROLLBACK=1 \
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml \
  --vault-password-file .vault_pass
```

Promotion stops and disables the shadow service, seeds and starts
`frontpage-metrics-collector-v2.service`, mounts only `v2/public` and
`v2/owner` read-only, and enables `FRONTPAGE_OBSERVABILITY_V2=1`. The SQLite
database and `private/` directory are never mounted. Ansible fails promotion
when the on-host comparison artifact does not independently satisfy every
gate, even if the acknowledgment environment variable is present.

`FRONTPAGE_OBSERVABILITY_V2_PROMOTE=1` is a one-time transition input, not the
steady-state mode selector. After promotion, Ansible derives v2 activation from
the enabled state of `frontpage-metrics-collector-v2.service`. Ordinary later
deployments therefore retain the promoted app mounts and cannot re-enable the
shadow collector. Rollback remains deliberately v1-first and explicitly stops
the promoted collector before restoring shadow operation.

The active and shadow units intentionally use the same private
`metrics-v2-shadow.sqlite3` database and are mutually exclusive. Reusing that
file preserves the history that passed the gate; only the projection output
directory changes from `v2-shadow` to `v2`.

Feature rollback remains v1-first. A failed promoted application stops the
active v2 service, restores the prior image with only `/metrics:ro`, and
restarts the shadow collector. Losing newly accumulated promoted v2 history
during break-glass rollback is acceptable and must be reported explicitly.

## Rollback

Automatic: the playbook captures the previous image identity before swapping,
restores it if the new health check fails, and verifies that the restored
container becomes healthy before reporting rollback.

Break-glass manual rollback should still use Ansible so the production
environment, data volume, metrics mount, supplementary metrics group, and
health checks remain identical to a normal deployment. Use the full commit SHA
of the last known-good image; short SHA tags are not published:
```bash
GITHUB_SHA=<previous-full-40-character-sha> \
FRONTPAGE_VPS_ROLLBACK=1 \
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml \
  --vault-password-file .vault_pass
```

## Troubleshooting

**Container unhealthy:**
```bash
ssh deploy@198.23.137.16 "docker logs --tail 100 frontpage"
ssh deploy@198.23.137.16 "docker exec frontpage wget -qO- localhost:3000/api/health"
```

**GHCR auth on VPS:**
```bash
ssh deploy@198.23.137.16
echo "$GHCR_PAT" | docker login ghcr.io -u Reedtrullz --password-stdin
```

**Ansible can't reach VPS:**
```bash
ansible -i inventory/hosts.yml vps -m ping
```
