import { getProjects } from "@/lib/data";
import { ProjectList } from "@/components/projects/ProjectList";
import {
  extractRepoPairs,
  fetchRepoStats,
  type GitHubStats,
} from "@/lib/github-stats";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Projects — Reidar",
  description: "All projects — DeFi, bots, frontends, and tooling.",
};

function placeholderStats(): GitHubStats {
  return {
    stars: 0,
    language: "—",
    lastCommitDate: null,
    lastCommitMessage: null,
    updatedAt: null,
    fetchedAt: new Date().toISOString(),
  };
}

export default async function ProjectsPage() {
  const projects = getProjects();
  const repoPairs = extractRepoPairs(projects);
  const statsEntries = await Promise.all(
    repoPairs.map(async ({ owner, repo, slug }) => {
      try {
        const stats = await fetchRepoStats(owner, repo);
        return [slug, stats] as const;
      } catch {
        return [slug, placeholderStats()] as const;
      }
    }),
  );
  const statsBySlug = Object.fromEntries(statsEntries);

  return <ProjectList projects={projects} statsBySlug={statsBySlug} />;
}
