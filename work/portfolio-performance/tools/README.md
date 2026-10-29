# Run-local measurement adapter

Run from `/Users/reidar/Documents/Codex/2026-10-20/new-chat`. Python stdlib only.
No product benchmark, provider request or publication runs during setup. The
selftest uses an authored ten-number fixture: baseline performs duplicate work,
candidate avoids it, both produce the same sum. Its results are marked
`selftestOnly` and cannot qualify product report gains.

## Commands and independent sampling

Use the pinned Python3.12 interpreter. `verify_adapter.py` creates a fresh frozen
selftest definition and retains the full CLI replay; it never updates an old case.
Every native case freezes `parentEnvironment` and `artifactRoot` before its first
unit. Missing environment variables, symlinks, foreign roots or an output outside
that artifact root reject before workload launch.

```sh
mkdir -p "$PWD/.omo/t05-run-tmp/unblocking-20261028"
portfolio_scratch=$(mktemp -d "$PWD/.omo/t05-run-tmp/unblocking-20261028/selftest.XXXXXX")
mkdir -p "$portfolio_scratch/tmp" "$portfolio_scratch/home" "$portfolio_scratch/node" "$portfolio_scratch/bun"
env -i TMPDIR="$portfolio_scratch/tmp" HOME="$portfolio_scratch/home" \
  NODE_COMPILE_CACHE="$portfolio_scratch/node" BUN_RUNTIME_TRANSPILER_CACHE_PATH="$portfolio_scratch/bun" \
  PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin LANG=C PYTHONDONTWRITEBYTECODE=1 \
  /Users/reidar/.local/bin/python3.12 work/portfolio-performance/tools/verify_adapter.py
```

After the command terminates, remove only that owned runtime directory; retain
the evidence replay it reports. Native subprocesses use the recorded PATH and
fresh owned HOME/cache directories. Parent cache cleanup follows every unit;
durable evidence remains. Accounting samples file bytes; this is not OS disk/RSS
containment or network/private-file isolation. Those require the owning product's
separately qualified native guard.

The default scratch limit stays16MiB and combined streams stay1MiB, with each
case's tighter values retained. Only `resourceProfile=browser-64m-20261028` with
`modality=browser` and `browserProfileApproval` binding the approved frozen plan
may request64MiB. It is a resource allowance, not browser capability proof.
The new authored adapter-selftest-u03 definition explicitly budgets16MiB for its
parent and retained test artifacts; every old frozen selftest remains unchanged.

Archived audits use `compare.py --audit-run ... --reports ... --receipt-index FILE`
or `--audit-coverage ... --reports ... --receipt-index FILE`. Receipt mode is
read-only and cannot be combined with `--task`. Its schema is
`measurement-receipt-index/v1`: a checkpoint hash from current verified ancestry,
case/source/runtime/native/guard attestations and every ordered raw unit must be
checkpoint-bound. Source attestations include verified archived file bytes, using
unchanged preimages when shared tools have since changed. Production receipts also
bind the original accepted claim's task, workflow, identity and raw-unit/guard
hashes; a copied native envelope or an arbitrary contract path cannot admit units.
It recomputes the existing comparator and decisions without
calling live `Case.read` on foreign or retired hosts. Rejected workflows and
missing original process guards remain unqualified. `blockedClaims` are explicit
remaining work; an empty case list never proves historical gains. Authored fixture
trust roots are injectable only through the test API; the CLI has no override,
and a synthetic case can never substantiate a product report gain.

`verify_adapter.py` retains a fresh `E/t05/replay-*` directory containing its
literal CLI invocations, exit codes, raw output, cases and structured receipts.
It is the independent parent replay command; it recreates owned scratch and
uses no deleted fixtures or shared caches. Repeated collection into the same
case/scenario/sample is rejected. Individual measurement commands collect one
frozen invocation, never a complete comparison.

