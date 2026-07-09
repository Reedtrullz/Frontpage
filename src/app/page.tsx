import { ProjectDashboard } from "@/components/dashboard/ProjectDashboard";
import { getCanonicalPersonal, getCanonicalProjects } from "@/lib/content";
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

export const dynamic = "force-dynamic";

export default async function Home() {
  const personal = getCanonicalPersonal();
  const projects = getCanonicalProjects();
  const featuredProjects = projects.filter(
    (project) => project.featuredRank !== undefined,
  );
  const repoPairs = extractRepoPairs(featuredProjects);
  const [statsMap, readResult] = await Promise.all([
    fetchAllRepoStats(repoPairs),
    Promise.resolve(readMetricsFromDir(getMetricsDir())),
  ]);

  const statsBySlug: Record<string, GitHubStats> = {};
  for (const pair of repoPairs) {
    const stats = statsMap.get(`${pair.owner}/${pair.repo}`);
    if (stats) {
      statsBySlug[pair.slug] = stats;
    }
  }

  return (
    <ProjectDashboard
      personal={personal}
      projects={projects}
      statsBySlug={statsBySlug}
      metrics={derivePublicMetrics(readResult)}
    />
  );
}
