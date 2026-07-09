import Link from "next/link";
import type { Project } from "@/data/projects";
import type { GitHubStats } from "@/lib/github-stats";
import type { PublicServiceStatus } from "@/lib/metrics/reader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StatusToken } from "./StatusToken";

function repoSignal(stats: GitHubStats | null): string {
  if (!stats?.lastCommitDate) return "no repo signal";
  const days = Math.floor(
    (Date.now() - new Date(stats.lastCommitDate).getTime()) / 86_400_000,
  );
  if (days <= 0) return "updated today";
  if (days === 1) return "updated 1d ago";
  return `updated ${days}d ago`;
}

export function ProjectHealthRow({
  project,
  stats,
  health,
}: {
  project: Project;
  stats: GitHubStats | null;
  health?: PublicServiceStatus;
}) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="grid gap-3 border-t border-zinc-800 px-1 py-4 transition-colors hover:bg-zinc-900/40 sm:grid-cols-[1.2fr_0.8fr_0.8fr_0.7fr]"
    >
      <div>
        <h3 className="font-mono text-sm text-zinc-100">{project.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-zinc-500">
          {project.shortDescription}
        </p>
      </div>
      <div className="flex items-center">
        <StatusBadge status={project.status} />
      </div>
      <div className="flex items-center">
        {health ? (
          <StatusToken value={health.status} />
        ) : (
          <span className="font-mono text-xs text-zinc-600">not probed</span>
        )}
      </div>
      <div className="flex items-center font-mono text-xs text-zinc-600">
        {repoSignal(stats)}
      </div>
    </Link>
  );
}