For product workers: `--sample N` is a zero-based **invocation** index, default
zero. All phases use one fixed case file from the first pilot onward. Samples
0..9 are five baseline-versus-baseline pilot pairs. Warm cases then require
four discarded invocations (two warmup pairs); cold cases start each invocation
with a fresh owned HOME/cache directory. Final measured units follow, with
`pairs` fixed to 10 by default, 5 for expensive/cold cases, or 20 with a
predeclared `pilotJustification`. Pair zero is AB, pair one BA, alternating.
A is baseline, B candidate. The pilot always invokes baseline, in the same
alternating pair slots. `protocol.slot(case, N)` resolves stage, pair, order,
member, phase and unique unit identity. Invoke the phase it returns. Earlier
units must exist and pass before the next unit can run; candidate data cannot
precede the pilot. Do not collect all baseline then all candidate units.

Native receipt names are `E/tNN/<case-id>/<scenario>/000.json` onward. The
example plan paths `baseline/happy.json` and `candidate/happy.json` are summaries;
the independent-unit receipts are authoritative and retain both phases. The
comparison names every input receipt. `--output DIR` selects a task-owned
subdirectory of E for offline QA; it does not change the publication journal.

```sh
python3 work/portfolio-performance/tools/measure.py --case work/portfolio-performance/cases/T09.json --phase candidate --scenario happy --sample 11
python3 work/portfolio-performance/tools/compare.py --task 9 --evidence .omo/evidence/portfolio-performance
```

For cold cases sample 11 is candidate; warm cases start measured units at 14,
so their first candidate is 15. Stop at the fixed final count. Comparisons reject
missing/extra units, mismatched hashes, repeated invocation metrics, flattened
nested repetitions, wrong order and nonterminal/error receipts.

## Case/native contract v1

The retained `cases/adapter-selftest.json` is an executable example. Product
tasks own their `TNN.json`; setup invents no product argv. Required fields:

| Field | Meaning |
|---|---|
| schema/id/task/identities/mode | `measurement-case/v1`, unique case ID, task number, exact original scope identities, `native` or `static` |
| baseline/candidate | literal owned cwd, exact Git `revision` and `tree`, `sources` map of absolute files to SHA256; Git tracked changes fail admission |
| harness/fixtures | common absolute-file SHA256 maps, identical in both phases; native echoes their canonical digest |
| runtime | exact `protocol.runtime()` result, plus domain runtime/browser versions included in `shape`; executable files separately hash-bound |
| shape/economicsDigest | fixed workload/renderer/viewport/load dimensions and preserved economics/provenance identity |
| samplingUnit/temperature/pairs | `invocation`, `warm` or `cold`, fixed measured pair count; sampling definitions cannot change after pilot |
| primary/metrics | primary metric name, metric specifications below |
| commands/allowlist/executables | scenario -> baseline/candidate literal argv arrays, exact allowed arrays, absolute executable -> SHA256 |
| offline/timeout/outputBytes/scratchBytes/scratchRoot | offline must be true; finite positive bounds up to 120s/1MiB/16MiB; scratch under the task-owned RUN_TMP |
| semanticDigest/capabilities | stable meaningful native output digest and exact required capability list |

Product cwd must match an existing `created:true` task-owned checkout in T2's
`ownership.json`, never a primary root. T1's scope allowlist gates every mode,
including metadata operations. Product workers finish native read-only/offline
probe review and literal allowlist binding before dispatch. The wrapper removes
inherited credentials and supplies only PATH, LANG, HOME, cache paths and
`MEASURE_REQUEST`. The literal native probe must enforce its declared offline
behavior: this stdlib adapter is not an OS network sandbox. Shell/SSH/HTTP CLI
dispatch, URLs, unresolved dollar substitutions and token arguments are rejected.

Each metric declares `kind` (`timing`/`counter`), `direction`, `scope`
(`invocation`/`nested`), `repetitions`, `aggregate` (`median`/`sum`/`max`), and
`unit` (`s`/`ms`/`us`, `bytes`/`KiB`, `count`). Counter direction is lower.
An invocation metric requires exactly one native value. Nested values require
exactly the declared repetition count; aggregate within the invocation before
pairing. Give renderer/viewport groups separate metric names or cases; never
flatten groups. Unit normalization converts times to seconds and sizes to bytes.
Optional `tolerance` and `budget` enforce stricter existing budgets in normalized
units. Missing metrics, NaN/infinity, negative values and wrong dimensions fail.
Unsupported CPU/RSS/etc belong in native `unsupported` with reasons, never
invented zeroes or generic pretty-console parsing.

