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
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml
```

The playbook:
1. Records the currently-running image (for rollback)
2. Pulls `ghcr.io/reedtrullz/frontpage:latest`
3. Stops + removes old container
4. Starts new container on port 3002 (mapped from internal 3000)
5. Polls `/api/health` until healthy (or rolls back)

### Owner-only admin environment

The admin UI, `/ansible`, and data write APIs authorize the owner using persisted GitHub identity. The playbook passes these container environment variables:

- `ADMIN_GITHUB_ID` — immutable GitHub user id. Defaults to Reedtrullz's public GitHub id (`2069259`) and can be overridden with `vault_admin_github_id`.
- `ADMIN_GITHUB_LOGIN` — GitHub login fallback. Defaults to `Reedtrullz` and can be overridden with `vault_admin_github_login`.
- `ADMIN_GITHUB_EMAIL` — optional explicit email fallback. Defaults to empty and should only be set intentionally through `vault_admin_github_email`.

### Force a specific tag
```bash
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml \
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
