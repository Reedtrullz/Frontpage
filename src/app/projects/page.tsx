import type { Metadata } from "next";
import { ProjectList } from "@/components/projects/ProjectList";
import { getCanonicalProjects } from "@/lib/content";
import {
  extractRepoPairs,
  fetchAllRepoStats,
  type GitHubStats,
} from "@/lib/github-stats";
import {
  derivePublicMetrics,
  getMetricsDir,
  readMetricsFromDir,
} from "@/lib/metrics/reader";
import { deriveProjectHealth } from "@/lib/metrics/status-page";

export const metadata: Metadata = {
  title: "Projects",
  description: "Published products, tools, and infrastructure with explicit lifecycle, maturity, evidence, and limitations.",
};

export default async function ProjectsPage() {
  const projects = getCanonicalProjects();
  const repoPairs = extractRepoPairs(projects);
  const [stats, readResult] = await Promise.all([
    fetchAllRepoStats(repoPairs),
    Promise.resolve(readMetricsFromDir(getMetricsDir())),
  ]);
  const metrics = derivePublicMetrics(readResult);
  const statsBySlug: Record<string, GitHubStats> = {};
  const healthBySlug = Object.fromEntries(
    projects.map((project) => [
      project.slug,
      deriveProjectHealth(project, metrics.services, metrics.freshness),
    ]),
  );

  for (const pair of repoPairs) {
    const value = stats.get(`${pair.owner}/${pair.repo}`);
    if (value) statsBySlug[pair.slug] = value;
  }

  return (
    <ProjectList
      projects={projects}
      healthBySlug={healthBySlug}
      statsBySlug={statsBySlug}
      nowIso={new Date().toISOString()}
    />
  );
}
