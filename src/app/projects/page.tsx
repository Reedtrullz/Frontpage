import type { Metadata } from "next";
import { ProjectList } from "@/components/projects/ProjectList";
import { getCanonicalProjects } from "@/lib/content";
import {
  extractRepoPairs,
  fetchAllRepoStats,
  type GitHubStats,
} from "@/lib/github-stats";

export const metadata: Metadata = {
  title: "Projects",
  description: "Published products, tools, and infrastructure with explicit lifecycle, maturity, evidence, and limitations.",
};

export default async function ProjectsPage() {
  const projects = getCanonicalProjects();
  const repoPairs = extractRepoPairs(projects);
  const stats = await fetchAllRepoStats(repoPairs);
  const statsBySlug: Record<string, GitHubStats> = {};

  for (const pair of repoPairs) {
    const value = stats.get(`${pair.owner}/${pair.repo}`);
    if (value) statsBySlug[pair.slug] = value;
  }

  return (
    <ProjectList
      projects={projects}
      statsBySlug={statsBySlug}
      nowIso={new Date().toISOString()}
    />
  );
}
