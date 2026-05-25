import { NextResponse } from "next/server";
import { getProjects } from "@/lib/data";
import {
  extractRepoPairs,
  fetchAllRepoStats,
  type GitHubStats,
} from "@/lib/github-stats";

export const dynamic = "force-dynamic";

export async function GET() {
  const projects = getProjects();
  const pairs = extractRepoPairs(projects);
  const statsMap = await fetchAllRepoStats(pairs);

  // Build a slug → stats map for easy client consumption
  const result: Record<string, GitHubStats> = {};
  for (const p of projects) {
    if (!p.repoUrl) continue;
    const key = p.repoUrl
      .replace("https://github.com/", "")
      .replace(/\.git$/, "");
    const stats = statsMap.get(key);
    if (stats) {
      result[p.slug] = stats;
    }
  }

  return NextResponse.json(result);
}
