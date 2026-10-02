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
