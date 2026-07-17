# Frontpage Trust and Readability Remediation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make Frontpage’s deployment, publication, runtime identity, and public project/status claims reliably truthful while simplifying the highest-friction public UI without expanding product scope.

**Architecture:** Preserve the repository-owned content boundary, physically separated public/owner metrics projections, and read-only web runtime. Fix deployment as an explicit state machine derived from durable systemd state, treat Git ref advancement as publication’s irreversible commit point, and expose the exact running revision through the existing health boundary. Public presentation changes are deliberately subtractive: use the same project set for fetched and rendered activity, expose one accessible chart summary, and remove one repetitive homepage evidence section.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod 4, Vitest, Playwright/axe, Python 3 standard library, systemd, Docker/GHCR, GitHub Actions, and Ansible.

---

## Execution Baseline and Scope

- This plan was verified against `origin/main` at `9fb7c991a6da661e92cfef8670d18c3a5994b952` on 2026-07-17.
- The current checkout, `codex/public-status-readability`, was 17 commits ahead and 18 commits behind `origin/main` during planning. Do **not** implement this plan on that divergent branch.
- Before implementation, create a clean branch from the latest `origin/main`, then copy or cherry-pick this plan into it.
- Preserve these invariants from `AGENTS.md` and `docs/superpowers/specs/2026-07-12-frontpage-observability-dashboard-v2-design.md`:
  - public routes never open owner metrics;
  - missing/stale telemetry never becomes healthy;
  - the app receives no Docker socket, shell, SSH, host control, or writable metrics mount;
  - content publication never deploys the site;
  - v2 shadow and promoted collectors may share the retained SQLite history only while remaining mutually exclusive;
  - rollback remains v1-first unless a separately reviewed design changes that contract.
- No new runtime service, database, UI framework, CSRF package, monitoring stack, or generic deployment abstraction is introduced.

## Deferred Follow-ups (Explicitly Out of Scope)

These review findings require owner decisions, external infrastructure, or consumer confirmation and must not be smuggled into this first remediation wave:

- Cloudflare/VPS firewall restriction and removal of the historic origin address.
- GitHub branch/ruleset design for direct owner publication to `main`.
- Nytt media publication; this remains blocked until the owner supplies and approves a real screenshot and caption.
- Removal of `/api/data`, `/api/github/stats`, compatibility exports, `projectHealthBySlug`, or `healthServiceIds`; verify external consumers and choose one health-binding authority in a separate deletion plan.
- Removal of legacy collector Docker-group access; do this only after promoted v2 is durably active and v1 rollback requirements are explicitly retired.
- Evidence-date/content refresh across all projects; repository-owned claims require a real owner review, not automated timestamp changes.
- Renaming status-only checks from health to reachability; first preserve the
  configured check kind in the public-safe projection so semantic checks and
  HTTP reachability are not flattened into one replacement label.
- Removing live telemetry from the global header versus request-local caching;
  this is a product/navigation decision and should not be coupled to the
  deployment heartbeat fixes.

---

## Phase 1 — Deployment and Publication Truth

### Task 1: Create a Clean Execution Branch and Record the Baseline

**Objective:** Ensure every implementation task starts from current mainline rather than the divergent readability branch.

**Files:**
- Verify: `AGENTS.md`
- Verify: `docs/superpowers/specs/2026-07-12-frontpage-observability-dashboard-v2-design.md`
- Verify: `docs/superpowers/plans/2026-07-17-frontpage-trust-readability-remediation.md`

**Step 1: Confirm the current tree is clean**

Run:

```bash
git status --short --branch
```

Expected: no modified/untracked implementation files other than this plan. Do
not stash unrelated user work. Copy the plan to an explicit transfer file
before switching:

```bash
export PLAN_TRANSFER="$(mktemp /tmp/frontpage-remediation-plan.XXXXXX)"
cp docs/superpowers/plans/2026-07-17-frontpage-trust-readability-remediation.md \
  "$PLAN_TRANSFER"
test -s "$PLAN_TRANSFER"
```

**Step 2: Refresh remote state**

Run:

```bash
git fetch origin main
git rev-parse origin/main
```

Expected: a full 40-character SHA.

**Step 3: Create the implementation branch from current main**

Run:

```bash
git switch -c codex/frontpage-trust-remediation origin/main
mkdir -p docs/superpowers/plans
cp "$PLAN_TRANSFER" \
  docs/superpowers/plans/2026-07-17-frontpage-trust-readability-remediation.md
rm "$PLAN_TRANSFER"
unset PLAN_TRANSFER
```

Expected: `Switched to a new branch 'codex/frontpage-trust-remediation'`.

**Step 4: Verify the architecture documents and plan exist on the execution branch**

Run:

```bash
test -f AGENTS.md
test -f docs/superpowers/specs/2026-07-12-frontpage-observability-dashboard-v2-design.md
test -f docs/superpowers/plans/2026-07-17-frontpage-trust-readability-remediation.md
git status --short --branch
```

Expected: all `test` commands return zero and the branch tracks `origin/main`
with only the copied plan untracked.

**Step 5: Commit the plan if it was copied into the fresh branch**

```bash
git add docs/superpowers/plans/2026-07-17-frontpage-trust-readability-remediation.md
git commit -m "docs: plan Frontpage trust remediation"
```

Expected: one documentation-only commit.

---

### Task 2: Persist the Promoted Observability Mode `[PARENT-DIRECT]`

**Objective:** Derive v2 activation from durable systemd state so an ordinary post-promotion deploy cannot restart shadow mode or remove v2 app mounts.

**Risk:** High. This task touches the deployment heartbeat and mutually exclusive collectors that share one SQLite database. Execute directly, not through a leaf subagent.

**Files:**
- Modify: `ansible-playbook.yml:39-42,584-671,724-760,791-829,1064-1125`
- Test: `ops/tests/test_frontpage_metrics_runtime_map.py:100-183`
- Modify: `DEPLOYMENT.md:142-264`

**Step 1: Add failing persistent-mode assertions**

Extend `test_ansible_keeps_shadow_v1_only_and_gates_promoted_v2_mounts` or add a sibling test with these exact assertions:

```python
def test_ansible_preserves_promoted_mode_on_ordinary_deployments(self):
    playbook = (SCRIPT.parent.parent / "ansible-playbook.yml").read_text()
    self.assertIn("Gather systemd service state for observability mode", playbook)
    self.assertIn("observability_v2_enabled", playbook)
    self.assertIn("observability_v2_promote or", playbook)
    self.assertNotIn("if observability_v2_promote else 'frontpage-metrics-collector-v2-shadow.service'", playbook)
    self.assertNotIn("if observability_v2_promote else []", playbook)
```

Also assert that both the app environment/mount decision and final identity assertions use `observability_v2_enabled`, not the one-shot promotion input.

**Step 2: Run the focused test and verify RED**

Run:

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_runtime_map.RuntimeMapGeneratorTests.test_ansible_preserves_promoted_mode_on_ordinary_deployments -v
```

Expected: FAIL because `observability_v2_enabled` and the inactive-service shutdown do not exist.

**Step 3: Gather durable systemd state before computing deployment mode**

In `pre_tasks`, after validating deployment inputs and before collector selection, add:

```yaml
    - name: Gather systemd service state for observability mode
      become: true
      ansible.builtin.service_facts:

    - name: Derive persistent observability mode
      ansible.builtin.set_fact:
        observability_v2_enabled: >-
          {{
            observability_v2_promote
            or (
              ansible_facts.services.get(
                'frontpage-metrics-collector-v2.service', {}
              ).get('status', 'disabled') == 'enabled'
            )
          }}
        observer_service_name: >-
          {{
            'frontpage-metrics-collector-v2.service'
            if (
              observability_v2_promote
              or (
                ansible_facts.services.get(
                  'frontpage-metrics-collector-v2.service', {}
                ).get('status', 'disabled') == 'enabled'
              )
            )
            else 'frontpage-metrics-collector-v2-shadow.service'
          }}
```

Remove the existing top-level `observer_service_name` expression based only on `observability_v2_promote`. Promotion remains an explicit gate for the first state transition; `observability_v2_enabled` controls all subsequent steady-state deployment behavior.

**Step 4: Make collector service transitions mutually exclusive**

- Run shadow preflight/start/evidence tasks only when `not observability_v2_enabled` (promotion-gate evidence tasks still use `observability_v2_promote`).
- Define the selected and inactive service names from
  `observability_v2_enabled`, but do not perform the first shadow-to-promoted
  transition in this task section before the candidate image is available.
- Move stop/disable-shadow, start/enable-promoted, and inactive-service
  enforcement into Task 3's rescue-protected block. The image pull must finish
  before those mutations begin.
- Keep shadow comparison, shadow projection permission checks, and the 48-hour
  gate available during the first explicit promotion before stopping shadow;
  they use `observability_v2_promote`, not the steady-state condition.
- Gate the existing “shadow isolation and output contract” assertion so a
  later steady-state v2 deployment does not incorrectly require shadow to be
  active.
- Task 3 adds this service mutation inside the protected block:

```yaml
    - name: Stop and disable the inactive observability collector
      become: true
      ansible.builtin.systemd:
        name: >-
          {{
            'frontpage-metrics-collector-v2-shadow.service'
            if observability_v2_enabled
            else 'frontpage-metrics-collector-v2.service'
          }}
        enabled: false
        state: stopped
        daemon_reload: true
