# Frontpage acceptance follow-up — 3 October 2026

The released application remains `57bc20e69c93d4f53c523982e0024918669f15af`. [Main CI 37148140163](https://github.com/Reedtrullz/Frontpage/actions/runs/37148140163) passed, and exact-version health checks on `reidar.tech` and `frontpage.reidjoss.workers.dev` returned healthy at `2026-10-03T20:19:18Z`. A default Python urllib client received 403; curl with a browser user agent received 200 on both origins. This follow-up changes documentation and the unpublished timeline candidate only.

| Issue | Work completed in this follow-up | Remaining acceptance |
| --- | --- | --- |
| [#43](https://github.com/Reedtrullz/Frontpage/issues/43) | Encrypted isolated file/SQLite restore, exact revision/receipt/journal readback, and restored schema-1 data read by the older reader | Access-protected isolated Cloudflare round trip and an independent production backup destination |
| [#45](https://github.com/Reedtrullz/Frontpage/issues/45), [#46](https://github.com/Reedtrullz/Frontpage/issues/46) | Fresh installed comparator under unchanged epoch and thresholds; existing monitor retained | Real fresh, complete, zero-mismatch 48-hour gate and activation/readback evidence |
| [#47](https://github.com/Reedtrullz/Frontpage/issues/47) | Separate collector release sequence below | Install and verify after the current evidence window |
| [#55](https://github.com/Reedtrullz/Frontpage/issues/55) | Valid-session account permission inventory and measurement preflight reviewed | Current account budget, isolated candidate/credentials, measured Worker/DO CPU and mixed-workload report |
| [#35](https://github.com/Reedtrullz/Frontpage/issues/35) | Reviewed existing public mining field allowlist | Owner disclosure decision; recommendation is to retain the existing six fields |
| [#52](https://github.com/Reedtrullz/Frontpage/issues/52) | Rechecked source/CI references and prepared a third deployment-identity milestone | Editorial/usefulness review and revision-bound pilot publication |

## Encrypted recovery rehearsal

At `2026-10-03T20:16:40Z`, the actual built `frontpage-owner-state` CLI exported and restored four synthetic records: personal draft, project draft, publication receipt, and publication journal. The test used the current public canonical JSON as synthetic content; it did not export or mutate production owner state. The [sanitized receipt](acceptance/encrypted-owner-restore-2026-10-03.json) records the result.

Two snapshots, before and after draft migration, were encrypted with AES-256-GCM. The protected key and ciphertext files were mode 0600 in a mode-0700 operator directory outside Git. Wrong-key and modified-ciphertext decryption failed. The CLI preserved current draft revisions and all records exactly, rejected an existing destination, and rejected a corrupt manifest before creating a destination. The current SQL restore implementation ran against real Node SQLite with eager SQL execution and synchronous transactions; exact readback passed and invalid input preserved existing records.

Restoring the pre-migration snapshot into a new directory also passed the actual older `readDraftBundle` implementation from `c45bc2a5517eb2435bea89fd4194b638fd48a96c`. It read both schema-1 drafts and the receipt, and all four exported records matched the original snapshot. This is reader compatibility evidence, not a deployed code rollback or a complete old-application rehearsal. A first harness run used lazy SQL execution and failed; correcting the adapter to execute SQL eagerly produced the successful receipt. Application code was unchanged.

Follow the [owner recovery runbook](owner-state-recovery.md). Retained VPS `frontpage_data` contains legacy public override files, not current Cloudflare drafts/receipts. Its existence is not a current owner-state backup. Retain the pre-migration snapshot through any state migration and recovery window. Local encryption proves this rehearsal envelope, not independent offsite retention or key recovery after loss of this machine.

## Access setup required for the Cloudflare drill

After Wrangler refreshed the active login, application and service-token list requests returned 200 with empty lists. The account organization and subscription reads returned 403/code 10000. Creating a dedicated 24-hour rehearsal service token at `20:08:29Z` returned 403/code 1010. No service token or rehearsal Worker was created. An empty application list does not establish write permission or Zero Trust organization readiness.

Complete the following with account permissions that support the operation:

1. Verify an active Zero Trust organization and its team domain. Create a short-lived dedicated service token with **Access: Service Tokens Write**. Save its one-time client secret in an operator-only credential file, never in Git or terminal output.
2. Create a self-hosted Access application on a dedicated operator hostname, with a **Service Auth / Include / Service Token** policy selecting only that token. Read back the application audience and exact hostname. Application/policy API writes require **Access: Apps and Policies Write**. Protect the hostname before enabling maintenance.
3. Deploy the exact reviewed source into a dedicated candidate Worker and a new SQLite Durable Object namespace, distinct from production. Use synthetic records and isolated credentials. Configure `OWNER_OPERATOR_HOST`, `OWNER_ACCESS_TEAM`, `OWNER_ACCESS_AUD`, `OWNER_ACCESS_SERVICE_ID`, `OWNER_MAINTENANCE_SECRET`, and `OWNER_STATE_TARGET`. Pin the service token's client ID. Do not enable operator access on the production Worker for this drill.
4. Prove anonymous denial, wrong-service denial, wrong-bearer denial and wrong-target denial. Only the dedicated Access identity plus the independent maintenance credential may export state. Neither owner-session nor collector credentials grant maintenance access. The public hostname and workers.dev maintenance path must remain rejected.
5. Export, encrypt, verify and restore synthetic state through the actual Cloudflare CLI transport. Enable `OWNER_RESTORE_ENABLED=1` only during this candidate restore window with candidate owner writes stopped. Confirm target and backup ID; compare full exported readback and revisions, including receipt/journal records. For CLI exit 2, keep writes stopped and inspect the uncertain outcome before retrying. Disable restore and read back configuration afterward.
6. Preserve the sanitized receipt and revoke the rehearsal token after success. Record exact candidate identity, isolation and denial evidence. Only then count the Cloudflare portion of #43 as complete.

Setup follows [Cloudflare service-token documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/), [self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) and [API permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/). The application's independent JWT verification remains required even behind Access.

## Preserve the real shadow window

The installed comparator was freshly executed at `2026-10-03T20:03:33Z`: schema 3, unapproved, 26.95 hours, 1,618 paired minutes, no missed minutes, 60-second maximum gap, no currently incomplete v2 host minutes, and `0.010300782859497322%` public-service mismatch. Evidence age was 93.292 seconds at that execution; this dated receipt is not fresh approval for a later action.

The epoch remains `2026-10-02T17:04:16Z`, bound to installed collector source `c45bc2a5517eb2435bea89fd4194b638fd48a96c`, with receipt SHA-256 `691d67f322a16054ef2af2666ee418856a970c8936339a36fe3d9feb03f5e94b`. The shadow process and existing collector/upload services were not restarted. The existing acceptance chat identified the historical `2026-10-03T04:36Z` service mismatch. Its earliest conditional clean rolling-window check is **5 October at 06:38 Europe/Oslo**; elapsed time alone does not approve anything.

Continue the existing acceptance heartbeat, which already knows released source 57bc and installed source c45bc. Do not create a duplicate monitor, alter thresholds, reset the epoch, or install writer-lock changes into this window. Follow [v2 activation](cloudflare-v2-activation.md) only after a newly regenerated complete gate passes and all independent provider, upload, redaction, authenticated-owner and deactivation requirements are satisfied.

## Separate collector release

The new process-level writer lock and service mutual exclusion are shipped in source but not installed on the VPS. Prepare this as a distinct release after the current shadow evidence has been captured and assessed:

1. Re-read live Worker identity and exact-main CI. Verify the installed collector/unit/source hashes and capture a consistent SQLite backup using the supported backup path, with database/WAL evidence retained. Record unit status and all restore/rollback files before mutation.
2. Stop the shadow writer deliberately, install the reviewed collector package and matching service units, and start exactly one writer. Verify a second process cannot acquire ownership, shutdown/crash releases ownership, read-only diagnostics still work, and history is retained. Do not remove a lock by stale-file heuristics.
3. Record the actual installation, source/unit hashes, stop/start times and any resulting evidence discontinuity. If changed sampling or collection requires a new epoch, create it explicitly for that legitimate change and require a new complete window; never carry pre-change acceptance over silently.
4. For the separate v1 uploader update, follow [generation rollout](collector-v1-generation-rollout.md): compatible receiver first, authenticated capability check, complete generation commit, coherent mirror and honest stale behavior after receiver rollback. Check public freshness, exact Worker identity and anonymous owner denial after rollout. Keep rollback artifacts and all prior evidence.

## Headroom measurement prerequisites

No benchmark load was dispatched. Subscription access remains denied, so this session cannot establish the actual plan or remaining account-wide request budget. Partial-period analytics, a cached plan label or nominal Free-plan limits cannot substitute for observed remaining capacity.

Use [the implemented benchmark](../scripts/measure-cloudflare-headroom.mjs) only after collecting fresh provider evidence and isolation readback. It requires separately measured Worker and Durable Object CPU, actual quota usage/limit/unit, and an authorized request budget within remaining capacity, all observed within 15 minutes. Candidate evidence must be equally fresh and prove a distinct production-excluded DO namespace, isolated collector secret and synthetic owner session. Credential files must be regular mode-0400 or mode-0600 files.

Choose a reviewed isolated `frontpage-headroom-*` candidate. The script refuses production `reidar.tech`, its subdomains and `frontpage.reidjoss.workers.dev`. Start with the minimum **182 total requests**, within the hard 2,000-request cap, and one complete mixed-workload cycle at concurrency 1, 2 and 4, with at most 60 seconds per stage. Use explicit category p95 targets for public reads, owner reads, collector requests and complete collector generations; the generation target cannot exceed five seconds. Record coordination and provider-budget references without secrets. Do not populate evidence fields with invented measurements or turn approval flags into evidence.

The result must include exact candidate SHA, request mix, stage duration, errors, category latency, actual provider CPU, quota cost and complete collector generation/readback. Keep the singleton design unless these measurements justify a change. An unperformed or failed run is not evidence for sharding or a paid fallback.

## Editorial recommendations

For #35, retain the existing six-field public allowlist: `hashrate`, `hashrate_avg_1h`, `accepted_shares`, `last_share_at_ms`, `worker_name`, and `uptime_seconds`. Do not add pool balances, payments, agent/login fields or longer averages. Preserve explicit unknown/stale/unavailable freshness; a fetched pool response is not proof of current mining. A coarser activity-only projection remains a possible owner choice, not a decision made by this receipt.

For #52, use the [three-entry Frontpage pilot](proposals/frontpage-timeline-pilot-2026-10-03.md). Original milestones are preserved, references were rechecked, and the new entry limits its claim to deployed identity. Schema validation applies the candidate to a copy of the canonical catalogue only. Canonical content and live drafts remain untouched; publication and owner usefulness review are still pending.

No issue was closed using local rehearsal, elapsed time, a denied permission request or a prepared editorial artifact as a substitute for acceptance.

## Follow-up validation

The isolated encrypted rehearsal passed at 20:16 UTC. All 23 existing targeted content-schema, owner-backup and mining tests passed across three files at 20:22 UTC. The three-milestone candidate passed `projectMilestonesSchema` and `parseProjects` after applying it to an in-memory copy of the complete canonical catalogue. Documentation links and `git diff --check` passed. The primary checkout remained at `948b3e7567ba1d53bb1ecab1f2ad604d1605a222`, and all 11 recorded WIP hashes matched their baseline. No application source, canonical content, collector configuration or production owner state changed.
