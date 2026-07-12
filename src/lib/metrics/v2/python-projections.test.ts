import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseIncidentListV2,
  parseOwnerLatestV2,
  parsePublicLatestV2,
  parseSeriesV2,
} from "./schema";

describe("Python observability projections", () => {
  it("conform to every strict v2 web contract", () => {
    const fixture = path.join(
      process.cwd(),
      "ops/tests/fixtures/observability-v2/projection-snapshot.json",
    );
    const script = [
      "import json, sys",
      "from pathlib import Path",
      "from ops.frontpage_metrics_v2.projections import build_projection_files",
      "snapshot = json.loads(Path(sys.argv[1]).read_text())",
      "print(json.dumps(build_projection_files(snapshot)))",
    ].join("; ");
    const generated = JSON.parse(
      execFileSync("python3", ["-c", script, fixture], {
        cwd: process.cwd(),
        encoding: "utf8",
      }),
    );

    expect(parsePublicLatestV2(generated.public["latest.v2.json"]).schema_version).toBe(2);
    expect(parseIncidentListV2(generated.public["incidents.v2.json"]).incidents).toEqual([]);
    expect(parseOwnerLatestV2(generated.owner["latest.v2.json"]).workloads.at(-1)?.id).toBe(
      "system-untracked",
    );
    expect(parseSeriesV2(generated.owner["host/1h.v2.json"]).timestamps).toHaveLength(1);
    expect(parseIncidentListV2(generated.owner["incidents.v2.json"]).incidents).toEqual([]);
  });
});
