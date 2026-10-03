# Release-ops parent integration handoff

This integration is applied in the release-ops branch after merging the approved owner-foundation base. The parent should review and integrate the resulting commits, configure the protected host-key secret, and dispatch exact-head CI.

## CI and release integration

- CI pins `NODE_VERSION` to `22.22.3`; npm bundled with that Node release is `10.9.8` in the current local setup.
- The Docker `amd64`/`arm64` validation matrix also sets up that exact Node version on the runner before invoking the built-in-only image smoke checker; it does not run npm on the host.
- CI installs the checked-in Ansible pins with `python3 -m pip install -r ops/requirements-ansible.txt` and `ansible-galaxy collection install -r ops/ansible/requirements.yml`.
- CI keeps `npm run test:cloudflare` immediately after its Chromium install and `npm run build:cloudflare`; this remains ahead of release/deploy gates. The runtime harness owner reports passing Node Worker, SQLite restart, auth, origin and proxy checks.
- `deploy-cloudflare` runs the read-only exact-domain check after `Verify Worker commit`: `node scripts/verify-release.mjs --base-url https://reidar.tech --expected-sha "$GITHUB_SHA"`. The workers.dev identity check remains supplementary. The custom-domain check requires exact health identity, `/`, `/projects`, `/status`, anonymous owner denial, and successful forwarding on all three paths.
- `preload` uses `actions/checkout@v7` and installs the protected `RACKNERD_KNOWN_HOSTS` pin through `scripts/install-known-hosts.mjs`; no `ssh-keyscan` path remains. Both SSH calls select `$HOME/.ssh/id_ed25519_racknerd` and set `IdentitiesOnly=yes`, `IdentityAgent=none`, `StrictHostKeyChecking=yes`, and the generated `UserKnownHostsFile`. The helper fails closed and prints no key data. Parent reports the protected pin is already configured and its presence/readback checked; see the baseline section for the scope of its key verification.
- Deploy smoke belongs immediately after `Verify Worker commit` in `deploy-cloudflare`; require the exact current commit and do not accept a healthy workers.dev preview as evidence for `reidar.tech`.

## Lockfile and native dependency recommendations

The merged foundation declares `jose@6.2.9` and `esbuild@0.28.2` directly, and the lock resolves those exact versions. No package or lockfile mutation is needed in this integration.

The lock records the Linux amd64 and arm64 optional bindings for Lightning CSS `1.32.0`, Tailwind Oxide `4.3.2`, Rolldown `1.1.5`, and unrs resolver `1.11.1`. `sharp` resolves to `0.35.4` and libvips to `1.3.3` on both Linux architectures. The lock marks each Linux architecture package as optional with matching `os`/`cpu` metadata and exact versions. CI and Docker now use `npm ci --include=optional` without a second no-lock install path; the CI matrix will build and smoke both architectures. This source-level lock proof does not replace the pending remote Linux build results.

The Dockerfile now pins `node:22.22.3-bookworm-slim` to manifest-list digest `sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752`. Registry metadata identifies linux/amd64 and linux/arm64/v8 manifests. This is registry metadata, not proof that this branch built successfully on both architectures.

## Runtime profile and current-state commands

- `node scripts/check-environment.mjs --profile public-local` requires no owner credentials.
- Use `owner-local`, `collector`, or `rollback` to list missing variable/file names only. For Cloudflare, use `node scripts/check-environment.mjs --profile cloudflare --wrangler-config wrangler.jsonc`; it inspects `FRONTPAGE`'s DO binding and SQLite migration. Without the config it reports that check as unverified and fails closed. `FRONTPAGE_SQL` is injected into the DO runtime, so a shell variable cannot satisfy the configuration check. Values and file contents are never displayed.
- Generate a new state note with `node scripts/current-state.mjs --output <new-file>`. The command refuses to overwrite an existing file. It reports local Git identity/worktrees/source inventory only; it makes no CI or production claim.

## Recovery boundary supplied by the owner-state workstream

The parent worktree now contains `docs/owner-state-recovery.md`; retain that link when integrating these docs. Its optional Cloudflare operator is restricted to a dedicated hostname, validates the signed Access JWT including the pinned service `common_name`, requires a distinct maintenance token, and leaves restore disabled by default. This operator lane remains unconfigured and its production restore remains unverified.

## Parent-reported release and SSH baseline — 2026-10-03

