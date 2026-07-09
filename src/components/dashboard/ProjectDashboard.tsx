import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import type { PersonalContent, ProjectContent } from "@/lib/content/schema";
import type { GitHubStats } from "@/lib/github-stats";
import type { PublicMetricsModel } from "@/lib/metrics/reader";
import { deriveProjectHealth } from "@/lib/metrics/status-page";
import { selectFlagships, sortProjects } from "@/lib/projects/presentation";
import { PostureBadge } from "@/components/ui/PostureBadge";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { FlagshipProjectCard } from "./FlagshipProjectCard";
import { ProjectHealthRow } from "./ProjectHealthRow";
import { PublicStatusBand } from "./PublicStatusBand";

export function ProjectDashboard({
  personal,
  projects,
  statsBySlug,
  metrics,
}: {
  personal: PersonalContent;
  projects: ProjectContent[];
  statsBySlug: Record<string, GitHubStats>;
  metrics: PublicMetricsModel;
}) {
  const flagships = selectFlagships(projects);
  const current = sortProjects(
    projects.filter((project) =>
      ["active", "maintained"].includes(project.lifecycle),
    ),
    "featured",
  );
  const recentEvidence = sortProjects(projects, "evidence").slice(0, 5);
  const now = new Date();

  return (
    <div>
      <section className="mx-auto grid max-w-7xl gap-10 px-4 pb-10 pt-14 sm:px-6 sm:pb-14 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
        <div>
          <p className="font-mono text-sm uppercase text-[var(--accent)]">reidar.tech / Project OS</p>
          <h1 className="mt-4 text-5xl font-semibold text-[var(--text)] sm:text-7xl">{personal.name}</h1>
          <p className="mt-4 text-xl font-medium text-[var(--text)]">{personal.title}</p>
          <p className="mt-5 max-w-3xl text-base leading-7 text-[var(--text-muted)]">{personal.bio}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/projects" className="primary-command">Browse projects <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            <Link href="/status" className="secondary-command">View status</Link>
          </div>
        </div>
        <dl className="grid grid-cols-2 border-y border-[var(--border)] text-sm lg:grid-cols-1">
          <div className="border-b border-r border-[var(--border)] px-4 py-4 lg:border-r-0">
            <dt className="text-[var(--text-subtle)]">Published projects</dt>
            <dd className="mt-1 font-mono text-2xl text-[var(--text)]">{projects.length}</dd>
          </div>
          <div className="border-b border-[var(--border)] px-4 py-4">
            <dt className="text-[var(--text-subtle)]">Current</dt>
            <dd className="mt-1 font-mono text-2xl text-[var(--text)]">{current.length}</dd>
          </div>
          <div className="col-span-2 flex items-center gap-2 px-4 py-4 text-[var(--text-muted)] lg:col-span-1">
            <dt className="sr-only">Location</dt>
            <dd className="flex items-center gap-2">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {personal.location}
            </dd>
          </div>
        </dl>
      </section>

      <PublicStatusBand metrics={metrics} />

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20" aria-labelledby="flagships-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-sm text-[var(--accent)]">SELECTED WORK</p>
            <h2 id="flagships-title" className="mt-2 text-3xl font-semibold text-[var(--text)]">Flagship projects</h2>
          </div>
          <Link href="/projects?maturity=flagship" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
            All flagships <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-7 grid gap-5 lg:grid-cols-2">
          {flagships.map((project, index) => (
            <FlagshipProjectCard key={project.slug} project={project} priority={index < 2} />
          ))}
        </div>
      </section>

      <section className="border-y border-[var(--border)] bg-[var(--surface-raised)]" aria-labelledby="current-work-title">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16">
          <div className="flex items-end justify-between gap-5">
            <div>
              <p className="font-mono text-sm text-[var(--accent)]">CURRENT POSTURE</p>
              <h2 id="current-work-title" className="mt-2 text-3xl font-semibold text-[var(--text)]">Current work</h2>
            </div>
            <span className="text-sm text-[var(--text-muted)]">{current.length} projects</span>
          </div>
          <div className="mt-7">
            <div className="hidden grid-cols-[minmax(180px,1.4fr)_minmax(120px,0.8fr)_minmax(130px,0.9fr)_minmax(130px,0.9fr)] gap-4 border-y border-[var(--border)] px-3 py-3 text-xs text-[var(--text-subtle)] md:grid">
              <span>Project</span><span>Lifecycle</span><span>Live health</span><span>Repository</span>
            </div>
            {current.map((project) => (
              <ProjectHealthRow
                key={project.slug}
                project={project}
                stats={statsBySlug[project.slug] ?? null}
                health={deriveProjectHealth(
                  project,
                  metrics.services,
                  metrics.freshness,
                )}
                now={now}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="font-mono text-sm text-[var(--accent)]">RECENT EVIDENCE</p>
          <h2 className="mt-2 text-3xl font-semibold text-[var(--text)]">Reviewed posture</h2>
          <div className="mt-6 border-y border-[var(--border)]">
            {recentEvidence.map((project) => (
              <Link key={project.slug} href={`/projects/${project.slug}`} className="flex min-h-20 items-center justify-between gap-4 border-t border-[var(--border)] px-1 py-4 first:border-t-0 hover:bg-[var(--surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--text)]">{project.name}</p>
                  <p className="mt-1 text-xs text-[var(--text-subtle)]">Reviewed <RelativeTime value={project.evidence.reviewedAt} now={now} /></p>
                </div>
                <PostureBadge dimension="evidence" value={project.evidence.level} />
              </Link>
            ))}
          </div>
        </div>
        <div className="lg:border-l lg:border-[var(--border)] lg:pl-12">
          <p className="font-mono text-sm text-[var(--accent)]">WORKING SCOPE</p>
          <h2 className="mt-2 text-3xl font-semibold text-[var(--text)]">What I build</h2>
          <ul className="mt-6 space-y-0 border-y border-[var(--border)]">
            {personal.whatIDo.map((item) => (
              <li key={item} className="border-t border-[var(--border)] py-4 text-sm leading-6 text-[var(--text-muted)] first:border-t-0">{item}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
