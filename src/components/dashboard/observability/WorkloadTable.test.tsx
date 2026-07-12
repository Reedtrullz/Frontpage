import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseOwnerLatestV2 } from "@/lib/metrics/v2/schema";
import { WorkloadTable } from "./WorkloadTable";

const latest = parseOwnerLatestV2(
  JSON.parse(
    fs.readFileSync(
      path.resolve("ops/tests/fixtures/observability-v2/owner-latest.json"),
      "utf8",
    ),
  ),
);

describe("WorkloadTable", () => {
  it("uses semantic sortable rows and bounded expansion controls", () => {
    const markup = renderToStaticMarkup(
      <WorkloadTable
        defaultExpandedWorkloadId="frontpage-app"
        incidents={latest.incidents}
        workloads={latest.workloads}
      />,
    );
    expect(markup).toContain("<table");
    expect(markup).toContain("scope=\"row\"");
    expect(markup).toContain("aria-sort=\"ascending\"");
    expect(markup).toContain("aria-expanded=\"true\"");
    expect(markup).toContain("Current processes");
    for (const field of ["PID", "Command", "UID", "CPU", "RSS", "State"]) {
      expect(markup).toContain(field);
    }
  });

  it("never renders raw runtime paths or container identifiers", () => {
    const markup = renderToStaticMarkup(
      <WorkloadTable
        defaultExpandedWorkloadId="frontpage-app"
        incidents={latest.incidents}
        workloads={latest.workloads}
      />,
    );
    expect(markup).not.toContain("system.slice/frontpage.service");
    expect(markup).not.toContain("frontpage.service");
    expect(markup).not.toContain("frontpage-ctr");
    expect(markup).toContain("frontpage-app");
    expect(markup).toContain("container workload");
    expect(markup).toContain("One OOM kill was recorded");
  });
});
