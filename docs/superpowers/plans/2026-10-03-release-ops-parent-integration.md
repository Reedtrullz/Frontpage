# Release-ops parent integration handoff

This patch set intentionally leaves `package.json`, `package-lock.json`, and `.github/workflows/ci.yml` to the parent task. Apply these integrations against the parent's final tree, then verify exact-head CI.

## CI and release integration

- Keep `NODE_VERSION` aligned with the verified local/toolchain version `22.22.3`; npm bundled with that Node release is `10.9.8` in the current local setup.
- Use the checked-in Ansible pins with `python3 -m pip install -r ops/requirements-ansible.txt` and `ansible-galaxy collection install -r ops/ansible/requirements.yml` instead of unpinned installs.
- In CI job `test`, immediately after `npm run build:cloudflare`, run `npx playwright install --with-deps chromium` if the runtime suite uses browser checks, then `npm run test:cloudflare`; keep it before the deployment gate. The runtime harness owner reports passing Node Worker, SQLite restart, auth, origin and proxy checks.
- In the existing `deploy-cloudflare` job, insert the read-only exact-domain step immediately after `Verify Worker commit`: `node scripts/verify-release.mjs --base-url https://reidar.tech --expected-sha "$GITHUB_SHA"`. Preserve the existing workers.dev check as supplementary evidence. This checks exact health identity, `/`, `/projects`, `/status`, anonymous owner denial, and all three forwarding paths.
- In job `preload`, add `actions/checkout@v7` before the SSH setup, replace `ssh-keyscan` with `RACKNERD_KNOWN_HOSTS: ${{ secrets.RACKNERD_KNOWN_HOSTS }}` and `node scripts/install-known-hosts.mjs --output "$HOME/.ssh/known_hosts"`. Add `-i "$HOME/.ssh/id_rsa" -o IdentitiesOnly=yes -o IdentityAgent=none -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$HOME/.ssh/known_hosts"` to both SSH calls. The helper fails closed and prints no key data. Populate the protected value only after independent provider/operator fingerprint verification; no key is supplied by this work.
- Deploy smoke belongs immediately after `Verify Worker commit` in `deploy-cloudflare`; require the exact current commit and do not accept a healthy workers.dev preview as evidence for `reidar.tech`.

## Lockfile and native dependency recommendations

The current lock already resolves `jose@6.2.9` and `esbuild@0.28.2`; the parent is adding both as direct dependencies to repair clean installation. Keep those exact lock resolutions and make the package/lock changes together.

The lock records the Linux amd64 and arm64 optional bindings for Lightning CSS `1.32.0`, Tailwind Oxide `4.3.2`, Rolldown `1.1.5`, and unrs resolver `1.11.1`. `sharp` resolves to `0.35.4` and libvips to `1.3.3` on both Linux architectures. The current workflow and Docker supplemental installs use older sharp/libvips pins; Docker's versions now match the lock. In the parent workflow patch, either remove the supplemental native installs after clean `npm ci --include=optional` succeeds on both architectures, or make every remaining install use the exact lock versions. Do not retain a silent second resolution path.

The Dockerfile now pins `node:22.22.3-bookworm-slim` to manifest-list digest `sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752`. Registry metadata identifies linux/amd64 and linux/arm64/v8 manifests. This is registry metadata, not proof that this branch built successfully on both architectures.

## Runtime profile and current-state commands

- `node scripts/check-environment.mjs --profile public-local` requires no owner credentials.
- Use `owner-local`, `cloudflare`, `collector`, or `rollback` to list missing variable, binding, or file names only. Values and file contents are never displayed.
- Generate a new state note with `node scripts/current-state.mjs --output <new-file>`. The command refuses to overwrite an existing file. It reports local Git identity/worktrees/source inventory only; it makes no CI or production claim.

## Recovery boundary supplied by the owner-state workstream

The parent worktree now contains `docs/owner-state-recovery.md`; retain that link when integrating these docs. Its optional Cloudflare operator is restricted to a dedicated hostname, validates the signed Access JWT including the pinned service `common_name`, requires a distinct maintenance token, and leaves restore disabled by default. This operator lane remains unconfigured and its production restore remains unverified.

## Evidence still required

- Exact-domain smoke on the newly deployed expected SHA and exact-head CI integration.
- A clean Linux amd64 and arm64 install/build after the parent's lock repair.
- Independently verified RACKNERD host-key configuration and expected-key/replacement-key SSH integration.
- A currently verified isolated Cloudflare candidate and current quota evidence before running the headroom harness. The checked-in harness is read-only and does not measure collector/write starvation or provider CPU, so it cannot by itself satisfy or close issue #55.
