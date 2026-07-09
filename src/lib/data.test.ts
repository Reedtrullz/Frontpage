import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
const originalDataDir = process.env.DATA_DIR;
const originalVersion = process.env.VERSION;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-data-"));
  tempDirs.push(dir);
  return dir;
}

async function importDataModule(dataDir: string) {
  vi.resetModules();
  process.env.DATA_DIR = dataDir;
  process.env.VERSION = "test-version";
  return import("./data");
}

afterEach(() => {
  restoreEnv("DATA_DIR", originalDataDir);
  restoreEnv("VERSION", originalVersion);
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime data files", () => {
  it("initializes an empty DATA_DIR without logging missing version-file errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dataDir = makeTempDir();
    const { getProjects } = await importDataModule(dataDir);

    const projects = getProjects();

    expect(projects.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(dataDir, ".data_version"), "utf8")).toBe(
      "test-version",
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
