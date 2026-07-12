import { describe, expect, it } from "vitest";
import publicFixture from "../../../../ops/tests/fixtures/observability-v2/public-latest.json";
import ownerFixture from "../../../../ops/tests/fixtures/observability-v2/owner-latest.json";
import seriesFixture from "../../../../ops/tests/fixtures/observability-v2/host-series-1h.json";
import incidentsFixture from "../../../../ops/tests/fixtures/observability-v2/incidents.json";
import {
  MAX_OWNER_API_RANKED_WORKLOAD_SERIES,
  MAX_OWNER_API_UNTRACKED_SERIES,
  MAX_OWNER_API_WORKLOAD_SERIES,
  MAX_OWNER_LATEST_WORKLOADS,
  parseIncidentListV2,
  parseOwnerLatestV2,
  parsePublicLatestV2,
  parseSeriesV2,
} from "./schema";

function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildApprovedOwnerFixture(): Record<string, unknown> {
  const payload = cloneFixture(ownerFixture) as {
    workloads: Array<{
      id: string;
      resources: Array<{ resource: string }>;
      processes: Array<Record<string, unknown>>;
    }>;
  };

  payload.workloads = payload.workloads.map((workload) => ({
    ...workload,
    resources: workload.resources.filter((resource) => resource.resource !== "network"),
    processes: workload.processes.map((process) => {
      const rest = { ...process };
      delete rest.id;
      return {
        workload_id: workload.id,
        ...rest,
      };
    }),
  }));

  return payload as Record<string, unknown>;
}

function buildOwnerLatestWithWorkloadCount(
  workloadCount: number,
): Record<string, unknown> {
  const payload = buildApprovedOwnerFixture() as {
    workloads: Array<Record<string, unknown>>;
  };
  const template = payload.workloads[0] as {
    resources: Array<Record<string, unknown>>;
    processes: Array<Record<string, unknown>>;
  };

  payload.workloads = Array.from({ length: workloadCount }, (_, index) => {
    const workload = cloneFixture(template);
    const workloadId =
      index === workloadCount - 1 ? "system-untracked" : `workload-${index + 1}`;

    return {
      ...workload,
      id: workloadId,
      label: index === workloadCount - 1 ? "system/untracked" : `workload-${index + 1}`,
      systemd_unit: `workload-${index + 1}.service`,
      cgroup_path: `system.slice/workload-${index + 1}.service`,
      container_id: `workload-${index + 1}-ctr`,
      processes: workload.processes.map((process, processIndex) => ({
        ...process,
        workload_id: workloadId,
        pid: 5000 + index * 10 + processIndex,
      })),
    };
  });

  return payload as Record<string, unknown>;
}

function buildWorkloadSeriesPayload(
  seriesCount: number,
): Record<string, unknown> {
  const payload = cloneFixture(seriesFixture) as {
    view: string;
    resource: string | null;
    series: Array<Record<string, unknown>>;
  };
  const template = payload.series[0];

  payload.view = "workloads";
  payload.resource = "cpu";
  payload.series = Array.from({ length: seriesCount }, (_, index) => {
    const isUntracked = index === MAX_OWNER_API_RANKED_WORKLOAD_SERIES;
    const isOverflow = index > MAX_OWNER_API_RANKED_WORKLOAD_SERIES;
    const id = isUntracked
      ? "system-untracked"
      : isOverflow
        ? `overflow-${index - MAX_OWNER_API_RANKED_WORKLOAD_SERIES}`
        : `workload-${index + 1}`;

    return {
      ...cloneFixture(template),
      id,
      label: isUntracked ? "system/untracked" : id,
    };
  });

  return payload as Record<string, unknown>;
}

describe("observability v2 contracts", () => {
  it("parses the canonical v2 fixtures", () => {
    expect(parsePublicLatestV2(publicFixture).schema_version).toBe(2);
    expect(parseOwnerLatestV2(ownerFixture).workloads).toHaveLength(2);
    expect(parseSeriesV2(seriesFixture).range).toBe("1h");
    expect(parseIncidentListV2(incidentsFixture).incidents).toHaveLength(1);
  });

  it("rejects owner identities in the public contract", () => {
    expect(() =>
      parsePublicLatestV2({ ...publicFixture, workloads: ownerFixture.workloads }),
    ).toThrow(/Invalid public observability payload/);
  });

  it("uses approved process workload ids and rejects mismatched workload ownership", () => {
    const approvedPayload = buildApprovedOwnerFixture();
    const parsed = parseOwnerLatestV2(approvedPayload);
    const matchingProcess = parsed.workloads[0]?.processes[0];

    expect(matchingProcess?.workload_id).toBe(parsed.workloads[0]?.id);

    const mismatchedPayload = buildApprovedOwnerFixture() as {
      workloads: Array<{ processes: Array<{ workload_id: string }> }>;
    };
    mismatchedPayload.workloads[0].processes[0].workload_id = "system-untracked";

    expect(() => parseOwnerLatestV2(mismatchedPayload)).toThrow(
      /workload_id must match its containing workload/i,
    );
  });

  it("rejects workload network rows when host network workload view is unavailable", () => {
    const payload = buildApprovedOwnerFixture() as {
      workloads: Array<{
        resources: Array<Record<string, unknown>>;
      }>;
    };
    payload.workloads[0].resources.push({
      resource: "network",
      unit: "bytes_per_second",
      current: 0,
      average: 0,
      peak: 0,
      change_1h: null,
      coverage_percent: 0,
    });

    expect(() => parseOwnerLatestV2(payload)).toThrow(
      /network resource rows may not be serialized for workloads/i,
    );
  });

  it("keeps owner-latest workload capacity distinct from owner API series capacity", () => {
    expect(MAX_OWNER_LATEST_WORKLOADS).toBe(32);
    expect(MAX_OWNER_API_RANKED_WORKLOAD_SERIES).toBe(16);
    expect(MAX_OWNER_API_UNTRACKED_SERIES).toBe(1);
    expect(MAX_OWNER_API_WORKLOAD_SERIES).toBe(17);

    const ownerLatestPayload = buildOwnerLatestWithWorkloadCount(
      MAX_OWNER_LATEST_WORKLOADS,
    );
    expect(parseOwnerLatestV2(ownerLatestPayload).workloads).toHaveLength(
      MAX_OWNER_LATEST_WORKLOADS,
    );

    const workloadSeriesPayload = buildWorkloadSeriesPayload(
      MAX_OWNER_API_WORKLOAD_SERIES,
    );
    expect(parseSeriesV2(workloadSeriesPayload).series).toHaveLength(
      MAX_OWNER_API_WORKLOAD_SERIES,
    );

    const overflowPayload = buildWorkloadSeriesPayload(
      MAX_OWNER_API_WORKLOAD_SERIES + 1,
    );
    expect(() => parseSeriesV2(overflowPayload)).toThrow(
      /Invalid observability series payload/,
    );
  });
});
