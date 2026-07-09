import {
  derivePublicationState,
  readDraftBundle,
  type ContentPublicationState,
  type DraftBundle,
  type PublishReceipt,
} from "./drafts";
import { getCanonicalPersonal, getCanonicalProjects } from "./index";
import {
  personalSchema,
  projectSchema,
  type PersonalContent,
  type ProjectContent,
} from "./schema";

export type ProjectDraftMarker =
  | "unchanged"
  | "modified"
  | "added"
  | "removed";

export interface ValidationSummary {
  valid: boolean;
  issues: string[];
}

export interface AdminContentView {
  deployedVersion: string;
  draftBaseVersion: string | null;
  draftCount: number;
  hasPersonalDraft: boolean;
  hasProjectsDraft: boolean;
  personal: PersonalContent;
  projects: ProjectContent[];
  canonicalPersonal: PersonalContent;
  canonicalProjects: ProjectContent[];
  projectMarkers: Map<string, ProjectDraftMarker>;
  publicationState: ContentPublicationState;
  receipt: PublishReceipt | null;
  validation: {
    personal: ValidationSummary;
    projects: ValidationSummary;
  };
  diff: string[];
}

export interface RunbookCommand {
  id: string;
  label: string;
  command: string;
}

export const RUNBOOK_COMMANDS: RunbookCommand[] = [
  {
    id: "deploy",
    label: "Deploy current main",
    command:
      "ansible-playbook -i inventory/hosts.yml ansible-playbook.yml --vault-password-file .vault_pass",
  },
  {
    id: "verify-site",
    label: "Verify public app health",
    command: "curl --fail --silent --show-error https://reidar.tech/api/health | jq",
  },
  {
    id: "verify-inventory",
    label: "Verify inventory connectivity",
    command: "ansible -i inventory/hosts.yml vps -m ping",
  },
  {
    id: "verify-collector",
    label: "Verify metrics timer",
    command:
      "ansible -i inventory/hosts.yml vps -b -m shell -a \"systemctl is-active frontpage-metrics-collector.timer\"",
  },
];

function formatIssues(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export function summarizeProjectValidation(input: unknown): ValidationSummary {
  const result = projectSchema.safeParse(input);
  return result.success
    ? { valid: true, issues: [] }
    : { valid: false, issues: formatIssues(result.error.issues) };
}

function summarizePersonalValidation(input: unknown): ValidationSummary {
  const result = personalSchema.safeParse(input);
  return result.success
    ? { valid: true, issues: [] }
    : { valid: false, issues: formatIssues(result.error.issues) };
}

function sameContent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function projectDraftMarkers(
  canonical: ProjectContent[],
  draft: ProjectContent[] | null,
): Map<string, ProjectDraftMarker> {
  const markers = new Map<string, ProjectDraftMarker>();
  const canonicalBySlug = new Map(canonical.map((project) => [project.slug, project]));
  const draftBySlug = new Map((draft ?? canonical).map((project) => [project.slug, project]));

  for (const project of canonical) {
    const draftProject = draftBySlug.get(project.slug);
    markers.set(
      project.slug,
      !draftProject
        ? "removed"
        : sameContent(project, draftProject)
          ? "unchanged"
          : "modified",
    );
  }
  for (const project of draft ?? []) {
    if (!canonicalBySlug.has(project.slug)) markers.set(project.slug, "added");
  }
  return markers;
}

function changedKeys(
  canonical: Record<string, unknown>,
  draft: Record<string, unknown>,
): string[] {
  return Array.from(new Set([...Object.keys(canonical), ...Object.keys(draft)]))
    .filter((key) => !sameContent(canonical[key], draft[key]))
    .toSorted();
}

export function summarizeContentDiff(input: {
  canonicalPersonal: PersonalContent;
  canonicalProjects: ProjectContent[];
  draftPersonal: PersonalContent | null;
  draftProjects: ProjectContent[] | null;
}): string[] {
  const entries: string[] = [];
  if (input.draftPersonal) {
    entries.push(
      ...changedKeys(
        input.canonicalPersonal as unknown as Record<string, unknown>,
        input.draftPersonal as unknown as Record<string, unknown>,
      ).map((field) => `Personal: ${field} changed`),
    );
  }

  if (input.draftProjects) {
    const canonicalBySlug = new Map(
      input.canonicalProjects.map((project) => [project.slug, project]),
    );
    const draftBySlug = new Map(
      input.draftProjects.map((project) => [project.slug, project]),
    );
    for (const project of input.draftProjects) {
      const canonical = canonicalBySlug.get(project.slug);
      if (!canonical) {
        entries.push(`${project.name}: project added`);
        continue;
      }
      entries.push(
        ...changedKeys(
          canonical as unknown as Record<string, unknown>,
          project as unknown as Record<string, unknown>,
        ).map((field) => `${project.name}: ${field} changed`),
      );
    }
    for (const project of input.canonicalProjects) {
      if (!draftBySlug.has(project.slug)) {
        entries.push(`${project.name}: project removed`);
      }
    }
  }
  return entries;
}

export function buildAdminContentView(input: {
  canonicalPersonal: PersonalContent;
  canonicalProjects: ProjectContent[];
  drafts: DraftBundle;
  deployedVersion: string;
}): AdminContentView {
  const personal = input.drafts.personal?.content ?? input.canonicalPersonal;
  const projects = input.drafts.projects?.content ?? input.canonicalProjects;
  const draftCount = Number(Boolean(input.drafts.personal)) + Number(Boolean(input.drafts.projects));
  const baseVersions = Array.from(
    new Set(
      [input.drafts.personal?.baseVersion, input.drafts.projects?.baseVersion].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
  const projectValidation = projects.map(summarizeProjectValidation);

  return {
    deployedVersion: input.deployedVersion,
    draftBaseVersion:
      baseVersions.length === 0
        ? null
        : baseVersions.length === 1
          ? baseVersions[0]
          : "mixed",
    draftCount,
    hasPersonalDraft: Boolean(input.drafts.personal),
    hasProjectsDraft: Boolean(input.drafts.projects),
    personal,
    projects,
    canonicalPersonal: input.canonicalPersonal,
    canonicalProjects: input.canonicalProjects,
    projectMarkers: projectDraftMarkers(
      input.canonicalProjects,
      input.drafts.projects?.content ?? null,
    ),
    publicationState: derivePublicationState({
      draftChanged: draftCount > 0,
      receipt: input.drafts.receipt,
      deployedVersion: input.deployedVersion,
    }),
    receipt: input.drafts.receipt,
    validation: {
      personal: summarizePersonalValidation(personal),
      projects: projectValidation.every((result) => result.valid)
        ? { valid: true, issues: [] }
        : {
            valid: false,
            issues: projectValidation.flatMap((result) => result.issues),
          },
    },
    diff: summarizeContentDiff({
      canonicalPersonal: input.canonicalPersonal,
      canonicalProjects: input.canonicalProjects,
      draftPersonal: input.drafts.personal?.content ?? null,
      draftProjects: input.drafts.projects?.content ?? null,
    }),
  };
}

export function readAdminContentView(): AdminContentView {
  return buildAdminContentView({
    canonicalPersonal: getCanonicalPersonal(),
    canonicalProjects: getCanonicalProjects(),
    drafts: readDraftBundle(),
    deployedVersion: process.env.VERSION || "dev",
  });
}
