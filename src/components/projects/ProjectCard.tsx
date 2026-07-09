import Link from "next/link";
import {
  ArrowUpRight,
  Code2,
  GitCommitHorizontal,
  Star,
} from "lucide-react";
import type { ProjectContent } from "@/lib/content/schema";
import type { GitHubStats } from "@/lib/github-stats";
import { repositoryActivity } from "@/lib/projects/presentation";
import { PostureBadge } from "@/components/ui/PostureBadge";
import {
  ProjectMedia,
  ProjectMediaUnavailable,
} from "@/components/ui/ProjectMedia";
import { RelativeTime } from "@/components/ui/RelativeTime";

interface ProjectCardProps {
  project: ProjectContent;
  stats?: GitHubStats | null;
  now: Date;
}

export function ProjectCard({ project, stats, now }: ProjectCardProps) {
  const activity = repositoryActivity(stats);

  return (
    <article className="group relative flex min-h-full flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] transition-colors hover:border-[var(--border-strong)]">
      <div className="border-b border-[var(--border)]">
        {project.media ? (
          <ProjectMedia media={project.media.cover} sizes="(min-width: 1024px) 40vw, 100vw" />
        ) : (
          <ProjectMediaUnavailable projectName={project.name} />
        )}
      </div>
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase text-[var(--text-subtle)]">
              {project.category}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-[var(--text)]">
              <Link
                href={`/projects/${project.slug}`}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] after:absolute after:inset-0"
              >
                {project.name}
              </Link>
            </h2>
          </div>
          <ArrowUpRight className="h-5 w-5 shrink-0 text-[var(--text-subtle)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </div>

        <p className="mt-3 text-sm font-medium leading-6 text-[var(--text)]">
          {project.outcome}
        </p>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--text-muted)]">
          {project.shortDescription}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <PostureBadge dimension="lifecycle" value={project.lifecycle} />
          <PostureBadge dimension="maturity" value={project.maturity} />
        </div>

        <div className="mt-auto pt-6">
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-subtle)]">
            <span>
              Evidence <RelativeTime value={project.evidence.reviewedAt} now={now} />
            </span>
            {activity?.stars ? (
              <span className="inline-flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5" aria-hidden="true" />
                {activity.stars}
              </span>
            ) : null}
            {activity?.language ? (
              <span className="inline-flex items-center gap-1.5">
                <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                {activity.language}
              </span>
            ) : null}
            {activity?.lastCommitDate ? (
              <span
                className="inline-flex items-center gap-1.5"
                title={activity.lastCommitMessage ?? undefined}
              >
                <GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                <RelativeTime value={activity.lastCommitDate} now={now} />
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