```

Do not start both units even briefly after entering the protected transition.
On an ordinary deployment after promotion, the already-selected promoted unit
may remain running while the candidate image is pulled; no mode mutation is
needed before that pull.

**Step 5: Use persistent mode for app bindings and assertions**

Replace `observability_v2_promote` with `observability_v2_enabled` only where the code selects:

- `FRONTPAGE_OBSERVABILITY_V2=1`;
- `/metrics-public` and `/metrics-owner` mounts;
- selected observer service;
- promoted projection permission checks;
- v1-only versus v2 mount verification;
- deployed container identity assertions.

Keep `observability_v2_promote` for the 48-hour gate, explicit promotion seed, and first-transition evidence checks.

**Step 6: Verify both unit states, not only the selected unit**

After deployment, run `systemctl is-active` for both v2 units with `failed_when: false`, then assert exactly one is active and that it matches `observability_v2_enabled`.

**Step 7: Update the runbook**

In `DEPLOYMENT.md`, state explicitly:

- `FRONTPAGE_OBSERVABILITY_V2_PROMOTE=1` is a one-time transition input;
- after promotion, enabled systemd state keeps later deployments on v2;
- an ordinary deployment cannot re-enable shadow mode;
- rollback is still v1-first and must explicitly change collector state.

**Step 8: Run focused verification**

Run:

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_runtime_map -v
python3 -m compileall -q ops/frontpage_metrics_v2 ops/frontpage-metrics-runtime-map.py
ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file ~/.vault_pass.txt
```

Expected: all tests pass, Python compilation is silent, and Ansible reports valid syntax.

**Step 9: Manually audit the heartbeat chain**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
text = Path('ansible-playbook.yml').read_text()
for token in (
    'FRONTPAGE_OBSERVABILITY_V2',
    '/metrics-public',
    '/metrics-owner',
    'frontpage-metrics-collector-v2-shadow.service',
    'frontpage-metrics-collector-v2.service',
):
    print(f'--- {token}')
    for number, line in enumerate(text.splitlines(), 1):
        if token in line:
            print(number, line.strip())
PY
```

Expected: every steady-state app/service selection is governed by `observability_v2_enabled`; only promotion gates and transition seeding use `observability_v2_promote`.

**Step 10: Commit**

```bash
git add ansible-playbook.yml ops/tests/test_frontpage_metrics_runtime_map.py DEPLOYMENT.md
git commit -m "fix: persist promoted observability mode"
```

---

### Task 3: Make Every Destructive Deployment Failure Roll Back `[PARENT-DIRECT]`

**Objective:** Guarantee that any failure after collector-mode mutation begins
or the current container is removed enters a single v1-first rescue path.

**Risk:** High. This restructures the destructive deployment heartbeat. Change only `ansible-playbook.yml`, run the full operations suite, and inspect the rendered task order before committing.

**Files:**
- Modify: `ansible-playbook.yml:762-1129`
- Test: `ops/tests/test_frontpage_metrics_runtime_map.py`
- Modify: `DEPLOYMENT.md:58-64,266-280`

**Step 1: Add failing block/rescue structure assertions**

Add:

```python
def test_destructive_deployment_is_inside_one_rescue_boundary(self):
    playbook = (SCRIPT.parent.parent / "ansible-playbook.yml").read_text()
    pull_index = playbook.index("name: Pull exact candidate image")
    block_start = playbook.index("name: Replace and verify the Frontpage container")
    stop_shadow_index = playbook.index("name: Stop shadow collector for explicit promotion")
    seed_index = playbook.index("name: Seed promoted observability projections")
    enable_promoted_index = playbook.index("name: Enable promoted observability collector")
    transition_index = playbook.index("name: Stop and disable the inactive observability collector")
    remove_index = playbook.index("name: Stop and remove existing container")
    rescue_index = playbook.index("name: Restore the previous Frontpage deployment")
    success_index = playbook.index("name: Report deployment status")
    self.assertLess(pull_index, block_start)
    self.assertLess(block_start, stop_shadow_index)
    self.assertLess(stop_shadow_index, seed_index)
    self.assertLess(seed_index, enable_promoted_index)
    self.assertLess(enable_promoted_index, remove_index)
    self.assertLess(block_start, transition_index)
    self.assertLess(transition_index, remove_index)
    self.assertLess(block_start, remove_index)
    self.assertLess(remove_index, rescue_index)
    self.assertLess(rescue_index, success_index)
    destructive = playbook[block_start:success_index]
    self.assertIn("rescue:", destructive)
    self.assertIn("always:", destructive)
```

Also assert the old health-only tasks named `Rollback to previous image on failure` and `Fail with rollback message` no longer exist.

**Step 2: Run the focused test and verify RED**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_runtime_map.RuntimeMapGeneratorTests.test_destructive_deployment_is_inside_one_rescue_boundary -v
```

Expected: FAIL because the destructive sequence has no enclosing rescue boundary.

**Step 3: Pull before any collector or container mutation**

The candidate image pull occurs before the rescue-protected block. A pull
failure must leave the existing collector mode and container untouched and
must not invoke rollback. Move the existing first-promotion tasks that stop
shadow, seed promoted projections, and enable promoted v2 from their pre-pull
location into the beginning of the block in Step 4, preserving that exact
order. The seed must never run while shadow is active because both use
`metrics-v2-shadow.sqlite3`. Rename the existing pull task from
`Pull commit-addressed image from GHCR` to `Pull exact candidate image` so the
ordering regression test has a stable semantic anchor; Task 7 later changes
the image reference from a commit tag to a digest without renaming the task.

**Step 4: Wrap replacement and verification in one named block**

Create this outer shape and move the existing tasks without changing their internal security settings:

```yaml
    - name: Replace and verify the Frontpage container
      block:
        # Stop shadow, seed once, and enable promoted v2 on first promotion.
        # Apply steady-state selected mode and stop/disable its opposite.
        # Stop/remove current container.
        # Start candidate with the selected persistent observability mode.
        # Rebuild the runtime map.
        # Poll health and fail when status/version do not match.
        # Verify image identity, mounts, unit state, and permissions.
      rescue:
        - name: Restore the previous Frontpage deployment
          # Restore prior image with the documented v1-only environment/mounts.
        # Rebuild rollback runtime map.
        # Stop promoted collector and start shadow collector.
        # Poll rollback health and verify previous VERSION.
        - name: Report failed deployment after successful rollback
          ansible.builtin.fail:
            msg: "Deployment failed and Frontpage was restored to {{ previous_image }} ({{ previous_version }})."
      always:
        - name: Inspect final Frontpage container state
          community.docker.docker_container_info:
            name: "{{ container_name }}"
          register: final_container_state
```

Do not use `ignore_errors`. Rescue must run for a collector-transition failure
as well as a post-removal failure, and fail loudly if the previous image is
unavailable or rollback health/version verification fails.

**Step 5: Turn unhealthy candidate output into a block failure**

Keep the retrying `uri` task, then use one unconditional assertion inside the block:

```yaml
        - name: Assert candidate health and version
          ansible.builtin.assert:
            that:
              - health_check.status | default(0) == 200
              - health_check.json.status | default('') == 'healthy'
              - health_check.json.version | default('') == deploy_commit_sha
            fail_msg: "Candidate Frontpage health or VERSION verification failed."
```

This assertion must trigger `rescue` regardless of whether `previous_image` is `none`. If no previous image exists, rescue must fail with an explicit first-deploy message rather than pretending rollback occurred.

**Step 6: Verify rollback mode explicitly**

The rescue path must:

- restore `previous_image` and `previous_version`;
- use only `/metrics:ro` and omit v2 env/mounts;
- stop/disable promoted v2;
- start/enable v2 shadow;
- regenerate the runtime map for the restored container;
- assert health `status === healthy`;
- inspect the restored container and assert its `VERSION` environment entry is
  exactly `previous_version`;
- when the restored image's health response contains a `version`, assert it is
  exactly `previous_version`, but remain compatible with the immediately prior
  image version that returned only `{ "status": "healthy" }`.

**Step 7: Update deployment documentation**

Replace “rolls back when health fails” with “any task failure after current-container removal enters the same verified v1-first rescue path.” Retain the non-claim that rollback proof requires the final health/version checks.

