# Frontpage Deployment Guide

## Architecture

```
Local push → GitHub → CI workflow (lint, build, publish)
                              ↓
                   GHCR: ghcr.io/reedtrullz/frontpage:latest + :sha-<full-commit>
                              ↓
                   ansible-playbook from local machine
                              ↓
                   VPS pulls image → swaps container → /api/health probe
                              ↓
                   Caddy proxy → https://reidar.tech
```

Same pattern as Heimdall. The VPS is a target, never a source.

## Prerequisites

### Local (control node)
- Ansible: `brew install ansible`
- SSH key at `~/.ssh/id_rsa_racknerd`
- Frontpage vault password file at `.vault_pass` (ignored by git, `0600`)

### VPS (managed node)
- Docker
- GHCR pull credentials — `docker login ghcr.io -u Reedtrullz --password-stdin`
- Caddy configured with `reidar.tech → localhost:3002`
- UFW + fail2ban (already configured)

## Caddy config (add to existing Caddyfile on VPS)

```
reidar.tech {
    reverse_proxy localhost:3002
}
```

After adding, reload: `sudo systemctl reload caddy`

## Deploy

```bash
cd /Users/reidar/Projectos/Frontpage
git pull origin main
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml \
  --vault-password-file .vault_pass
```

If a local checkout has migrated this vault to the shared password file, first
verify it can decrypt `group_vars/all/vault.yml`:

```bash
ansible-vault view group_vars/all/vault.yml --vault-password-file ~/.vault_pass.txt >/dev/null
```

The playbook:
1. Records the currently-running image (for rollback)
2. Resolves a full commit SHA and pulls `ghcr.io/reedtrullz/frontpage:sha-<full-sha>`
3. Stops + removes old container
4. Starts new container on port 3002 (mapped from internal 3000)
5. Polls `/api/health` until healthy (or rolls back)
6. Verifies the running image tag and `VERSION` both match the requested full SHA

### Deploy a specific full SHA
```bash
GITHUB_SHA=<full-40-character-sha> \
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml \
  --vault-password-file .vault_pass
```

## Verify

```bash
# Container status, image identity, and VERSION
ssh deploy@198.23.137.16 "docker inspect --format '{{.State.Status}} {{.Config.Image}} {{range .Config.Env}}{{println .}}{{end}}' frontpage"

# Health endpoint
curl -s https://reidar.tech/api/health | jq

# Homepage
curl -s -o /dev/null -w "%{http_code}\n" https://reidar.tech
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
group access so it can inspect the static allowlist. The Frontpage app
container does not receive Docker socket access; it only reads
`/metrics/latest.json` and `/metrics/history.json` through the dedicated v1
directory mounted read-only.

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
ssh deploy@198.23.137.16 "systemctl is-active frontpage-metrics-collector.timer"
ssh deploy@198.23.137.16 "sudo systemctl start frontpage-metrics-collector.service && sudo test -s /var/lib/frontpage-metrics/v1/latest.json"
ssh deploy@198.23.137.16 "docker exec frontpage test -r /metrics/latest.json"
ssh deploy@198.23.137.16 "docker exec frontpage sh -lc '! touch /metrics/write-test'"
```

Non-claim: `/api/health` remains app-health only; host status is surfaced by
the dashboard and `/status`.

## Observability collector v2 shadow mode

Ansible installs Collector v2 beside v1 before any promotion:

- Service account: `frontpage-observer`, with no supplementary groups and no Docker access.
- Shadow projections: `/var/lib/frontpage-metrics/v2-shadow/{public,owner}`.
- Private working database: `/var/lib/frontpage-metrics/private/metrics-v2-shadow.sqlite3`.
- Runtime map: `/run/frontpage-metrics/runtime-map.json`, generated only from the repository allowlist and exact container facts supplied by Ansible.
- Service: `frontpage-metrics-collector-v2-shadow.service`.

The `public` and `owner` projection directories have ordinary permission bits
`0750` plus the Linux setgid bit (`2750`). Setgid is required so atomic temp
files created by `frontpage-observer` inherit the read-only
`frontpage-metrics` group without adding the observer account to that group.
Projection files are `0640`. The private directory is
`frontpage-observer:frontpage-observer` and `0700`.

During shadow operation the app receives only the dedicated v1 directory:

```text
/var/lib/frontpage-metrics/v1 -> /metrics:ro
```

Neither `v2-shadow`, `private`, nor the SQLite database is mounted into the
container. Promotion is a separate deployment after the 48-hour comparison
gate. It switches the collector to `/var/lib/frontpage-metrics/v2`, mounts
only `v2/public` at `/metrics-public:ro` and `v2/owner` at
`/metrics-owner:ro`, and sets `PUBLIC_METRICS_DIR` and `OWNER_METRICS_DIR`.

Verify shadow mode on the VPS:

```bash
ssh deploy@198.23.137.16 "systemctl is-active frontpage-metrics-collector.timer frontpage-metrics-collector-v2-shadow.service"
ssh deploy@198.23.137.16 "id -nG frontpage-observer"
ssh deploy@198.23.137.16 "stat -c '%a %U %G %n' /var/lib/frontpage-metrics/v2-shadow/public /var/lib/frontpage-metrics/v2-shadow/public/latest.v2.json /var/lib/frontpage-metrics/private"
ssh deploy@198.23.137.16 "docker inspect --format '{{range .Mounts}}{{println .Source \"->\" .Destination}}{{end}}' frontpage"
ssh deploy@198.23.137.16 "docker exec frontpage node -e \"const fs=require('fs'); if(fs.existsSync('/metrics/private')||fs.existsSync('/metrics/v2-shadow'))process.exit(1)\""
```

Expected evidence:

- Both v1 timer and v2 shadow service are `active`.
- `id -nG frontpage-observer` does not include `docker` or `frontpage-metrics`.
- Projection directories report `2750`; projection files report `640` and group `frontpage-metrics`; private reports `700`.
- Container mounts list only the v1 directory at `/metrics`. Directory mounting
  is required so atomic collector replacements become visible without pinning
  stale file inodes.
- The runtime map is rewritten after both a successful container swap and rollback.

Shadow operation is not promotion. A running v2 service does not prove the
48-hour divergence gate, owner UI activation, public redaction, or production
v2 mounts.

### Shadow comparison and promotion

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

The resulting gate artifact uses schema version 2. Approval requires 48
continuous hours, evidence no older than 120 seconds, no
paired-sample gap above 120 seconds, zero missed or incomplete host minutes,
p99 relative divergence below 2% for CPU, RAM, and disk capacity, and zero
mismatches or missing entries across public service states. The artifact also
records the epoch, window bounds, evidence age, paired and missed minutes,
database size, and projection size. A valid but non-approved comparison exits
with status 2; malformed inputs still fail operationally.

Promotion is a separate exact-SHA invocation and requires both the generated
artifact and an explicit operator acknowledgment:

```bash
GITHUB_SHA=<full-40-character-sha> \
FRONTPAGE_OBSERVABILITY_V2_PROMOTE=1 \
OBSERVABILITY_V2_SHADOW_GATE=approved \
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml \
  --vault-password-file .vault_pass
```

Promotion stops and disables the shadow service, seeds and starts
`frontpage-metrics-collector-v2.service`, mounts only `v2/public` and
`v2/owner` read-only, and enables `FRONTPAGE_OBSERVABILITY_V2=1`. The SQLite
database and `private/` directory are never mounted. Ansible fails promotion
when the on-host comparison artifact does not independently satisfy every
gate, even if the acknowledgment environment variable is present.

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
