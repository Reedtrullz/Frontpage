import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCanonicalPersonal, getCanonicalProjects } from "./index";
import { readDraftBundle, saveProjectsDraft } from "./drafts";
import {
  publishCanonicalContent,
  type GitPublicationClient,
} from "./publication";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-publish-"));
  tempDirs.push(dir);
  return dir;
}

function fakeClient(headSha = "abc1234abc1234abc1234abc1234abc1234abcd") {
  const client: GitPublicationClient = {
    getHead: vi.fn().mockResolvedValue({
      commitSha: headSha,
      treeSha: "tree-before",
    }),
    createBlob: vi
      .fn()
      .mockResolvedValueOnce("personal-blob")
      .mockResolvedValueOnce("projects-blob"),
    createTree: vi.fn().mockResolvedValue("tree-after"),
    createCommit: vi
      .fn()
      .mockResolvedValue("def5678def5678def5678def5678def5678def5"),
    updateHead: vi.fn().mockResolvedValue(undefined),
    getCommitUrl: vi.fn(
      (sha: string) =>
        `https://github.com/Reedtrullz/Frontpage/commit/${sha}`,
    ),
  };
  return client;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("canonical content publication", () => {
  it("publishes both files through one tree and one commit", async () => {
    const dataDir = makeTempDir();
    saveProjectsDraft(getCanonicalProjects(), {
      dataDir,
      baseVersion: "abc1234",
    });
    const client = fakeClient();

    const result = await publishCanonicalContent(
      {
        personal: getCanonicalPersonal(),
        projects: getCanonicalProjects(),
        baseVersion: "abc1234",
        dataDir,
        now: () => new Date("2026-07-09T19:00:00Z"),
      },
      client,
    );

    expect(result.kind).toBe("published");
    expect(client.createBlob).toHaveBeenCalledTimes(2);
    expect(client.createTree).toHaveBeenCalledTimes(1);
    expect(client.createCommit).toHaveBeenCalledTimes(1);
    expect(client.updateHead).toHaveBeenCalledWith(
      "def5678def5678def5678def5678def5678def5",
    );
    expect(readDraftBundle(dataDir).projects).toBeNull();
    expect(readDraftBundle(dataDir).receipt).toMatchObject({
      kind: "published",
      commitSha: "def5678def5678def5678def5678def5678def5",
    });
  });

  it("preserves drafts when the deployed base no longer matches main", async () => {
    const dataDir = makeTempDir();
    saveProjectsDraft(getCanonicalProjects(), {
      dataDir,
      baseVersion: "abc1234",
    });
    const client = fakeClient("9999999999999999999999999999999999999999");

    const result = await publishCanonicalContent(
      {
        personal: getCanonicalPersonal(),
        projects: getCanonicalProjects(),
        baseVersion: "abc1234",
        dataDir,
      },
      client,
    );

    expect(result.kind).toBe("conflict");
    expect(client.createBlob).not.toHaveBeenCalled();
    expect(readDraftBundle(dataDir).projects).not.toBeNull();
    expect(readDraftBundle(dataDir).receipt?.kind).toBe("conflict");
  });

  it("returns a sanitized failure and keeps drafts", async () => {
    const dataDir = makeTempDir();
    saveProjectsDraft(getCanonicalProjects(), {
      dataDir,
      baseVersion: "abc1234",
    });
    const client = fakeClient();
    vi.mocked(client.createBlob).mockReset();
    vi.mocked(client.createBlob).mockRejectedValue(
      new Error("secret-token leaked by upstream"),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await publishCanonicalContent(
      {
        personal: getCanonicalPersonal(),
        projects: getCanonicalProjects(),
        baseVersion: "abc1234",
        dataDir,
      },
      client,
    );

    expect(result).toEqual({
      kind: "failed",
      message: "Publication failed. The draft was preserved.",
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(readDraftBundle(dataDir).projects).not.toBeNull();
  });
});