**Step 8: Run operations verification**

```bash
python3 -m unittest discover -s ops/tests -v
ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file ~/.vault_pass.txt
git diff --check
```

Expected: all operations tests pass, Ansible syntax is valid, and `git diff --check` is silent.

**Step 9: Inspect the final task order**

```bash
ansible-playbook --list-tasks -i inventory/hosts.yml ansible-playbook.yml --vault-password-file ~/.vault_pass.txt
```

Expected: candidate replacement/verification appears within one named block, followed by rescue/always structure in source. `--list-tasks` does not execute deployment.

**Step 10: Commit**

```bash
git add ansible-playbook.yml ops/tests/test_frontpage_metrics_runtime_map.py DEPLOYMENT.md
git commit -m "fix: rescue every destructive deployment failure"
```

---

### Task 4: Treat Git Ref Advancement as Publication’s Commit Point

**Objective:** Return a truthful published result when GitHub was updated but local receipt or draft cleanup needs reconciliation.

**Files:**
- Create: `src/lib/content/mutation-lock.ts`
- Create: `src/lib/content/mutation-lock.test.ts`
- Modify: `src/lib/content/publication.ts:30-45,96-158`
- Modify: `src/app/api/data/publish/route.ts:65-77`
- Modify: `src/app/api/data/personal/route.ts:19-66`
- Modify: `src/app/api/data/projects/route.ts:21-84`
- Modify: `src/components/admin/PublishPanel.tsx:31-47`
- Test: `src/lib/content/publication.test.ts:51-150`
- Test: `src/app/api/data/routes.test.ts`

**Step 1: Add failing receipt-write reconciliation test**

First add `mutation-lock.test.ts`. Start one deferred mutation with a unique
temporary lock path, assert a second mutation rejects with
`ContentMutationBusyError`, release the first mutation, and assert a third
mutation succeeds. This proves the lock is exclusive and is released in
`finally`. Add crash-recovery tests for both production restart shapes:

- an owner record with `pid: process.pid` but an old instance UUID is reclaimed
  (Docker restarts Node as PID 1);
- an ownerless lock directory older than 30 seconds is reclaimed (crash between
  `mkdir` and owner-record write).

Then add the receipt-write test to `publication.test.ts`:

Add to `publication.test.ts`:

```ts
it("reports published when GitHub advanced but receipt storage failed", async () => {
  const dataDir = makeTempDir();
  saveProjectsDraft(getCanonicalProjects(), {
    dataDir,
    baseVersion: "abc1234",
  });
  fs.writeFileSync(path.join(dataDir, "receipts"), "not-a-directory");
  const client = fakeClient();
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  const result = await publishCanonicalContent(
    {
      personal: getCanonicalPersonal(),
      projects: getCanonicalProjects(),
      baseVersion: "abc1234",
      dataDir,
    },
    client,
  );

  expect(client.updateHead).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    kind: "published",
    commitSha: "def5678def5678def5678def5678def5678def5",
    reconciliationRequired: true,
  });
  expect(
    fs.existsSync(path.join(dataDir, "drafts", "projects.json")),
  ).toBe(true);
});
```

Do not call `readDraftBundle(dataDir)` in this test: the deliberate
`receipts`-is-a-file fixture makes receipt reads fail with `ENOTDIR`, which is
the boundary under test.

**Step 2: Add failing draft-cleanup reconciliation test**

Save a normal receipt-capable data directory, replace one draft file with a
directory after saving, and assert the receipt directly so the deliberately
invalid draft path is not parsed:

```ts
const projectsDraft = path.join(dataDir, "drafts", "projects.json");
fs.rmSync(projectsDraft);
fs.mkdirSync(projectsDraft);

expect(result).toMatchObject({
  kind: "published",
  reconciliationRequired: true,
});
expect(
  JSON.parse(
    fs.readFileSync(
      path.join(dataDir, "receipts", "publication.json"),
      "utf8",
    ),
  ),
).toMatchObject({
  kind: "published",
  commitSha: "def5678def5678def5678def5678def5678def5",
});
```

**Step 3: Run tests and verify RED**

```bash
npm test -- src/lib/content/mutation-lock.test.ts src/lib/content/publication.test.ts src/app/api/data/routes.test.ts
```

Expected: the lock module is absent and the new publication cases fail because
post-update local failures currently return `kind: "failed"`.

**Step 4: Extend the published result without adding a new publication state machine**

Use this result shape:

```ts
export type PublishCanonicalContentResult =
  | {
      kind: "published";
      commitSha: string;
      commitUrl: string;
      reconciliationRequired: boolean;
      warning?: string;
    }
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string };

const RECONCILIATION_WARNING =
  "Published to GitHub, but local publication state needs reconciliation.";
```

**Step 5: Split remote publication from local reconciliation**

Create one cross-process mutation boundary in `mutation-lock.ts` using an
atomically created lock directory under `os.tmpdir()`. The directory contains
the owner PID and a module-instance UUID. On `EEXIST`, reject with
`ContentMutationBusyError`; reclaim once when the owner process no longer exists,
when the same PID belongs to a new module instance, or when an ownerless lock is
older than 30 seconds. Always remove the acquired directory in `finally`.
Accept an optional lock path only for isolated tests; production callers use
the fixed default.

Use this complete shape (format to repository style):

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_LOCK_PATH = path.join(
  os.tmpdir(),
  "frontpage-content-mutation.lock",
);
const INSTANCE_ID = randomUUID();

export class ContentMutationBusyError extends Error {
  constructor() {
    super("Another content mutation is already in progress.");
    this.name = "ContentMutationBusyError";
  }
}

function errno(error: unknown): NodeJS.ErrnoException | null {
  return error instanceof Error ? (error as NodeJS.ErrnoException) : null;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errno(error)?.code === "EPERM";
  }
}

function ownerRecord(
  lockPath: string,
): { pid: number; instanceId: string } | null {
  try {
    const value = JSON.parse(
      fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"),
    ) as { pid?: unknown; instanceId?: unknown };
    return Number.isInteger(value.pid) && typeof value.instanceId === "string"
      ? { pid: value.pid as number, instanceId: value.instanceId }
      : null;
  } catch {
    return null;
  }
}