An earlier parent-run live check found `/api/health` at SHA `c45bc2a5517eb2435bea89fd4194b638fd48a96c` with public pages passing, but `/proposals`, `/api/proposals`, and `/api/agents` returned HTTP 403 `text/plain`. That observation is superseded by the fresh approximately 16:00 UTC receipt below: those 403s were gone without any changes from this ops session. The parent is to rerun the updated verifier read-only after this commit. No live check was made from this child worktree.

For T10/#44, retain strict route-specific success contracts: `/proposals` may follow at most three same-origin redirects staying inside its path prefix and must finish at non-empty Projects HTML; `/api/proposals` must return 2xx JSON; `/api/agents` GET may return 2xx JSON or exactly 405 with `Allow: POST` and JSON method detail. Never issue POST. Wrong/missing method headers, 403, invalid bodies, redirects outside the allowed boundary, or wrong health SHA remain release failures.

The parent confirmed the upstream contract from source HEAD `48f14bdd5223d14caa7dfd272b57c03a1b2bc155`, in `/Users/reidar/Projectos/hermes-proposals-dashboard` (its WIP was left untouched): `main.py:1531` has GET `/proposals` redirecting to `/proposals/projects` (302), whose GET route at line 1603 returns Projects HTML; `/api/agents` is POST-only. The [fresh live receipt](../../release-verification-receipt-2026-10-03.md) is parent-reported evidence, not a request performed by this worktree.

The parent reports the established trusted `Racknerd-Deploy` known-hosts key matches the server sudo public-key fingerprint `SHA256:jqrn83QeSlKz9fTXj7Tilyjn7m5Dy8IGx+slNFpn8ow`; the protected `RACKNERD_KNOWN_HOSTS` secret exists and its presence/readback was checked. With the explicit identity/options, the expected pin passed and a wrong pin exited 255 before authentication. The [separate host-pin receipt](../../ssh-host-pin-receipt-2026-10-03.md) records this evidence. No fresh provider-console fingerprint was obtained, so do not describe this as a provider-console re-verification or key rotation.

The parent also reports daily GraphQL totals through 14:35 UTC of 15,991 Worker requests and 15,995 Durable Object requests, and a distinct preview namespace. This request/day observation does not prove full-period quota headroom. Subscription lookup returned 403, so plan/budget remains unresolved. A reported current DO duration value of 6,810 has unknown units; Worker CPU 186 ms and active time 53 billion ns are point observations, not monthly quota proof. The parent is still checking storage/GB-second quotas and actual request allowance. No external provider request or measurement was made from this child worktree.

The parent reports `ansible-core==2.21.2`, `community.docker==5.2.1`, and `ansible.posix==2.2.2` installed, with syntax checks passing for all four playbooks. This parent-run validation is separate from the source-level CI workflow regression tests in this branch.

## Evidence still required

- Exact-domain smoke on the newly deployed expected SHA and exact-head CI integration.
- Exact-head Linux amd64 and arm64 clean install/build and Docker smoke results from CI.
- For T29/#55, parent first verifies fresh bindings for `frontpage-do-preview`, `frontpage-migration-preview`, or a dedicated `frontpage-headroom-*` Worker, with distinct DO/storage, isolated collector token, and a synthetic owner session. Prefer a newly created isolated candidate; this worktree makes no provider/resource calls. Then capture current Worker/DO CPU and quota observations plus an authorized request allowance in the evidence files described in `DEPLOYMENT.md`; the run budget must fit the observed quota and be explicitly coordinated. The script performs no network request until these evidence inputs, exact allowlisted origin, protected credential files, and coordination flags validate.
- The mixed harness first performs two counted setup requests: exact-SHA `/api/health` GET and authenticated `/__collector/v1/capabilities` GET, which must advertise atomic v1 generations. Each steady-state writer then PUTs gzip `latest.json`, gzip `history.json`, and `/__collector/v1/commit`, carrying the same `X-Frontpage-Generation` digest on every write. It counts a generation complete only after commit succeeds. Workload mix is 80% public, 15% owner and 5% complete collector writes at concurrency 1/2/4. The hard cap is 2,000 including both setup requests and all writes; 182 is the minimum for one full cycle per stage. Stages are paced across their requested budget (maximum 60 seconds), and actual elapsed duration is reported without rounding up. Writer transactions share a five-second deadline. Reports include category-specific parent-approved p95 targets/results, partial/failed writes and starvation. CPU/quota are supplied from current provider observability, never inferred. Run only after parent coordination; mock tests are not provider evidence and do not close #55.
