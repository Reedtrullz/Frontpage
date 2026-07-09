import Link from "next/link";
import type { ProjectContent } from "@/lib/content/schema";
import type { GitHubStats } from "@/lib/github-stats";
import type { PublicServiceStatus } from "@/lib/metrics/reader";
import { repositoryActivity } from "@/lib/projects/presentation";
import {
  PostureBadge,
  type ProjectHealthPosture,
} from "@/components/ui/PostureBadge";
import { RelativeTime } from "@/components/ui/RelativeTime";

function healthPosture(
  health: PublicServiceStatus | undefined,
): ProjectHealthPosture {
  if (!health) return "not-monitored";
  if (health.status === "up") return "healthy";
  if (health.status === "down") return "disruption";
  return "unavailable";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 md:block">
      <span className="text-xs text-[var(--text-subtle)] md:hidden">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ProjectHealthRow({
  project,
  stats,
  health,
  now,
}: {
  project: ProjectContent;
  stats: GitHubStats | null;
  health?: PublicServiceStatus;
  now: Date;
}) {
  const activity = repositoryActivity(stats);
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="grid gap-4 border-t border-[var(--border)] px-1 py-5 transition-colors hover:bg-[var(--surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] md:grid-cols-[minmax(180px,1.4fr)_minmax(120px,0.8fr)_minmax(130px,0.9fr)_minmax(130px,0.9fr)] md:items-center md:px-3"
    >
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-[var(--text)]">{project.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm leading-5 text-[var(--text-muted)]">{project.outcome}</p>
      </div>
      <Field label="Lifecycle">
        <PostureBadge dimension="lifecycle" value={project.lifecycle} />
      </Field>
      <Field label="Live health">
        <PostureBadge dimension="health" value={healthPosture(health)} />
      </Field>
      <Field label="Repository">
        {activity?.lastCommitDate ? (
          <span className="text-sm text-[var(--text-muted)]">
            Updated <RelativeTime value={activity.lastCommitDate} now={now} />
          </span>
        ) : (
          <span className="text-sm text-[var(--text-subtle)]">No public activity</span>
        )}
      </Field>
    </Link>
  );
}
