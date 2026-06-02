# Frontpage

Personal portfolio and project database for reidar.tech.

## What it does

- Public portfolio/project cards.
- GitHub-backed project metadata.
- Auth-protected owner-only admin editing.
- Runtime data volume for admin-edited personal/project data.
- Docker/GHCR/Ansible deployment.

## Security note

Admin UI and write APIs are owner-only. Do not expose `GITHUB_TOKEN`, vault passwords, Auth.js secrets, OAuth secrets, or any `.env` values.

Owner checks use persisted GitHub identity from Auth.js sessions. Prefer immutable `ADMIN_GITHUB_ID`; `ADMIN_GITHUB_LOGIN` and `ADMIN_GITHUB_EMAIL` are fallbacks and should be configured intentionally.

## Local development

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm install
npm run dev
```

## Verification

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm run lint
npm run test
npm run build
```

## Deployment

The production container is published through GitHub Actions/GHCR and deployed to the VPS with `ansible-playbook.yml`. Runtime-edited data is mounted at `/data` so deploys do not overwrite admin edits.

See `DEPLOYMENT.md` for the VPS, rollback, health-check, and owner-admin environment details.
