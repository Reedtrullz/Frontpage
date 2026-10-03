import type { ProjectContent, PublicRepository } from "@/lib/content/schema";
import type { GitHubStats } from "@/lib/github-stats";
import type { ProjectEvidence, ProjectMilestone } from "@/lib/content/schema";

export type ProjectSort = "featured" | "evidence" | "name";
export type ProjectLifecycleFilter = ProjectContent["lifecycle"] | "all" | "current";

export interface ProjectFilters {
  query: string;
  lifecycle: ProjectLifecycleFilter;
  maturity: ProjectContent["maturity"] | "all";
  category: ProjectContent["category"] | "all";
}

export interface RepositoryActivity {
  stars: number;
  language: string | null;
  lastCommitDate: string | null;
  lastCommitMessage: string | null;
}

export type RepositoryStatus = "no-repository" | "unavailable" | "no-commits" | "updated";

export type EvidenceReviewAge = { kind: "known"; days: number } | { kind: "unknown" | "invalid" };

export function evidenceReviewAge(reviewedAt: string, now: Date): EvidenceReviewAge {
  const reviewed = Date.parse(reviewedAt);
  if (!Number.isFinite(reviewed)) return { kind: "invalid" };
  const elapsed = now.getTime() - reviewed;
  if (elapsed < 0) return { kind: "unknown" };
  return { kind: "known", days: Math.floor(elapsed / 86_400_000) };
}

export function evidenceReference(evidence: ProjectEvidence): { url?: string; commitSha?: string; scope: ProjectEvidence["level"] } {
  return { url: evidence.url, commitSha: evidence.commitSha, scope: evidence.level };
}

export function sortProjectMilestones(milestones: readonly ProjectMilestone[]): ProjectMilestone[] {
  return milestones.toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id));
}

function searchableText(project: ProjectContent): string {
  return [
    project.name,
    project.outcome,
    project.shortDescription,
    project.longDescription,
    ...project.tags,
    ...project.techStack,
  ]
    .join(" ")
    .toLocaleLowerCase("en");
}

function searchableRepositoryText(repository: {
  name: string;
  description: string;
  repoUrl: string;
  homepageUrl?: string;
  upstream?: { name: string; repoUrl: string };
}): string {
  return [
    repository.name,
    repository.description,
    repository.repoUrl,
    repository.homepageUrl,
    repository.upstream?.name,
    repository.upstream?.repoUrl,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en");
}

export function filterPublicRepositories(
  repositories: readonly PublicRepository[],
  query: string,
): PublicRepository[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("en");
  if (!normalizedQuery) return [...repositories];
  return repositories.filter((repository) =>
    searchableRepositoryText(repository).includes(normalizedQuery),
  );
}

export function selectFlagships(
  projects: readonly ProjectContent[],
): ProjectContent[] {
  return projects
    .filter(
      (project) =>
        project.maturity === "flagship" && project.featuredRank !== undefined,
    )
    .toSorted(
      (left, right) =>
        (left.featuredRank ?? Number.MAX_SAFE_INTEGER) -
          (right.featuredRank ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name),
    );
}

export function filterProjects(
  projects: readonly ProjectContent[],
  filters: ProjectFilters,
): ProjectContent[] {
  const query = filters.query.trim().toLocaleLowerCase("en");
  return projects.filter((project) => {
    if (query && !searchableText(project).includes(query)) return false;
    if (filters.lifecycle === "current") {
      if (project.lifecycle !== "active" && project.lifecycle !== "maintained") {
        return false;
      }
    } else if (filters.lifecycle !== "all" && project.lifecycle !== filters.lifecycle) {
      return false;
    }
    if (filters.maturity !== "all" && project.maturity !== filters.maturity) {
      return false;
    }
    if (filters.category !== "all" && project.category !== filters.category) {
      return false;
    }
    return true;
  });
}

export function sortProjects(
  projects: readonly ProjectContent[],
  sort: ProjectSort,
): ProjectContent[] {
  return projects.toSorted((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name);
    if (sort === "evidence") {
      return (
        Date.parse(right.evidence.reviewedAt) -
          Date.parse(left.evidence.reviewedAt) ||
        left.name.localeCompare(right.name)
      );
    }
    return (
      (left.featuredRank ?? Number.MAX_SAFE_INTEGER) -
        (right.featuredRank ?? Number.MAX_SAFE_INTEGER) ||
      left.name.localeCompare(right.name)
    );
  });
}

export function repositoryActivity(
  stats: GitHubStats | null | undefined,
): RepositoryActivity | null {
  if (!stats || stats.status !== "available") {
    return null;
  }

  return {
    stars: stats.stars,
    language:
      stats.language && stats.language !== "—" ? stats.language : null,
    lastCommitDate: stats.lastCommitDate,
    lastCommitMessage: stats.lastCommitMessage,
  };
}

export function repositoryStatus(
  project: Pick<ProjectContent, "repoUrl">,
  stats: GitHubStats | null | undefined,
): RepositoryStatus {
  if (!project.repoUrl) return "no-repository";
  if (!stats || stats.status === "unavailable") return "unavailable";
  return stats.lastCommitDate ? "updated" : "no-commits";
}
