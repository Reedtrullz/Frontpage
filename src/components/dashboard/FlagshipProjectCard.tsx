import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ProjectContent } from "@/lib/content/schema";
import type { ProjectRuntimeHealth } from "@/lib/metrics/status-page";
import { PostureBadge } from "@/components/ui/PostureBadge";
import {
  ProjectMedia,
  ProjectMediaUnavailable,
} from "@/components/ui/ProjectMedia";

export function FlagshipProjectCard({
  project,
  health,
  priority = false,
}: {
  project: ProjectContent;
  health: ProjectRuntimeHealth;
  priority?: boolean;
}) {
  return (
    <article className="group relative overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] transition-colors hover:border-[var(--border-strong)]">
      {project.media ? (
        <div className="border-b border-[var(--border)]">
          <ProjectMedia
            media={project.media.cover}
            priority={priority}
            sizes="(min-width: 1024px) 48vw, 100vw"
          />
        </div>
      ) : (
        <div className="border-b border-[var(--border)]">
          <ProjectMediaUnavailable projectName={project.name} />
        </div>
      )}
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase text-[var(--text-subtle)]">Flagship {project.featuredRank}</p>
            <h3 className="mt-2 text-2xl font-semibold text-[var(--text)]">
              <Link href={`/projects/${project.slug}`} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] after:absolute after:inset-0">
                {project.name}
              </Link>
            </h3>
          </div>
          <ArrowUpRight className="h-5 w-5 shrink-0 text-[var(--text-subtle)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </div>
        <p className="mt-3 text-base font-medium leading-7 text-[var(--text)]">{project.outcome}</p>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--text-muted)]">{project.shortDescription}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <PostureBadge dimension="lifecycle" value={project.lifecycle} />
          <PostureBadge dimension="maturity" value={project.maturity} />
          <PostureBadge dimension="health" value={health} />
        </div>
      </div>
    </article>
  );
}