The probe reads JSON `MEASURE_REQUEST` from its environment and echoes every
binding in it: caseHash, phase, unit, sample, scenario, revision, fixtureDigest,
harnessDigest, shape and economicsDigest. It emits exactly one JSON object with
`status: complete`, semanticDigest, capabilities and metrics. Each metric is
`{scope, unit, values:[...]}`. Error/partial/empty/nonzero/timeout output is retained
as ERROR, with no passing metrics. All children share an owned process group;
the wrapper kills the group and waits on every terminal path. Output is bounded
while reading; scratch is monitored during execution and at exit. Probes must
also bound their own instantaneous allocation; polling is not a filesystem quota.
The frozen per-case process timeout includes launch, workload and teardown; its
120-second ceiling accommodates the approved 60-second replay plus setup/cleanup.
It does not change application deadlines or latency targets, and smaller declared
case timeouts remain enforced exactly.

On this macOS host, full Google Chrome 155 creates a `SingletonSocket` outside
owned scratch despite the supplied TMPDIR, so it remains unsupported by the
strict symlink guard. The existing headless shell at
`/Users/reidar/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`
passed the offline native HTML fixture, explicit error and two-second timeout
cleanup without symlinks or watchdog kills. Its version is 156.0.8078.4, CDP 1.3,
SHA256 `77d8278b1ac9d0687fad4e817ea83023ede09b1deef36e1864b49ba194ac9634`.
Product experiments must pin that same engine in both phases and qualify their
own browser capabilities; this compatibility fixture captures no CPU/RSS gain.

Timing uses median absolute relative pilot differences for noise and threshold
`max(.05, 2*noise)`. A primary timing gain must exceed it and the paired bootstrap
95% lower bound must exceed zero (2,000 resamples, seed 1127). Baselines must be
positive and finite. Counter primary must strictly decrease with semantic and
capability parity. Every deterministic secondary counter must not increase;
secondary timing cannot regress beyond its declared tolerance. Zero counters
retain absolute deltas and null relative saving. Small local samples report n,
median and range; descriptive p95 appears only at n>=20. Inconclusive means
NO_PROVEN_GAIN, with no post-result extension.

## Static dispositions and thin audits

Task32 is one `mode:static` case with both metadata identities in `identities`,
source-file hashes in `sources`, and `dispositions:[{identity,outcome,...}]`.
No commands, allowlist, pairs or phase is allowed. It writes exactly one
`E/t32/disposition.json`, separate rows, `runtimeMetrics:null`. Static authored
product cases use the same format. No static case can emit VERIFIED_GAIN.

`compare.py --task N --evidence E` reads `cases/TNN.json`; repeated `--case FILE`
selects explicit multi-case manifests. Task attribution must match. Comparisons
are in `E/tNN/comparison.json`. Each declared scenario needs its complete paired
experiment; domain failure probes report complete only when their failure
assertions pass. Selftest fault scenarios intentionally cannot complete.

`--audit-coverage coverage.json --reports DIR` requires exactly the original
18+2 T1 identities and one `<name>.manifest.json` per identity, with `identity`,
`outcome`, and `evidence:{absolutePath:sha256}`. VERIFIED_GAIN reports additionally
name `case` and `units` paths and recompute raw arithmetic. Missing/stale evidence
fails; BLOCKED remains a disposition, never improvement acceptance.

`--audit-run W/state --reports OUT` reads `state/audit-manifest.json` with schema
`checkpoint-audit/v1`, hash-bound `inputs` and `journal` maps, plus `actions`.
The journal must use installed `github-agent-engineering/action-journal-v1`;
unreconciled PREPARED/DISPATCH_UNKNOWN events fail. Actions have state `verified`,
`no-change` or `WAITING_EXTERNAL`; verified actions require matching successful
`eventId`, hash-bound `authorization` and `readbacks`. `issues` contains Issue
URLs, never PR URLs. The producer freezes the installed journal; it does not
create another scheduler/database or authenticate GitHub readbacks. Task8
continues to own prepare/dispatch/reconcile through installed checkpoint_ops.
Live native readback and original authorization remain the acting parent's gate.

