import { describe, expect, it } from "vitest";
import { getCanonicalPersonal, getCanonicalProjects } from "./index";
import type { DraftBundle } from "./drafts";
import {
  RUNBOOK_COMMANDS,
  buildAdminContentView,
  projectDraftMarkers,
  summarizeContentDiff,
  summarizeProjectValidation,
} from "./admin-view";

const canonicalPersonal = getCanonicalPersonal();
const canonicalProjects = getCanonicalProjects();
const emptyDrafts: DraftBundle = {
  personal: null,
  projects: null,
  receipt: null,
};

describe("admin content view", () => {
  it("distinguishes draft state from deployed state", () => {
    const drafts: DraftBundle = {
      ...emptyDrafts,
      personal: {
        schemaVersion: 1,
        baseVersion: "abc1234",
        savedAt: "2026-07-09T19:00:00Z",
        content: { ...canonicalPersonal, title: "Draft title" },
      },
    };

    const view = buildAdminContentView({
      canonicalPersonal,
      canonicalProjects,
      drafts,
      deployedVersion: "abc1234",
    });

    expect(view.publicationState).toEqual({
      kind: "draft-saved",
      label: "Draft saved",
    });
    expect(view.draftCount).toBe(1);
    expect(view.personal.title).toBe("Draft title");
    expect(view.deployedVersion).toBe("abc1234");
  });

  it("marks only changed projects as draft changes", () => {
    const draftProjects = canonicalProjects.map((project) =>
      project.slug === "rfs"
        ? { ...project, outcome: "Updated draft outcome for the simulator." }
        : project,
    );

    expect(
      projectDraftMarkers(canonicalProjects, draftProjects).get("rfs"),
    ).toBe("modified");
    expect(
      projectDraftMarkers(canonicalProjects, draftProjects).get("nytt"),
    ).toBe("unchanged");
  });

  it("summarizes complete-field validation failures", () => {
    const result = summarizeProjectValidation({
      ...canonicalProjects[0],
      outcome: "",
      evidence: { ...canonicalProjects[0].evidence, note: "" },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toMatch(/outcome/i);
    expect(result.issues.join(" ")).toMatch(/evidence.note/i);
  });

  it("produces human-readable diff entries", () => {
    const entries = summarizeContentDiff({
      canonicalPersonal,
      canonicalProjects,
      draftPersonal: { ...canonicalPersonal, title: "Draft title" },
      draftProjects: canonicalProjects.map((project) =>
        project.slug === "heimdall"
          ? { ...project, lifecycle: "maintained" as const }
          : project,
      ),
    });

    expect(entries).toContain("Personal: title changed");
    expect(entries).toContain("Heimdall: lifecycle changed");
  });
});

describe("runbook commands", () => {
  it("uses inventory aliases and contains no raw host or key paths", () => {
    const commands = RUNBOOK_COMMANDS.map((item) => item.command).join("\n");

    expect(commands).toContain("inventory/hosts.yml");
    expect(commands).toContain(" vps ");
    expect(commands).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    expect(commands).not.toContain("~/.ssh");
    expect(commands).not.toContain("/Users/");
    expect(commands).not.toMatch(/token|password=/i);
  });
});