function acquire(lockPath: string, mayRecover = true): void {
  try {
    fs.mkdirSync(lockPath);
    try {
      fs.writeFileSync(
        path.join(lockPath, "owner.json"),
        `${JSON.stringify({ pid: process.pid, instanceId: INSTANCE_ID })}\n`,
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      fs.rmSync(lockPath, { force: true, recursive: true });
      throw error;
    }
  } catch (error) {
    if (errno(error)?.code !== "EEXIST") throw error;
    const owner = ownerRecord(lockPath);
    let ownerMissingAndOld = false;
    try {
      ownerMissingAndOld =
        owner === null && Date.now() - fs.statSync(lockPath).mtimeMs > 30_000;
    } catch (statError) {
      if (errno(statError)?.code === "ENOENT") {
        if (mayRecover) {
          acquire(lockPath, false);
          return;
        }
        throw new ContentMutationBusyError();
      }
      throw statError;
    }
    const samePidFromOldInstance =
      owner !== null &&
      owner.pid === process.pid &&
      owner.instanceId !== INSTANCE_ID;
    const ownerProcessGone =
      owner !== null &&
      owner.pid !== process.pid &&
      !processIsAlive(owner.pid);
    if (
      mayRecover &&
      (samePidFromOldInstance || ownerProcessGone || ownerMissingAndOld)
    ) {
      const stalePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
      try {
        fs.renameSync(lockPath, stalePath);
      } catch (renameError) {
        if (errno(renameError)?.code === "ENOENT") {
          acquire(lockPath, false);
          return;
        }
        throw renameError;
      }
      fs.rmSync(stalePath, { force: true, recursive: true });
      acquire(lockPath, false);
      return;
    }
    throw new ContentMutationBusyError();
  }
}

export async function withContentMutationLock<T>(
  action: () => Promise<T> | T,
  options: { lockPath?: string } = {},
): Promise<T> {
  const lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;
  acquire(lockPath);
  try {
    return await action();
  } finally {
    fs.rmSync(lockPath, { force: true, recursive: true });
  }
}
```

Do not log the request body or draft contents in lock errors.

After owner and request validation:

- wrap each personal/projects `PUT` and `DELETE` mutation in
  `withContentMutationLock`;
- wrap the publish route from `readDraftBundle()` through
  `publishCanonicalContent()` and its result mapping in the same lock;
- return HTTP 409 with a retryable owner-facing message when another mutation
  owns the lock;
- do not acquire the lock inside `publishCanonicalContent`; its unit tests may
  call the library directly, while the HTTP mutation boundary owns concurrency.

This prevents a newer PUT from landing between the publish snapshot and
`clearDrafts`. Do not substitute a read-then-unlink `savedAt` comparison: that
still has a check/delete race.

Then split remote publication from local reconciliation:

- Resolve `commitUrl` before calling `updateHead`.
- Keep remote preparation and `updateHead` in the existing provider-error try/catch.
- After `updateHead` resolves, never enter the pre-publication failure return path.
- Attempt `savePublishReceipt` first.
- If receipt writing fails, log only `summarizePublicationError(error)`, preserve drafts, and return published with `reconciliationRequired: true`.
- Only after receipt success, attempt `clearDrafts`.
- If cleanup fails, return the same published warning; the receipt remains authoritative.
- On complete success, return `reconciliationRequired: false`.

The post-commit implementation should follow this exact control flow:

```ts
const commitUrl = client.getCommitUrl(commitSha);
await client.updateHead(commitSha);

try {
  savePublishReceipt(receipt, input.dataDir);
} catch (error) {
  console.error("Published content receipt reconciliation failed", summarizePublicationError(error));
  return {
    kind: "published",
    commitSha,
    commitUrl,
    reconciliationRequired: true,
    warning: RECONCILIATION_WARNING,
  };
}

try {
  clearDrafts(input.dataDir);
} catch (error) {
  console.error("Published content draft reconciliation failed", summarizePublicationError(error));
  return {
    kind: "published",
    commitSha,
    commitUrl,
    reconciliationRequired: true,
    warning: RECONCILIATION_WARNING,
  };
}

return {
  kind: "published",
  commitSha,
  commitUrl,
  reconciliationRequired: false,
};
```

Place this after a remote-publication try/catch so these local catches cannot be captured by the generic `failed` branch.

**Step 6: Return the warning from the API**

For `result.kind === "published"`, include:

```ts
return NextResponse.json({
  ok: true,
  state: "awaiting-deploy",
  commitSha: result.commitSha,
  commitUrl: result.commitUrl,
  reconciliationRequired: result.reconciliationRequired,
  warning: result.warning,
});
```

**Step 7: Render a truthful client message**

Extend the parsed response type with `reconciliationRequired?: boolean` and `warning?: string`. After a successful response, show `body.warning` when reconciliation is required; otherwise keep “Published to GitHub. Deployment is still pending.” Never use “draft was preserved” for a response that includes a published commit.

**Step 8: Run focused and type verification**

```bash
npm test -- src/lib/content/mutation-lock.test.ts src/lib/content/publication.test.ts src/app/api/data/routes.test.ts
npx tsc --noEmit
npm run lint
```

Expected: all pass.

**Step 9: Commit**

```bash
git add src/lib/content/mutation-lock.ts src/lib/content/mutation-lock.test.ts src/lib/content/publication.ts src/lib/content/publication.test.ts src/app/api/data/publish/route.ts src/app/api/data/personal/route.ts src/app/api/data/projects/route.ts src/app/api/data/routes.test.ts src/components/admin/PublishPanel.tsx
git commit -m "fix: report post-publish reconciliation truthfully"
```

---

### Task 5: Require Same-Origin, JSON, Server-Confirmed Publication Intent

**Objective:** Ensure the write handler validates publication intent independently of the client checkbox.

**Files:**
- Modify: `src/app/api/data/publish/route.ts:12-20`
- Modify: `src/components/admin/PublishPanel.tsx:27-33`
- Test: `src/app/api/data/routes.test.ts:1-53`

**Step 1: Update the test harness to pass a Request**

Change the publish handler wrapper from `publish()` to:

```ts
const publishRequest = (input: RequestInit = {}) =>
  new Request("https://reidar.tech/api/data/publish", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://reidar.tech",
    },
    body: JSON.stringify({ confirmed: true }),
    ...input,
  });
```

Use `publish(publishRequest())` in the shared anonymous/non-owner cases.

Import `afterEach` from Vitest and make the configured origin explicit in the
normal test suite rather than relying on a one-off shell environment:

```ts
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_URL", "https://reidar.tech");
  ownerMock.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
});
```

**Step 2: Add failing owner validation tests**

Mock an owner session, then add tests asserting:

```ts
expect((await publish(publishRequest({
  headers: {
    "content-type": "application/json",
    origin: "https://evil.example",
  },
}))).status).toBe(403);

expect((await publish(publishRequest({
  body: JSON.stringify({ confirmed: false }),
}))).status).toBe(400);

expect((await publish(publishRequest({
  headers: {
    "content-type": "text/plain",
    origin: "https://reidar.tech",
  },
}))).status).toBe(415);
```

Mock `readDraftBundle` or keep validation before draft access so these tests do not touch real runtime files.

**Step 3: Run tests and verify RED**

```bash
npm test -- src/app/api/data/routes.test.ts
```

Expected: FAIL because `POST` accepts no request and performs no intent validation.

**Step 4: Add minimal request validation after authentication**

Change the signature to `POST(request: Request)`. After owner verification and before reading drafts:

```ts
const configuredOrigin = new URL(
  process.env.AUTH_URL ?? "http://localhost:3000",
).origin;
if (request.headers.get("origin") !== configuredOrigin) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
  return NextResponse.json({ error: "JSON required" }, { status: 415 });
}
const body = (await request.json().catch(() => null)) as
  | { confirmed?: unknown }
  | null;
if (body?.confirmed !== true) {
  return NextResponse.json(
    { error: "Publication confirmation is required." },
    { status: 400 },
  );
}
```

Do not trust `Host` or `Referer` as substitutes for exact `Origin`.

**Step 5: Send the exact client contract**

```ts
const response = await fetch("/api/data/publish", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ confirmed: true }),
});
```

The server must still reject an unconfirmed body even if a future client accidentally enables the button.

**Step 6: Run focused verification**

```bash
AUTH_URL=https://reidar.tech npm test -- src/app/api/data/routes.test.ts
npx tsc --noEmit
```

Expected: pass.

**Step 7: Commit**

```bash
git add src/app/api/data/publish/route.ts src/app/api/data/routes.test.ts src/components/admin/PublishPanel.tsx
git commit -m "fix: validate publication intent server-side"
```

---

### Task 6: Expose and Verify the Exact Running Version

**Objective:** Make `/api/health` prove process reachability and the exact `VERSION`, with no cached health response.

**Files:**
- Modify: `src/app/api/health/route.ts:1-3`
- Create: `src/app/api/health/route.test.ts`
- Modify: `tests/docker-runtime-smoke.mjs:236-249`
- Modify: `ansible-playbook.yml:892-910,1024-1046`
- Modify: `DEPLOYMENT.md:73-84,139-140`

**Step 1: Write failing route tests**

Create:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const originalVersion = process.env.VERSION;

afterEach(() => {
  if (originalVersion === undefined) delete process.env.VERSION;
  else process.env.VERSION = originalVersion;
});

describe("GET /api/health", () => {
  it("returns the exact running version without cacheability", async () => {
    process.env.VERSION = "0123456789abcdef0123456789abcdef01234567";
    const response = GET();
    await expect(response.json()).resolves.toEqual({
      status: "healthy",
      version: "0123456789abcdef0123456789abcdef01234567",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports an explicit unknown version when unset", async () => {
    delete process.env.VERSION;
    await expect(GET().json()).resolves.toEqual({
      status: "healthy",
      version: "unknown",
    });
  });
});
```

**Step 2: Run test and verify RED**

```bash
npm test -- src/app/api/health/route.test.ts
```

Expected: FAIL because the route omits version and cache headers.

**Step 3: Implement the minimal health response**

```ts
export function GET() {
  return Response.json(
    {
      status: "healthy",
      version: process.env.VERSION || "unknown",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
```

Do not add database, GitHub, metrics, disk, or third-party calls to this route.

**Step 4: Make the Docker smoke parse and compare JSON**

Replace substring matching with JSON parsing:

```js
const health = await poll("application health", async () => {
  const { response, text } = await getText(`${baseUrl}/api/health`);
  if (response.status !== 200) return null;
  const body = JSON.parse(text);
  return body.status === "healthy" && body.version === version
    ? { response, body }
    : null;
});
if (health.response.headers.get("cache-control") !== "no-store") {
  throw new Error("Health response must be no-store");
}
```

**Step 5: Require exact version for the candidate and compatible exact identity for rollback**

Add `health_check.json.version == deploy_commit_sha` to candidate assertions.
For rollback, assert the restored container environment contains exactly
`VERSION={{ previous_version }}`. If `rollback_health_check.json.version` is
defined, require it to equal `previous_version`; do not require that field from
the pre-remediation image because its health route did not expose one.

**Step 6: Update the runbook command**

Use:

```bash
curl -fsS https://reidar.tech/api/health | jq -e \
  '.status == "healthy" and (.version | test("^[a-f0-9]{40}$"))'
```

State that health proves only app reachability plus injected build identity; it does not prove host/collector health.

