# Frontpage Deployment Guide

## Architecture

```
Local push → GitHub → CI workflow (lint, build, publish)
                              ↓
                   GHCR: ghcr.io/reedtrullz/frontpage:latest + :sha-<short>
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
2. Pulls `ghcr.io/reedtrullz/frontpage:latest`
3. Stops + removes old container
4. Starts new container on port 3002 (mapped from internal 3000)
5. Polls `/api/health` until healthy (or rolls back)

### Force a specific tag
```bash
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml \
  --vault-password-file .vault_pass \
  -e "docker_image=ghcr.io/reedtrullz/frontpage:sha-<short-sha>"
```

## Verify

```bash
# Container status
ssh deploy@198.23.137.16 "docker ps --filter name=frontpage --format '{{.Status}} {{.Image}}'"

# Health endpoint
curl -s https://reidar.tech/api/health | jq

# Homepage
curl -s -o /dev/null -w "%{http_code}\n" https://reidar.tech
```

## VPS metrics collector

Frontpage v1 ships a host collector installed by Ansible:

- `/usr/local/bin/frontpage-metrics-collector`
- `/etc/frontpage-metrics/config.json`
- `/var/lib/frontpage-metrics/latest.json`
- `/var/lib/frontpage-metrics/history.json`
- `frontpage-metrics-collector.service`
- `frontpage-metrics-collector.timer`

The collector service runs as `frontpage-metrics` with supplementary `docker`
group access so it can inspect the static allowlist. The Frontpage app
container does not receive Docker socket access; it only reads
`/metrics/latest.json` and `/metrics/history.json` through a read-only bind
mount.

Verify on the VPS:

```bash
ssh deploy@198.23.137.16 "systemctl is-active frontpage-metrics-collector.timer"
ssh deploy@198.23.137.16 "sudo systemctl start frontpage-metrics-collector.service && sudo test -s /var/lib/frontpage-metrics/latest.json"
ssh deploy@198.23.137.16 "docker exec frontpage test -r /metrics/latest.json"
ssh deploy@198.23.137.16 "docker exec frontpage sh -lc '! touch /metrics/write-test'"
```

Non-claim: `/api/health` remains app-health only; host status is surfaced by
the dashboard and `/status`.

## Rollback

Automatic: the playbook captures the previous image hash before swapping and
restores it if the health check fails.

Manual:
```bash
ssh deploy@198.23.137.16
docker stop frontpage && docker rm frontpage
docker run -d --name frontpage --restart unless-stopped \
  -p 127.0.0.1:3002:3000 \
  -e NODE_ENV=production -e PORT=3000 -e HOSTNAME=0.0.0.0 \
  ghcr.io/reedtrullz/frontpage:sha-<previous-short-sha>
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
