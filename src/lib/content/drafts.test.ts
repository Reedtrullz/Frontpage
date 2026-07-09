import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCanonicalPersonal, getCanonicalProjects } from "./index";
import {
  derivePublicationState,
  readDraftBundle,
  savePersonalDraft,
  saveProjectsDraft,
  type PublishReceipt,
} from "./drafts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-drafts-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("content drafts", () => {
  it("stores validated drafts outside the public data root", () => {
    const dataDir = makeTempDir();
    const now = () => new Date("2026-07-09T19:00:00Z");

    savePersonalDraft(getCanonicalPersonal(), {
      dataDir,
      baseVersion: "abc1234",
      now,
    });
    saveProjectsDraft(getCanonicalProjects(), {
      dataDir,
      baseVersion: "abc1234",
      now,
    });

    const bundle = readDraftBundle(dataDir);
    expect(bundle.personal).toMatchObject({
      schemaVersion: 1,
      baseVersion: "abc1234",
      savedAt: "2026-07-09T19:00:00.000Z",
    });
    expect(bundle.projects?.content).toHaveLength(14);
    expect(fs.existsSync(path.join(dataDir, "personal.json"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "projects.json"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "drafts", "personal.json"))).toBe(
      true,
    );
  });

  it("rejects invalid content before writing a draft", () => {
    const dataDir = makeTempDir();

    expect(() =>
      savePersonalDraft(
        { ...getCanonicalPersonal(), socials: [{ label: "Bad", url: "file:///tmp" }] },
        { dataDir, baseVersion: "abc1234" },
      ),
    ).toThrow(/http/i);
    expect(fs.existsSync(path.join(dataDir, "drafts", "personal.json"))).toBe(
      false,
    );
  });
});

describe("publication state", () => {
  it("distinguishes a saved draft from deployed content", () => {
    expect(
      derivePublicationState({
        draftChanged: true,
        receipt: null,
        deployedVersion: "abc1234",
      }),
    ).toEqual({ kind: "draft-saved", label: "Draft saved" });
  });

  it("distinguishes awaiting deploy from deployed", () => {
    const receipt: PublishReceipt = {
      schemaVersion: 1,
      kind: "published",
      recordedAt: "2026-07-09T19:00:00.000Z",
      baseVersion: "abc1234",
      commitSha: "def5678def5678def5678def5678def5678def5",
      commitUrl: "https://github.com/Reedtrullz/Frontpage/commit/def5678def5678def5678def5678def5678def5",
    };

    expect(
      derivePublicationState({
        draftChanged: false,
        receipt,
        deployedVersion: "abc1234",
      }).kind,
    ).toBe("awaiting-deploy");
    expect(
      derivePublicationState({
        draftChanged: false,
        receipt,
        deployedVersion: "sha-def5678def5678def5678def5678def5678def5",
      }),
    ).toMatchObject({ kind: "deployed", label: "Deployed" });
  });
});
