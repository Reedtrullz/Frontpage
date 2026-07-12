# Frontpage eBPF Network Attribution Readiness Gate

**Status:** design and evidence gate only. No helper is installed and no Linux capability is granted by this change.

## Purpose

Host network throughput is available in observability v2. Per-workload network attribution remains unavailable until a separately reviewed eBPF collector can prove bounded identity, accounting, privilege, packaging, and rollback behavior. The dashboard must continue to say `Network workload attribution unavailable` until every gate below passes.

## Host Evidence

Capture these values from the target VPS and attach them to the future security review:

```bash
uname -r
stat -fc %T /sys/fs/cgroup
test -r /sys/kernel/btf/vmlinux && sha256sum /sys/kernel/btf/vmlinux
cat /sys/kernel/security/lockdown 2>/dev/null || true
sysctl kernel.unprivileged_bpf_disabled 2>/dev/null || true
systemd-analyze security frontpage-network-attribution.service
```

Required results:

- A supported, pinned kernel version with cgroup v2 mounted.
- Readable BTF at `/sys/kernel/btf/vmlinux`, with its SHA recorded.
- Lockdown mode and `kernel.unprivileged_bpf_disabled` explicitly reviewed.
- No Docker socket, host PID namespace, shell, SSH, or broad root service.
- The main `frontpage-observer` service remains capability-free.

## Capability Boundary

Any helper must run as a separate dedicated user and service. Its bounding and ambient capability sets may contain only `CAP_BPF` and, where the selected kernel demonstrably requires it, `CAP_PERFMON`. `CAP_SYS_ADMIN`, `CAP_NET_ADMIN`, and supplementary `docker` membership are prohibited.

The helper communicates through one bounded, root-owned interface. The existing collector may read only sanitized counters from that interface. It must not load programs, mutate maps, or receive capabilities itself.

## Packaging Gate

The future implementation must provide:

- Reproducible source build and pinned dependency hashes.
- A versioned CO-RE object matched against the recorded BTF evidence.
- Package signature or checksum verification before installation.
- systemd hardening at least as strict as Collector v2, adjusted only for the two reviewed capabilities.
- Explicit install, upgrade, disable, uninstall, and rollback procedures.
- A cold-start path where the helper is absent and host network totals remain available.

## Counter Contract

The helper output must be a versioned, bounded record set:

```json
{
  "schema_version": 1,
  "observed_at": "UTC timestamp",
  "interval_ms": 15000,
  "rows": [
    {
      "cgroup_id": "unsigned decimal string",
      "rx_bytes_delta": 0,
      "tx_bytes_delta": 0,
      "rx_packets_delta": 0,
      "tx_packets_delta": 0
    }
  ]
}
```

Rows are capped at 256 and contain no IP address, port, packet payload, process command, DNS name, socket identifier, or unbounded label. Counter resets, cgroup reuse, dropped events, and interval gaps must be explicit. Runtime-map resolution remains allowlist-only; unresolved cgroups contribute to `system/untracked`.

## Accuracy And Security Review

Promotion requires fixture tests plus a minimum 48-hour host comparison against authoritative interface totals. Required evidence:

- Attribution coverage and reconciliation error for RX and TX separately.
- Counter-reset, cgroup-deletion, cgroup-reuse, reboot, and helper-restart tests.
- Sustained-load and map-capacity behavior without unbounded memory growth.
- No packet contents or endpoint metadata in maps, logs, files, APIs, or UI.
- Public redaction proof and authenticated owner API proof.
- Independent review of BPF verifier assumptions, attachment points, map permissions, capabilities, and systemd sandbox exceptions.

Only after that review may network workload projections be published. This readiness document is not evidence that the host supports the helper, that the helper is secure, or that workload network attribution is live.
