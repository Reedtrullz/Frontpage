import { describe, expect, it } from "vitest";
import publicFixture from "../../../../ops/tests/fixtures/observability-v2/public-latest.json";
import ownerFixture from "../../../../ops/tests/fixtures/observability-v2/owner-latest.json";
import seriesFixture from "../../../../ops/tests/fixtures/observability-v2/host-series-1h.json";
import incidentsFixture from "../../../../ops/tests/fixtures/observability-v2/incidents.json";
import {
  parseIncidentListV2,
  parseOwnerLatestV2,
  parsePublicLatestV2,
  parseSeriesV2,
} from "./schema";

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
});
