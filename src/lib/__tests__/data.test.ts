import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function customProject() {
  return {
    slug: "runtime-edited-project",
    name: "Runtime Edited Project",
    shortDescription: "Edited through the admin UI at runtime.",
    longDescription: "This project exists only in the runtime data volume and must survive deploy version changes.",
    tags: ["runtime"],
    techStack: ["Next.js"],
    status: "active" as const,
    category: "frontend" as const,
    featured: false,
  };
}

function snapshotRepoProjects(): { path: string; existed: boolean; content: string | null } {
  const repoProjectsPath = path.join(process.cwd(), "public/data/projects.json");
  const existed = fs.existsSync(repoProjectsPath);
  return {
    path: repoProjectsPath,
    existed,
    content: existed ? fs.readFileSync(repoProjectsPath, "utf-8") : null,
  };
}

function expectRepoProjectsUnchanged(snapshot: { path: string; existed: boolean; content: string | null }) {
  if (snapshot.existed) {
    expect(fs.readFileSync(snapshot.path, "utf-8")).toBe(snapshot.content);
  } else {
    expect(fs.existsSync(snapshot.path)).toBe(false);
  }
}

describe("runtime data persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-data-"));
    process.env = { ...ORIGINAL_ENV, DATA_DIR: tempDir, VERSION: "new-version" };
  });

  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("preserves existing runtime projects when deploy version changes", async () => {
    const runtimeProjects = [customProject()];
    const runtimeProjectsPath = path.join(tempDir, "projects.json");
    const runtimeVersionPath = path.join(tempDir, ".data_version");
    fs.writeFileSync(runtimeProjectsPath, JSON.stringify(runtimeProjects, null, 2));
    fs.writeFileSync(runtimeVersionPath, "old-version");
    const repoSnapshot = snapshotRepoProjects();

    const { getProjects } = await import("../data");

    expect(getProjects()).toEqual(runtimeProjects);
    expect(JSON.parse(fs.readFileSync(runtimeProjectsPath, "utf-8"))).toEqual(runtimeProjects);
    expect(fs.readFileSync(runtimeVersionPath, "utf-8")).toBe("old-version");
    expectRepoProjectsUnchanged(repoSnapshot);
  });

  it("creates missing version metadata without replacing existing runtime projects", async () => {
    const runtimeProjects = [customProject()];
    const runtimeProjectsPath = path.join(tempDir, "projects.json");
    const runtimeVersionPath = path.join(tempDir, ".data_version");
    fs.writeFileSync(runtimeProjectsPath, JSON.stringify(runtimeProjects, null, 2));

    const { getProjects } = await import("../data");

    expect(getProjects()).toEqual(runtimeProjects);
    expect(JSON.parse(fs.readFileSync(runtimeProjectsPath, "utf-8"))).toEqual(runtimeProjects);
    expect(fs.readFileSync(runtimeVersionPath, "utf-8")).toBe("new-version");
  });

  it("quarantines corrupt runtime JSON before writing bundled fallback data", async () => {
    const runtimeProjectsPath = path.join(tempDir, "projects.json");
    const runtimeVersionPath = path.join(tempDir, ".data_version");
    fs.writeFileSync(runtimeProjectsPath, "{not-json");
    fs.writeFileSync(runtimeVersionPath, "old-version");

    const { getProjects } = await import("../data");
    const projects = getProjects();

    expect(projects.some((project) => project.slug === "runtime-edited-project")).toBe(false);
    expect(JSON.parse(fs.readFileSync(runtimeProjectsPath, "utf-8"))).toEqual(projects);
    expect(fs.readFileSync(runtimeVersionPath, "utf-8")).toBe("new-version");
    const corruptFiles = fs.readdirSync(tempDir).filter((file) => file.startsWith("projects.json.corrupt."));
    expect(corruptFiles).toHaveLength(1);
    expect(fs.readFileSync(path.join(tempDir, corruptFiles[0]), "utf-8")).toBe("{not-json");
  });
});