`build_audit_manifest.py --checkpoint FILE --actions FILE --receipt-index FILE
--output FILE` creates this bridge without calling GitHub or running workloads.
The actions document uses schema `portfolio-publication-actions/v1`, an explicit
`coverage` (`partial` or `complete`), a `journals` absolute-path/SHA256 map and
nonempty `actions`. Each action has a unique `id`, included `repository`, `state`
(`verified`, `no-change`, `WAITING_EXTERNAL`) and Issue URLs under `issues`.
Verified rows also name the exact `journal`, `eventId`, `sha`, and nonempty
`authorization`/`readbacks` hash maps. The journal event must be reconciled,
successful, match repository/head, and have its own native receipt in readbacks.
Unresolved/no-change rows require a concrete `reason`; a NOT_DISPATCHED event
retains that result instead of becoming publication success. Unsupported closing
claims, foreign Issue URLs, excluded identities and unknown dispatches reject.

The producer verifies the checkpoint and its actual input bytes, then freezes
byte-identical journals and checkpoint pointer into content-addressed `audit-inputs` files beside the
output. It binds the actions, original authorization/readbacks, scope, receipt
index and checkpoint. The live pointer is rechecked before writing; its captured
bytes remain valid when the next checkpoint is published. It preserves existing different output and rejects symlink
destinations. Full identity coverage is checked only if `coverage=complete`;
partial output cannot substantiate full portfolio acceptance. Authored test
manifests retain `selftestOnly=true`. The subsequent existing audit still owns
receipt provenance, gain arithmetic and report coverage; producer PASS means
publication bindings were assembled, never that the original goal is complete.

## Evidence and limitations

An optional `container` profile, `node22-pidns-v1`, uses only the already cached
public Node22 image and explicit Colima socket. Its individually hash-bound files
are mounted read-only under `/work`; the job has no network, capabilities, writable
root or host credentials. User1000, PID32 and128MiB memory/swap limits are read
back before start. The writable `/tmp` plus1MiB shared memory capacity is reserved
in the same existing scratch budget. `combinedScratchUpperBoundBytes` includes
that full reservation; it is not a measured peak or whole-daemon storage claim.
Names, image IDs and nonce labels are checked before kill/remove. A terminal PID0
and removal readback are required; cleanup failure makes the result ERROR.
The pinned host Python bounds Docker control streams to64KiB each. A separate
in-container timeout bounds producers even if the attachment client dies.
Container cases reserve12seconds for control/cleanup within the120second ceiling.
The authored fixture qualifies only this cached Node dependency graph. It does
not qualify a product, other images, macOS/Swift or browser workloads. The default
process-group backend still cannot contain detached descendants; an earlier
actual canary escaped it. Do not use that backend as generic descendant isolation.

Receipt audits also accept the original `portfolio-done-claim/v1` external
manifest format. Its camelcase workflow/task markers and source revisions remain
unchanged. The manifest and claim must be sealed by an original accepted gate,
whose hash-matching native transcript contains the actual binding-file hash in
a successful tool response. The original frozen case, every raw unit, guard
proof and complete archived source bytes remain required. Copied hash lists,
newly asserted acceptance and text from prompts cannot replace that chain.

The original `portfolio-task-done-claim/v1` numbered format retains its numeric
task and inline evidence map. Its integer task must match the admitted native
task ID; identity, source revisions and the complete frozen case must match the
original claim hashes. The original accepted workflow/native checks still apply.
Workflow markers absent from that original format are never invented.

`E/t05/adapter-tests.json`, `rejections.json` and `check.json` identify retained
CLI receipts and replay argv. `diagnostics.json` records installed basedpyright
results using `tools/pyrightconfig.json`; dynamic JSON dictionaries retain typing
warnings rather than suppressing diagnostics. This setup validates adapters and
authored fixtures only. Product-specific probes, runtime modality, quality,
hardware and publication acceptance belong to their owning tasks.