**Step 7: Run focused verification**

```bash
npm test -- src/app/api/health/route.test.ts
node --check tests/docker-runtime-smoke.mjs
ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file ~/.vault_pass.txt
```

Expected: pass.

**Step 8: Commit**

```bash
git add src/app/api/health/route.ts src/app/api/health/route.test.ts tests/docker-runtime-smoke.mjs ansible-playbook.yml DEPLOYMENT.md
git commit -m "feat: expose exact runtime version in health"
```

---

### Task 7: Deploy the Published Image by Digest `[PARENT-DIRECT]`

**Objective:** Bind deployment to both a full source commit and a registry content digest instead of trusting a mutable `sha-<commit>` tag.

**Risk:** High. This changes the release/deployment identity contract. It requires a real GHCR publish run before production closeout and must not be marked complete from local tests alone.

**Files:**
- Modify: `.github/workflows/ci.yml:150-188`
- Modify: `ansible-playbook.yml:8-10,45-55,762-776,1064-1072`
- Modify: `README.md:134-144`
- Modify: `DEPLOYMENT.md:58-84,238-280`
- Test: `ops/tests/test_frontpage_metrics_runtime_map.py`

**Step 1: Add failing deployment identity assertions**

Add:

```python
def test_ansible_requires_content_addressed_candidate_image(self):
    playbook = (SCRIPT.parent.parent / "ansible-playbook.yml").read_text()
    self.assertIn("FRONTPAGE_IMAGE_DIGEST", playbook)
    self.assertIn("^sha256:[a-f0-9]{64}$", playbook)
    self.assertIn("docker_image_repository }}@{{ requested_image_digest", playbook)
    self.assertNotIn('docker_image: "{{ docker_image_repository }}:sha-', playbook)
```

**Step 2: Run the focused test and verify RED**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_runtime_map.RuntimeMapGeneratorTests.test_ansible_requires_content_addressed_candidate_image -v
```

Expected: FAIL because deployment still selects the mutable commit tag.

**Step 3: Expose the build digest in CI**

Give the production build step `id: build`:

```yaml
      - name: Build and push
        id: build
        uses: docker/build-push-action@v7
```

In the workflow summary, print both:

```yaml
          echo "Commit: \`${{ github.sha }}\`" >> "$GITHUB_STEP_SUMMARY"
          echo "Digest: \`${{ steps.build.outputs.digest }}\`" >> "$GITHUB_STEP_SUMMARY"
```

Change the production build arg from `VERSION=sha-${{ github.sha }}` to `VERSION=${{ github.sha }}` and pass the same raw SHA to the published-image smoke test.

Run that smoke against the immutable output, not the discovery tag:

```yaml
      - name: Run published image smoke
        run: |
          repository="$(printf '%s' "$GITHUB_REPOSITORY" | tr '[:upper:]' '[:lower:]')"
          image="ghcr.io/${repository}@${{ steps.build.outputs.digest }}"
          node tests/docker-runtime-smoke.mjs \
            --image "$image" \
            --version "${{ github.sha }}"
```

**Step 4: Require a digest in Ansible**

Add:

```yaml
    requested_image_digest: "{{ lookup('env', 'FRONTPAGE_IMAGE_DIGEST') | default('', true) }}"
    docker_image: "{{ docker_image_repository }}@{{ requested_image_digest }}"
```

Extend input validation:

```yaml
          - requested_image_digest is match('^sha256:[a-f0-9]{64}$')
```

The digest is not secret. It must come from the successful publish job for the same `GITHUB_SHA`.

**Step 5: Keep source and image identity separate**

- `GITHUB_SHA` identifies the source and becomes `VERSION`.
- `FRONTPAGE_IMAGE_DIGEST` identifies registry content and becomes the Docker image reference.
- Verify the running container’s configured image is the digest reference and `/api/health.version` equals `GITHUB_SHA`.
- Do not infer one claim from the other.

**Step 6: Update exact operator commands**

Document:

```bash
test "$GITHUB_SHA" = "$(git rev-parse origin/main)"
printf '%s\n' "$FRONTPAGE_IMAGE_DIGEST" | grep -Eq '^sha256:[a-f0-9]{64}$'
GITHUB_SHA="$GITHUB_SHA" \
FRONTPAGE_IMAGE_DIGEST="$FRONTPAGE_IMAGE_DIGEST" \
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml \
  --vault-password-file ~/.vault_pass.txt
```

The operator sets both variables from the same completed mainline CI run
before executing these checks; the plan does not substitute illustrative
values for release evidence.

Keep `sha-<commit>` and `latest` tags for discovery only; remove wording that calls tags immutable.

**Step 7: Run local verification**

```bash
python3 -m unittest ops.tests.test_frontpage_metrics_runtime_map -v
ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file ~/.vault_pass.txt
npm test
npm run lint
npx tsc --noEmit
AUTH_SECRET=dev-secret VERSION=0123456789abcdef0123456789abcdef01234567 npm run build
```

Expected: all pass. This proves only local structure/build, not that a real digest was published or deployed.

**Step 8: Commit**

```bash
git add .github/workflows/ci.yml ansible-playbook.yml ops/tests/test_frontpage_metrics_runtime_map.py README.md DEPLOYMENT.md
git commit -m "fix: deploy Frontpage by image digest"
```

---

## Phase 2 — Small Security and Public Truth Fixes

### Task 8: Add Baseline Response Headers and Remove Secret-Printing Guidance

**Objective:** Add low-risk browser security headers and ensure runbooks never recommend printing the full container environment.

**Files:**
- Modify: `next.config.ts:3-27`
- Modify: `tests/docker-runtime-smoke.mjs`
- Modify: `DEPLOYMENT.md:73-84`

**Step 1: Add failing Docker smoke assertions**

After fetching `/`, require:

```js
const homepage = await getText(`${baseUrl}/`);
const requiredHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
};
for (const [name, expected] of Object.entries(requiredHeaders)) {
  if (homepage.response.headers.get(name) !== expected) {
    throw new Error(`${name} did not match ${expected}`);
  }
}
if (homepage.response.headers.has("x-powered-by")) {
  throw new Error("x-powered-by must be disabled");
}
```

Also require a non-empty `strict-transport-security` value. HSTS is ignored by browsers over the smoke test’s HTTP connection but the application header remains testable.

**Step 2: Run a fresh production Docker smoke and verify RED**

```bash
source ~/.nvm/nvm.sh && nvm use 22
AUTH_SECRET=dev-secret VERSION=0123456789abcdef0123456789abcdef01234567 npm run build
docker build --build-arg VERSION=0123456789abcdef0123456789abcdef01234567 -t frontpage:headers-red .
node tests/docker-runtime-smoke.mjs --image frontpage:headers-red --version 0123456789abcdef0123456789abcdef01234567
```

Expected: FAIL on the first missing security header.

**Step 3: Add the minimal Next.js header policy**

```ts
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // Preserve existing standalone/tracing/turbopack settings.
};
```

Do not add CSP in this task; it needs separate script/style/font measurement.

**Step 4: Replace the dangerous runbook command**

Delete the `docker inspect` template that prints every environment variable. Use only:

```bash
ssh deploy@[REDACTED] \
  "docker inspect --format '{{.State.Status}} {{.Config.Image}}' frontpage"
ssh deploy@[REDACTED] \
  "docker exec frontpage printenv VERSION"
```

Do not add real credentials, tokens, vault contents, or private hostnames to the documentation.

**Step 5: Rebuild and verify GREEN**

```bash
AUTH_SECRET=dev-secret VERSION=0123456789abcdef0123456789abcdef01234567 npm run build
docker build --build-arg VERSION=0123456789abcdef0123456789abcdef01234567 -t frontpage:headers-green .
node tests/docker-runtime-smoke.mjs --image frontpage:headers-green --version 0123456789abcdef0123456789abcdef01234567
```

Expected: smoke passes.

**Step 6: Commit**

```bash
git add next.config.ts tests/docker-runtime-smoke.mjs DEPLOYMENT.md
git commit -m "security: add baseline response headers"
```

---

### Task 9: Parse GitHub Repository URLs Correctly and Fetch the Rendered Project Set

**Objective:** Stop presenting “not fetched” repository data as “No public activity.”

**Files:**
- Modify: `src/lib/github-stats.ts:31-35,170-183`
- Modify: `src/lib/github-stats.test.ts`
- Modify: `src/lib/projects/presentation.ts`
- Modify: `src/lib/projects/presentation.test.ts:46-57`
- Modify: `src/app/page.tsx:16-34`
- Modify: `src/components/dashboard/ProjectDashboard.tsx`
- Modify: `src/components/dashboard/ProjectHealthRow.tsx:45-52`
- Test: `tests/e2e/public-ui.spec.ts`

**Step 1: Export the parser and add failing URL tests**

Add `parseRepoUrl` to the test import and test:

```ts
describe("parseRepoUrl", () => {
  it.each([
    ["https://github.com/Reedtrullz/Frontpage", { owner: "Reedtrullz", repo: "Frontpage" }],
    ["https://github.com/Reedtrullz/Frontpage/", { owner: "Reedtrullz", repo: "Frontpage" }],
    ["https://github.com/Reedtrullz/Frontpage.git", { owner: "Reedtrullz", repo: "Frontpage" }],
  ])("parses %s", (input, expected) => {
    expect(parseRepoUrl(input)).toEqual(expected);
  });

  it.each([
    "https://example.com/Reedtrullz/Frontpage",
    "https://github.com/Reedtrullz",
    "https://github.com/Reedtrullz/Frontpage/issues",
  ])("rejects %s", (input) => {
    expect(parseRepoUrl(input)).toBeNull();
  });
});
```

**Step 2: Run tests and verify RED**

```bash
npm test -- src/lib/github-stats.test.ts
```

Expected: FAIL because the parser is private and trailing slashes are unsupported.

**Step 3: Implement URL-based parsing**

```ts
export function parseRepoUrl(
  value: string,
): { owner: string; repo: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return null;
    const [owner, rawRepo] = parts;
    const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}
