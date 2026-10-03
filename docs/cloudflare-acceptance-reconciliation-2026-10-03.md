# Cloudflare acceptance reconciliation — 3 October 2026

This receipt separates shipped implementation from real acceptance of issues #45 and #46. The installed comparator was executed again on the VPS at `2026-10-03T13:28:08Z`; cached JSON was not used as approval. Source remains main `c45bc2a5517eb2435bea89fd4194b638fd48a96c`.

Sampling alignment shipped through PR #56 and corrections #57, #58 and #60. The bounded v2 transport/read-pointer prototype shipped through PR #59 and the [activation runbook](cloudflare-v2-activation.md). Existing schema-3 deterministic comparator and upload tests remain required. The new branch adds actual built Worker/DO runtime testing, coherent v1 generations, bounded history queries, and dashboard refresh; it does not activate v2.

| Installed evidence | Fresh result | Required |
| --- | --- | --- |
| Schema and approval | 3; `approved=false` | 3; true |
| Continuous comparison duration | 20.367 hours | At least 48 hours |
| Paired minutes | 1,223 | Complete required window |
| Missed minutes | 0 | 0 |
| Maximum gap | 60 seconds | At most 120 seconds |
| Current incomplete v1/v2 host minutes | 0 / 0 | 0 / 0 |
| Historical incomplete v2 host minutes since epoch | 1 | Must be reported and assessed under unchanged gate |
| Evidence age | 68.234 seconds | At most 120 seconds |
| CPU p99 relative divergence | 0.04618% | At most 2% |
| RAM p99 relative divergence | 0.06844% | At most 2% |
| Disk p99 relative divergence | 0.00000145% | At most 2% |
| Public service comparisons | 7,338 | Comparable complete samples |
| Public service mismatch | 0.013627691469065142% | Exactly 0% |
| Private database size | 132,850,176 bytes | Record budget evidence |
| Projections total size | 29,412,988 bytes | Record transport/read budgets |

The epoch started at `2026-10-02T17:04:16Z` for a collector/comparator change, bound to `c45bc2a5517eb2435bea89fd4194b638fd48a96c`. The comparison window was `2026-10-02T17:05:00Z`–`2026-10-03T13:27:00Z`. V1 collector, v2 shadow collector, original v1 collector timer, and v1 upload timer were active when inspected. No collector was restarted, no evidence was reset, and no upload/activation service was installed or enabled by this execution.

| Installed artifact | SHA-256 |
| --- | --- |
| V1 collector | `f8e39fd11ac3f4bd97a1ba6e08b002454a63bf5afe05cd666b63ab6778e701bc` |
| V2 collector | `fee51ebc5393a75a4fc52cd81d135e86faa94b625535c9668759386566cf3761` |
| Comparator | `01ab8bdfaf58514cdea8d4fe1ed77e42f4d37ceaccfe95ea5b5eb0db59c63170` |
| Epoch receipt | `691d67f322a16054ef2af2666ee418856a970c8936339a36fe3d9feb03f5e94b` |

Both duration and zero-mismatch requirements remain unsatisfied. Preserve genuine mismatch and unavailable records. Continue the existing acceptance process and regenerate evidence immediately before any operator decision. Engineering tests do not replace repeated live public freshness/redaction and authenticated owner latest/series/incidents checks, observer isolation, upload budgets, exact deployed identity, or isolated deactivation proof. Any collector installation from this issue batch needs its own documented evidence implications; do not silently insert it into the ongoing window.