```

No dependency is needed.

**Step 4: Build the `current` set before fetching stats**

Move the same selection used by `ProjectDashboard` into a shared presentation helper, for example:

```ts
export function selectCurrentProjects(projects: ProjectContent[]): ProjectContent[] {
  return sortProjects(
    projects.filter((project) =>
      ["active", "maintained"].includes(project.lifecycle),
    ),
    "featured",
  );
}
```

Use it in both `src/app/page.tsx` and `ProjectDashboard.tsx`. Fetch `extractRepoPairs(currentProjects)`, not only featured projects. This avoids two definitions drifting.

**Step 5: Distinguish unavailable stats from absent repository activity**

Add `available: boolean` to `GitHubStats`. Set it to `true` after a successful
GitHub response and to `false` only in `emptyStats()`; do not infer
availability from zero stars or a null commit date.

Update every typed fixture, including the object passed to
`repositoryActivity` in `src/lib/projects/presentation.test.ts`, with
`available: true` for a successful empty-repository response. Add a separate
`available: false` assertion if the helper remains in use.

Render repository copy with this complete decision order:

```tsx
{!project.repoUrl ? (
  <span className="text-sm text-[var(--text-subtle)]">No public repository</span>
) : !stats?.available ? (
  <span className="text-sm text-[var(--text-subtle)]">Activity unavailable</span>
) : stats.lastCommitDate ? (
  <span className="text-sm text-[var(--text-muted)]">
    Updated <RelativeTime value={stats.lastCommitDate} now={now} />
  </span>
) : (
  <span className="text-sm text-[var(--text-subtle)]">No commits yet</span>
)}
```

Remove the now-redundant `repositoryActivity(stats)` local from
`ProjectHealthRow`; do not change the shared helper unless another caller
requires it.

**Step 6: Add an E2E truth assertion**

On `/`, scope to the current non-featured `Frontpage` row and assert it does
not contain “No public activity” merely because it was outside the featured
set:

```ts
const currentWork = page.locator("section").filter({
  has: page.getByRole("heading", { name: "Current work" }),
});
const frontpageRow = currentWork.getByRole("link", { name: /Frontpage/i });
await expect(frontpageRow).not.toContainText("No public activity");
```

If the actual section wrapper changes during implementation, scope from the
`current-work-title` section element. Do not weaken the assertion with
`.first()`, because the shared app shell also contains Frontpage/status text.

**Step 7: Run focused verification**

```bash
npm test -- src/lib/github-stats.test.ts src/lib/projects/presentation.test.ts
npx tsc --noEmit
npm run lint
AUTH_SECRET=dev-secret npm run build
npm run pretest:e2e
CI=1 npx playwright test tests/e2e/public-ui.spec.ts --grep "public project experience"
```

Expected: all pass. A fresh build immediately precedes the production-style Playwright run.

**Step 8: Commit**

```bash
git add src/lib/github-stats.ts src/lib/github-stats.test.ts src/lib/projects/presentation.ts src/lib/projects/presentation.test.ts src/app/page.tsx src/components/dashboard/ProjectDashboard.tsx src/components/dashboard/ProjectHealthRow.tsx tests/e2e/public-ui.spec.ts
git commit -m "fix: align repository activity with rendered projects"
```

---

### Task 10: Expose One Accessible History Summary, Not 96 Images

**Objective:** Keep the aggregate chart description while hiding decorative time segments from assistive technology.

**Files:**
- Modify: `src/components/dashboard/CoarseHistoryStrip.tsx:226-238`
- Modify: `src/components/dashboard/CoarseHistoryStrip.test.ts`
- Modify: `tests/e2e/public-ui.spec.ts:248-260`

**Step 1: Add a failing semantic-count test**

In `CoarseHistoryStrip.test.ts`, render a short available history and assert:

```ts
expect(markup.match(/role="img"/g) ?? []).toHaveLength(1);
expect(markup).toContain('aria-label="CPU pressure history:');
expect(markup).toContain('aria-hidden="true"');
```

Keep the existing `title` context assertion so pointer users retain exact segment tooltips.

**Step 2: Run the focused test and verify RED**

```bash
npm test -- src/components/dashboard/CoarseHistoryStrip.test.ts
```

Expected: FAIL because every segment currently has `role="img"` and `aria-label`.

**Step 3: Hide only decorative segments**

Replace each segment’s `role="img" aria-label={context}` with:

```tsx
<span
  key={`${segment.value}-${index}`}
  className={`absolute top-0 h-full ${toneClasses[tones.get(segment.value) ?? "unknown"]}`}
  style={{ left: `${left}%`, width: `${width}%` }}
  title={context}
  aria-hidden="true"
/>
```

Keep `role="img"` and the aggregate `aria-label` on the containing chart div.

**Step 4: Strengthen the browser assertion**

On `/status`, assert exactly one CPU history image is exposed:

```ts
await expect(
  page.getByRole("img", { name: /CPU pressure history:/i }),
).toHaveCount(1);
```

**Step 5: Run focused and accessibility verification**

```bash
npm test -- src/components/dashboard/CoarseHistoryStrip.test.ts
AUTH_SECRET=dev-secret npm run build
npm run pretest:e2e
CI=1 npx playwright test tests/e2e/public-ui.spec.ts --grep "public status"
```

Expected: unit and browser/accessibility tests pass.

**Step 6: Commit**

```bash
git add src/components/dashboard/CoarseHistoryStrip.tsx src/components/dashboard/CoarseHistoryStrip.test.ts tests/e2e/public-ui.spec.ts
git commit -m "fix: simplify status history semantics"
```

---

### Task 11: Remove the Repetitive Homepage Evidence Panel

**Objective:** Keep identity, status, flagships, current work, and working scope while removing the batch-stamped “Reviewed posture” list from the homepage.

**Files:**
- Modify: `src/components/dashboard/ProjectDashboard.tsx:1-9,32-33,121-146`
- Modify: `tests/e2e/public-ui.spec.ts`

**Step 1: Add a failing homepage composition test**

In `public-ui.spec.ts`, add:

```ts
test("keeps the homepage focused on current work and working scope", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Flagship projects" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current work" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What I build" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reviewed posture" })).toHaveCount(0);
});
```

**Step 2: Run the focused browser test and verify RED**

```bash
AUTH_SECRET=dev-secret npm run build
npm run pretest:e2e
CI=1 npx playwright test tests/e2e/public-ui.spec.ts --grep "keeps the homepage focused"
```

Expected: FAIL because “Reviewed posture” still renders.

**Step 3: Remove the evidence panel and dead imports**

Delete:

- `recentEvidence` calculation;
- `RelativeTime` import;
- `PostureBadge` import used only by this panel;
- the complete `RECENT EVIDENCE / Reviewed posture` block.

Keep `What I build` and make it a single full-width section rather than leaving an empty two-column shell. Preserve existing semantic tokens and spacing; do not create a replacement component.

**Step 4: Run focused browser and type verification**

```bash
npx tsc --noEmit
npm run lint
AUTH_SECRET=dev-secret npm run build
npm run pretest:e2e
CI=1 npx playwright test tests/e2e/public-ui.spec.ts --grep "application shell|public project experience|keeps the homepage focused|responsive and accessible"
```

Expected: pass at all configured widths with no serious axe violations.

**Step 5: Commit**

```bash
git add src/components/dashboard/ProjectDashboard.tsx tests/e2e/public-ui.spec.ts
git commit -m "refactor: remove repetitive homepage evidence panel"
```

---

### Task 12: Pin Privileged GitHub Actions to Reviewed SHAs

**Objective:** Remove mutable action tags from the workflow that receives package-write permission.

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md` only if documenting the update policy

**Step 1: Add a diagnostic gate that must fail before edits**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
import re
text = Path('.github/workflows/ci.yml').read_text()
mutable = re.findall(r'uses:\s+([^\s]+)@v\d+\b', text)
print('\n'.join(mutable))
raise SystemExit(1 if mutable else 0)
PY
```

Expected: exit 1 and list each mutable action reference.

**Step 2: Resolve each current major tag to a real commit**

Resolve every unique current action reference directly from the workflow:

```bash
python3 - <<'PY'
from pathlib import Path
import re
import subprocess
text = Path('.github/workflows/ci.yml').read_text()
for value in sorted(set(re.findall(r'uses:\s+([^\s#]+@v\d+)\b', text))):
    repository, ref = value.rsplit('@', 1)
    sha = subprocess.run(
        ['gh', 'api', f'repos/{repository}/commits/{ref}', '--jq', '.sha'],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise SystemExit(f'invalid action SHA for {value}: {sha!r}')
    print(f'{value} -> {sha}')
PY
```

Expected: a 40-character commit SHA. Review the release notes and repository ownership before accepting it. Do not invent or copy SHAs from this plan.

**Step 3: Replace tags with full SHAs and preserve readability**

Replace each major tag with the real 40-character output from Step 2 and keep
the former major tag as an end-of-line comment, for example
`# v7`. Apply the same format to setup-node, upload-artifact, Docker
setup/login/metadata/build actions, and every other action in the workflow.

**Step 4: Run the immutable-reference gate**

```bash
python3 - <<'PY'
from pathlib import Path
import re
text = Path('.github/workflows/ci.yml').read_text()
refs = re.findall(r'uses:\s+([^\s#]+)', text)
invalid = [ref for ref in refs if not re.search(r'@[a-f0-9]{40}$', ref)]
print('\n'.join(invalid))
raise SystemExit(1 if invalid else 0)
PY
```

Expected: exit 0 with no output.

**Step 5: Validate the edited workflow text and local gates**

```bash
git diff --check
npm test
```

Expected: `git diff --check` and tests pass. Do not invoke `npx prettier` or
another undeclared formatter: the repository does not declare one, and `npx`
could download an unreviewed package. GitHub validates workflow syntax during
the exact-SHA CI closeout in Task 14.

**Step 6: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "security: pin CI actions to reviewed commits"
```

Stage `README.md` only if it actually changed.

---

## Phase 3 — Full Verification and Honest Closeout

### Task 13: Run the Post-Implementation Audit and Full Local Gate `[PARENT-DIRECT]`

**Objective:** Verify architecture invariants, state transitions, public privacy, browser behavior, and the complete release gate on the committed tree.

**Files:**
- Review: every file changed by Tasks 2-12
- Update only if needed: `docs/superpowers/plans/2026-07-17-frontpage-trust-readability-remediation.md`

**Step 1: Confirm a clean committed implementation tree**

```bash
git status --short
git log --oneline --decorate -15
```

Expected: clean tree before the gate. Do not test an uncommitted mixture and call it release evidence.

**Step 2: Run the complete local gate on Node 22**

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test
npm run lint
npx tsc --noEmit
python3 -m unittest discover -s ops/tests
python3 -m compileall -q ops/frontpage_metrics_v2 ops/frontpage-metrics-collector.py ops/frontpage-metrics-collector-v2.py ops/frontpage-metrics-runtime-map.py ops/frontpage-metrics-shadow-compare.py
ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml --vault-password-file ~/.vault_pass.txt
AUTH_SECRET=dev-secret VERSION=0123456789abcdef0123456789abcdef01234567 npm run build
CI=1 npm run test:e2e
docker build --build-arg VERSION=0123456789abcdef0123456789abcdef01234567 -t frontpage:remediation-gate .
node tests/docker-runtime-smoke.mjs --image frontpage:remediation-gate --version 0123456789abcdef0123456789abcdef01234567
git diff --check
```

Expected: all commands pass; compile and diff checks are silent.

**Step 3: Run the architecture heartbeat audit**

Manually trace and record findings for:

```text
systemd enabled state
  → observability_v2_enabled
  → selected collector
  → app env and mounts
  → runtime-map regeneration
  → health/version assertion
  → post-start permissions and privacy assertions
```

Verify:

- only one v2 collector can be active;
- ordinary post-promotion deployment stays on v2;
- any candidate failure after removal enters rescue;
- rescue restores v1-only mounts and shadow mode;
- no owner/private metrics path reaches public routes;
- health proves only app status and exact VERSION;
- publication never returns pre-commit failure after `updateHead` succeeds;
- publication intent validation occurs after auth but before filesystem/GitHub mutation.

**Step 4: Run a focused public privacy scan**

```bash
npm run pretest:e2e
CI=1 npx playwright test tests/e2e/public-ui.spec.ts --grep "leaks no owner fields|passes axe|no horizontal overflow|history"
```

Expected: pass. Inspect the rendered `/status` accessibility tree and confirm each coarse strip exposes one aggregate image, not per-segment images.

**Step 5: Review every changed file, not only test output**

Use `git show --stat` and `git show` for each implementation commit. Check:

- Jinja conditions use the persistent mode in steady state and promotion input only for the transition gate;
- no rescue path logs secrets or full registered results containing environment values;
- no broad `catch` converts a post-update publication into failure;
- no test relies on host timezone, stale servers, or globally installed packages;
- docs distinguish local, CI, published, deployed, and live evidence.

If a blocker is found after green tests, add a narrow RED regression test, patch it, rerun the focused test plus the complete gate, then repeat this audit.

**Step 6: Route audit blockers back through the affected task**

If the audit finds a blocker, return to the task that owns the affected exact
files, add a narrow RED test, patch the implementation, rerun that task's
focused command and commit using that task's exact file list. Then rerun Tasks
13.1-13.5. Do not use a placeholder or blanket `git add`, and do not create an
empty audit commit.

---

### Task 14: Verify Exact CI, Digest, Deployment, and Live Behavior `[PARENT-DIRECT]`

**Objective:** Close the plan only with separate evidence for push, CI, image publication, deployment, health/version, and hydrated public UI.

**Risk:** External side effects. Do not push or deploy unless the owner explicitly authorizes execution of this task. A missing secret, running CI job, unpublished digest, or unavailable deployment window keeps this task open.

**Evidence destination:** the merged pull request timeline. Do not create a
post-merge evidence commit that falls outside the exact SHAs verified below.

**Step 1: Record the final committed SHA and clean tree**

```bash
export FINAL_SHA="$(git rev-parse HEAD)"
test "$(git status --porcelain)" = ""
export LOCAL_GATE_RESULT="pass — Task 13 full local gate and focused privacy scan completed"
printf '%s\n' "$FINAL_SHA"
```

Expected: a full SHA and clean tree.

**Step 2: Push and open the review path only after explicit owner approval**

```bash
git push -u origin codex/frontpage-trust-remediation
export PR_URL="$(gh pr create \
  --base main \
  --head codex/frontpage-trust-remediation \
  --title "fix: harden Frontpage trust boundaries" \
  --body "Implements the reviewed trust and readability remediation plan.")"
test -n "$PR_URL"
```

Expected: remote branch contains `FINAL_SHA` and the pull request triggers the
full pull-request CI path, including Docker runtime checks. A push or open pull
request is not successful CI or deployment proof.

**Step 3: Verify GitHub Actions for the exact SHA**

```bash
gh run list --workflow CI --branch codex/frontpage-trust-remediation --limit 10 \
  --json databaseId,headSha,status,conclusion,url
```

Select the run whose `headSha` equals `FINAL_SHA`, then:

```bash
export RUN_ID="$(gh run list \
  --workflow CI \
  --branch codex/frontpage-trust-remediation \
  --limit 20 \
  --json databaseId,headSha \
  --jq ".[] | select(.headSha == \"$FINAL_SHA\") | .databaseId" \
  | head -n 1)"
test -n "$RUN_ID"
gh run watch "$RUN_ID" --exit-status
gh run view "$RUN_ID" --json headSha,status,conclusion,url,jobs
export BRANCH_RUN_URL="$(gh run view "$RUN_ID" --json url --jq .url)"
test -n "$BRANCH_RUN_URL"
```

Expected: exact `headSha`, `status=completed`, `conclusion=success`. If the watcher times out, resume the same run ID.

**Step 4: Merge/push main only through the owner-approved repository workflow**

Do not assume pull-request CI publishes an image: the current workflow
publishes only on `main`. After the approved merge, capture the new main SHA:

```bash
git fetch origin main
export FINAL_MAIN_SHA="$(git rev-parse origin/main)"
test -n "$FINAL_MAIN_SHA"
```

Then verify the exact mainline CI run:

```bash
export MAIN_RUN_ID="$(gh run list \
  --workflow CI \
  --branch main \
  --limit 20 \
  --json databaseId,headSha \
  --jq ".[] | select(.headSha == \"$FINAL_MAIN_SHA\") | .databaseId" \
  | head -n 1)"
test -n "$MAIN_RUN_ID"
gh run watch "$MAIN_RUN_ID" --exit-status
gh run view "$MAIN_RUN_ID" --json headSha,status,conclusion,url,jobs
```

Expected: exact `headSha`, completed status, and successful conclusion.

**Step 5: Capture the published digest from that exact main run**

Read the Build & publish image job output/summary and record:

- full commit SHA;
- `sha256:<64 hex>` digest;
- successful published-image smoke.

Do not infer the digest from a tag or from a local image.

Set and validate the exact observed value without placing an illustrative
digest in the command:

```bash
read -r -p "Digest from the exact successful main CI run: " PUBLISHED_DIGEST
printf '%s\n' "$PUBLISHED_DIGEST" | grep -Eq '^sha256:[a-f0-9]{64}$'
export PUBLISHED_DIGEST
```

**Step 6: Deploy the exact SHA and digest only after explicit owner approval**

```bash
GITHUB_SHA="$FINAL_MAIN_SHA" \
FRONTPAGE_IMAGE_DIGEST="$PUBLISHED_DIGEST" \
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml \
  --vault-password-file ~/.vault_pass.txt
```

Expected: candidate and all post-start assertions pass. If any destructive task fails, the playbook must report verified rollback rather than success.

**Step 7: Verify live health and version**

```bash
curl -fsS https://reidar.tech/api/health | jq -e \
  --arg sha "$FINAL_MAIN_SHA" \
  '.status == "healthy" and .version == $sha'
```

Expected: exit 0. This is live app/version evidence, not owner metrics evidence.

**Step 8: Verify hydrated public routes in a browser**

Open `/`, `/projects`, and `/status` in a real browser. Confirm:

- homepage has Flagship projects, Current work, and What I build, but no Reviewed posture;
- repository activity does not claim “No public activity” for an unfetched current repository;
- `/status` exposes one aggregate accessibility image per coarse history strip;
- no owner/raw metrics markers appear publicly;
- no console errors occur.

**Step 9: Verify post-promotion steady state when production is already promoted**

Run a second ordinary deployment without `FRONTPAGE_OBSERVABILITY_V2_PROMOTE`. Verify exactly one v2 collector is active and the app still has v2 env/mounts. If production is not yet promoted, record this verification as blocked; do not promote solely to close this plan.

**Step 10: Record closeout evidence on the merged pull request**

Verify that the evidence variables exported by the preceding steps remain in
the same execution shell:

```bash
test -n "$PR_URL"
test -n "$LOCAL_GATE_RESULT"
test -n "$FINAL_SHA"
test -n "$BRANCH_RUN_URL"
test -n "$FINAL_MAIN_SHA"
test -n "$MAIN_RUN_ID"
test -n "$PUBLISHED_DIGEST"
```

Post completion evidence only for steps actually observed. The comment must
distinguish:

- local gates;
- branch CI;
- main CI and published digest;
- deployed SHA/digest;
- live health/version;
- hydrated browser verification;
- post-promotion ordinary-deploy proof.

Capture the human-observed checks, create a temporary evidence note, and post
it without editing the repository:

```bash
read -r -p "Hydrated browser verification (pass or blocked with reason): " BROWSER_RESULT
read -r -p "Post-promotion ordinary deploy (pass, not-applicable, or blocked): " STEADY_STATE_RESULT
export BROWSER_RESULT STEADY_STATE_RESULT
export MAIN_RUN_URL="$(gh run view "$MAIN_RUN_ID" --json url --jq .url)"
export CLOSEOUT_NOTE="$(mktemp /tmp/frontpage-closeout.XXXXXX)"
python3 - <<'PY'
import os
from pathlib import Path

lines = [
    "## Frontpage remediation closeout",
    f"- Local gates: {os.environ['LOCAL_GATE_RESULT']}",
    f"- Branch SHA: `{os.environ['FINAL_SHA']}`",
    f"- Branch CI: {os.environ['BRANCH_RUN_URL']}",
    f"- Main SHA: `{os.environ['FINAL_MAIN_SHA']}`",
    f"- Main CI: {os.environ['MAIN_RUN_URL']}",
    f"- Published digest: `{os.environ['PUBLISHED_DIGEST']}`",
    "- Deployment: Ansible candidate and post-start assertions passed",
    "- Live health: exact main SHA matched `/api/health.version`",
    f"- Hydrated browser: {os.environ['BROWSER_RESULT']}",
    f"- Ordinary post-promotion deploy: {os.environ['STEADY_STATE_RESULT']}",
]
Path(os.environ["CLOSEOUT_NOTE"]).write_text("\n".join(lines) + "\n")
PY
gh pr comment "$PR_URL" --body-file "$CLOSEOUT_NOTE"
rm "$CLOSEOUT_NOTE"
unset CLOSEOUT_NOTE
```

If an external step is unavailable, put the exact blocker in the corresponding
prompt rather than claiming success. Do not create or amend a repository commit
merely to add post-merge operational evidence.

---

## Acceptance Criteria

The implementation is complete only when all applicable criteria are proven:

- [ ] Implementation branch started from current `origin/main`, not the divergent readability branch.
- [ ] An ordinary deployment after v2 promotion preserves v2 collector selection, app flag, and projection mounts.
- [ ] Shadow and promoted v2 collectors are mutually exclusive.
- [ ] Every failure after current-container removal enters one verified v1-first rescue path.
- [ ] Candidate health compares exact `VERSION`; rollback verifies exact
      restored container `VERSION` and compares response version when the prior
      image supports it.
- [ ] Successful Git ref advancement can never be reported as pre-publication failure.
- [ ] Receipt/cleanup reconciliation failures preserve truthful commit evidence and an actionable warning.
- [ ] Draft PUT/DELETE and publication share one exclusive mutation boundary,
      so cleanup cannot delete a draft saved after the publication snapshot.
- [ ] Publish POST requires owner auth, exact configured Origin, JSON, and `confirmed: true`.
- [ ] Production image publication exposes a digest and deployment uses `repository@sha256:...`.
- [ ] `/api/health` returns `{status, version}` with `Cache-Control: no-store`.
- [ ] Baseline response headers are present and `X-Powered-By` is absent.
- [ ] Deployment documentation does not print the full container environment.
- [ ] GitHub repository parsing handles canonical, trailing-slash, and `.git` URLs safely.
- [ ] Repository activity is fetched for the same current-project set that is rendered.
- [ ] Each coarse history strip exposes one aggregate accessibility image.
- [ ] Homepage no longer duplicates batch-stamped evidence in a “Reviewed posture” panel.
- [ ] Privileged workflow actions are pinned to reviewed full commit SHAs.
- [ ] Full local tests, lint, typecheck, Python, Ansible syntax, production build, Playwright/axe, Docker smoke, and diff checks pass.
- [ ] CI, image publication, deployment, and live behavior are reported as separate claims.

## Plan Review History

- 2026-07-17 — Initial plan drafted from the comprehensive Frontpage code,
  architecture, security, operations, and live-site review.
- 2026-07-17 — Self-review found and patched: an `ENOTDIR` test fixture that
  invalidated its own assertion, missing `AUTH_URL` test isolation,
  pre-version-health rollback compatibility, an undeclared `npx` formatter,
  fake shell placeholders, incomplete PR-CI triggering, an unfocused E2E
  selector, promotion-gate/steady-state condition ambiguity, and tag-based
  published-image smoke.
- 2026-07-17 — Independent current-main review blocked the draft on six
  concrete issues: plan transfer to the fresh branch, collector transition
  placement outside rescue, concurrent-draft deletion, mixed-case GHCR digest
  smoke, an omitted typed fixture, and an untracked post-merge evidence commit.
- 2026-07-17 — Patched all six blockers. Added an atomic shared content-mutation
  boundary, moved every first-promotion service mutation behind image pull and
  inside rescue, normalized the GHCR reference, included all typed fixtures,
  and moved operational closeout evidence to the merged PR timeline.
- 2026-07-17 — Focused independent re-review evaluated the earlier
  `c415ab2f…` snapshot and blocked it on BSD `mktemp`, promotion-seed ordering,
  PID-1 lock reuse, and incomplete closeout evidence.
- 2026-07-17 — Final corrections use trailing-X `mktemp` templates verified on
  macOS, assert pull → protected stop-shadow → seed → enable-promoted order,
  identify lock ownership with PID plus module-instance UUID and cover the
  ownerless crash window, and record local, branch-CI, main-CI, digest,
  deployment, live, browser, and steady-state evidence on the merged PR.
